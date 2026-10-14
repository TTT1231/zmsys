import { BadRequestException } from "@nestjs/common";

/**
 * 目录结构校验器（db-scheme.md §5.4）：apply 与新建品类共用的纯函数。
 * 层级契约：分区（SECTION）只能是根（parentId=null、无 key/multi/qty/items）；
 * 分组（GROUP）挂品类根或同品类分区，带 groupKey/multi/qty；物料是分组的叶子。
 * 数据库 CHECK 只约束节点形态（SECTION 必根、GROUP 必有 key），父子归属、
 * 同品类、无环没有 SQL 约束——读取侧的防御性跳过不能代替写前校验：成环的行
 * 从根不可达，会让备份导出（backup-writer 递归遍历 + 行数自检）直接中止。
 */

/** 结构树节点（投影/校验共用的中间形态）：已存行与同批草稿统一表示 */
export interface CatalogTreeNode {
    id: string;
    parentId: string | null;
    kind: "SECTION" | "GROUP";
    name: string;
    groupKey: string | null;
    multi: boolean | null;
    qty: boolean | null;
    sortOrder: number;
    status: boolean;
    items: Array<{ id: string; name: string; sortOrder: number; status: boolean }>;
}

/** 应用后全树校验：首个违规即抛 400，消息带节点名便于操作人定位 */
export function validateCatalogTree(tree: readonly CatalogTreeNode[]): void {
    const nodes = new Map(tree.map(node => [node.id, node]));
    for (const node of tree) {
        if (nodes.get(node.id) !== node) {
            throw new BadRequestException(`结构节点 ${node.name} 的 id 重复`);
        }
        if (node.kind === "SECTION") {
            if (node.parentId !== null) {
                throw new BadRequestException(`分区「${node.name}」只能作为根节点，不能挂在其他节点下`);
            }
            if (node.groupKey !== null || node.multi !== null || node.qty !== null || node.items.length > 0) {
                throw new BadRequestException(`分区「${node.name}」不携带选择规则，也不能直接挂物料`);
            }
            continue;
        }
        // GROUP：parent 必须是 null 或已存在的同品类分区（防跨品类挂接与悬空父引用）
        if (node.parentId !== null) {
            const parent = nodes.get(node.parentId);
            if (!parent) {
                throw new BadRequestException(`分组「${node.name}」的父节点不存在`);
            }
            if (parent.kind !== "SECTION") {
                throw new BadRequestException(`分组「${node.name}」只能挂在品类根或分区下（不支持多级嵌套）`);
            }
        }
        if (node.groupKey === null || node.multi === null || node.qty === null) {
            throw new BadRequestException(`分组「${node.name}」缺少选择规则（groupKey/multi/qty）`);
        }
    }
    // 无环：层级契约下 SECTION 必根、GROUP 至多两级，按父链走深兜底（写入前的最后防线）
    const seen = new Set<string>();
    for (const node of tree) {
        let cursor: CatalogTreeNode | undefined = node;
        const path: string[] = [];
        while (cursor && cursor.parentId !== null) {
            if (seen.has(cursor.id)) {
                break;
            }
            path.push(cursor.id);
            const next: CatalogTreeNode | undefined = nodes.get(cursor.parentId);
            if (next && path.includes(next.id)) {
                throw new BadRequestException(`结构存在循环挂接（涉及「${cursor.name}」），无法保存`);
            }
            cursor = next;
        }
        for (const id of path) {
            seen.add(id);
        }
    }
    // 品类内唯一：分区与分组共享名称命名空间（uk_material_group_name 覆盖两类节点）、
    // groupKey 唯一（先于数据库 uk 给出友好错误）
    const names = new Map<string, string>();
    const keys = new Map<string, string>();
    for (const node of tree) {
        const named = names.get(node.name);
        if (named) {
            throw new BadRequestException(`名称「${node.name}」重复（与「${named}」同名，同品类内分区与分组不能重名）`);
        }
        names.set(node.name, node.name);
        if (node.kind !== "GROUP") {
            continue;
        }
        const keyed = keys.get(node.groupKey!);
        if (keyed) {
            throw new BadRequestException(`分组「${node.name}」的内部 key 与「${keyed}」冲突`);
        }
        keys.set(node.groupKey!, node.name);
    }
    // model 语义：型号组每品类至多一个（modelCode 取 groupKey=model 的选中项派生）
    const modelGroups = tree.filter(node => node.kind === "GROUP" && node.groupKey === "model");
    if (modelGroups.length > 1) {
        throw new BadRequestException(`型号组（model）只能有一个，当前有 ${modelGroups.length} 个`);
    }
    // 组内物料名唯一（uk_material_item_name 兜底前的友好错误）
    for (const node of tree) {
        const itemNames = new Set<string>();
        for (const item of node.items) {
            if (itemNames.has(item.name)) {
                throw new BadRequestException(`分组「${node.name}」内物料名「${item.name}」重复`);
            }
            itemNames.add(item.name);
        }
    }
}

/**
 * 复合目录合并视角的键冲突：建档校验按 groupKey 聚合单选（bom-rules），主品类与
 * 其 child_categories 子品类的目录合并后同名 key 会被视作同一组。编辑任一参与方
 * 都要用锁后重读的伙伴键集做交集检查（主品类查其子品类；容器品类查引用它的主品类）。
 */
export function assertGroupKeysExclusive(
    ownKeys: ReadonlySet<string>,
    partners: ReadonlyMap<string /*伙伴品类名*/, ReadonlySet<string>>,
): void {
    for (const [partnerName, partnerKeys] of partners) {
        const conflicts = [...ownKeys].filter(key => partnerKeys.has(key));
        if (conflicts.length > 0) {
            throw new BadRequestException(
                `分组内部 key「${conflicts.join("、")}」与共用目录的品类「${partnerName}」冲突，请调整分组`,
            );
        }
    }
}

/**
 * 编码前缀数字延长校验：一个前缀 + 纯数字尾差 == 另一前缀时拒绝（如 XK2 与 XK21
 * 都能拼出 XK21001；序列 padStart 不截断，「至少 N 位」会继续增长）。字母尾差合法
 * （KW/KWO、XK3/XK3W：序列是数字，拼不出带字母的编码）。完全相同的前缀由唯一键
 * 与调用方先行拦截，不在此重复。双向比较。
 */
export function assertPrefixSafe(newPrefix: string, existing: Iterable<string>): void {
    for (const prefix of existing) {
        if (prefix === newPrefix) {
            continue;
        }
        const [shorter, longer] = prefix.length < newPrefix.length ? [prefix, newPrefix] : [newPrefix, prefix];
        if (!longer.startsWith(shorter)) {
            continue;
        }
        const tail = longer.slice(shorter.length);
        if (tail.length > 0 && /^\d+$/.test(tail)) {
            throw new BadRequestException(
                `编码前缀「${newPrefix}」与既有前缀「${prefix}」存在数字延长冲突（如 ${shorter} 的序号增长后会拼出 ${longer} 开头的编码），请更换前缀`,
            );
        }
    }
}

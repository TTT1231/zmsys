import type { BomCatalogNode, DraftNodeInput, StructureOperation } from "@/api";

/**
 * 「BOM 结构」编辑器的本地视图投影：编辑模式 = 服务端目录快照 + 草稿 ops 按序投影
 * （所见即所存——语义与后端 catalog-projector 同构：同级相邻交换、边界不动、
 * 隐藏/恢复只改自身状态、规则即时生效、改名/跨父移动/删除整支即时生效）。
 * 草稿节点（draft）的删除走 ops 手术（连同其子草稿 op 一并摘除，等同从未存在），
 * 已保存节点的删除走 remove op（服务端按 bom_item 引用守卫拒绝被引用项）。
 */
/** 编辑器最多五层；最后一层放物料，避免生成无法继续使用的空分组。 */
export const MAX_TREE_DEPTH = 5;

export interface ViewItem {
    id: string;
    name: string;
    status: boolean;
    /** 本批新增（未保存）：可移除 */
    draft?: boolean;
}

export interface ViewGroupNode {
    kind: "group";
    id: string;
    parentId: string | null;
    name: string;
    multi: boolean;
    qty: boolean;
    status: boolean;
    items: ViewItem[];
    groups?: ViewGroupNode[];
    draft?: boolean;
}

export interface ViewSectionNode {
    kind: "section";
    id: string;
    name: string;
    status: boolean;
    groups: ViewGroupNode[];
    draft?: boolean;
}

export type ViewRoot = ViewSectionNode | ViewGroupNode;

/** 同名的单项物料省去重复的分组外壳；数量规则不改变其展示身份。 */
export function standaloneItemOf(group: ViewGroupNode): ViewItem | undefined {
    return !group.groups?.length && !group.multi && group.items.length === 1 && group.items[0]?.name === group.name
        ? group.items[0]
        : undefined;
}

/** 与折叠同名单物料的展示一致，返回当前分支占用的可见层数。 */
export function viewDepthOf(node: ViewRoot): number {
    return Math.max(
        1,
        node.kind === "group" && node.items.length > 0 && !standaloneItemOf(node) ? 2 : 1,
        ...viewChildrenOf(node).map(child => 1 + viewDepthOf(child)),
    );
}

const groupOf = (node: BomCatalogNode): ViewGroupNode => ({
    kind: "group",
    id: node.id,
    parentId: node.parentId,
    name: node.name,
    multi: node.multi === true,
    qty: node.qty === true,
    status: node.status !== false,
    groups: [],
    items: node.items.map(item => ({ id: item.id, name: item.name, status: item.status !== false })),
});

/** 目录契约的平铺 groups → 嵌套视图（分区带子组；跨品类悬空分组防御性按根展示） */
export function viewTreeOf(groups: BomCatalogNode[]): ViewRoot[] {
    const nodes = new Map<string, ViewRoot>(
        groups.map(node => [
            node.id,
            node.kind === "section"
                ? { kind: "section", id: node.id, name: node.name, status: node.status !== false, groups: [] }
                : groupOf(node),
        ]),
    );
    const roots: ViewRoot[] = [];
    for (const source of groups) {
        const node = nodes.get(source.id)!;
        const parent = source.parentId === null ? undefined : nodes.get(source.parentId);
        if (node.kind === "group" && parent) (parent.groups ??= []).push(node);
        else roots.push(node);
    }
    return roots;
}

export const viewChildrenOf = (node: ViewRoot): ViewGroupNode[] => node.groups ?? [];

export function viewNodesOf(roots: readonly ViewRoot[]): ViewRoot[] {
    return roots.flatMap(root => [root, ...viewNodesOf(viewChildrenOf(root))]);
}

export function viewPathOf(roots: readonly ViewRoot[], id: string): ViewRoot[] {
    for (const root of roots) {
        if (root.id === id) return [root];
        if (root.kind === "group" && root.items.some(item => item.id === id)) return [root];
        const childPath = viewPathOf(viewChildrenOf(root), id);
        if (childPath.length) return [root, ...childPath];
    }
    return [];
}

const cloneTree = (roots: readonly ViewRoot[]): ViewRoot[] =>
    roots.map(root =>
        root.kind === "section"
            ? { ...root, groups: cloneTree(root.groups) as ViewGroupNode[] }
            : {
                  ...root,
                  groups: cloneTree(viewChildrenOf(root)) as ViewGroupNode[],
                  items: root.items.map(item => ({ ...item })),
              },
    );

interface TreeIndex {
    roots: ViewRoot[];
    nodeOf: (id: string) => ViewRoot | undefined;
    sectionOf: (id: string) => ViewSectionNode | undefined;
    groupOf: (id: string) => { group: ViewGroupNode; siblings: ViewGroupNode[] } | undefined;
    itemOf: (id: string) => { item: ViewItem; siblings: ViewItem[] } | undefined;
}

const indexTree = (roots: ViewRoot[]): TreeIndex => ({
    roots,
    nodeOf: id => viewNodesOf(roots).find(node => node.id === id),
    sectionOf: id => roots.find(root => root.kind === "section" && root.id === id) as ViewSectionNode | undefined,
    groupOf: id => {
        const visit = (siblings: ViewRoot[]): { group: ViewGroupNode; siblings: ViewGroupNode[] } | undefined => {
            for (const node of siblings) {
                if (node.kind === "group" && node.id === id)
                    return { group: node, siblings: siblings as ViewGroupNode[] };
                const found = visit(viewChildrenOf(node));
                if (found) return found;
            }
            return undefined;
        };
        return visit(roots);
    },
    itemOf: id => {
        for (const node of viewNodesOf(roots)) {
            if (node.kind !== "group") continue;
            const item = node.items.find(entry => entry.id === id);
            if (item) return { item, siblings: node.items };
        }
        return undefined;
    },
});

/** 相邻交换（边界不动）：与后端 reorder 语义一致 */
const swapSibling = <T>(siblings: T[], id: (entry: T) => string, targetId: string, direction: "up" | "down"): void => {
    const index = siblings.findIndex(entry => id(entry) === targetId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index >= 0 && target >= 0 && target < siblings.length) {
        [siblings[index], siblings[target]] = [siblings[target]!, siblings[index]!];
    }
};

/** 编辑模式投影：快照 + 草稿 ops → 当前视图（纯函数，不可变更入参） */
export function applyOpsToView(snapshot: ViewRoot[], operations: readonly StructureOperation[]): ViewRoot[] {
    const tree = cloneTree(snapshot);
    const index = indexTree(tree);
    for (const op of operations) {
        switch (op.type) {
            case "add_section":
                index.roots.push({
                    kind: "section",
                    id: op.tempId,
                    name: op.name,
                    status: true,
                    groups: [],
                    draft: true,
                });
                break;
            case "add_group": {
                const group: ViewGroupNode = {
                    kind: "group",
                    id: op.tempId,
                    parentId: op.parentId,
                    name: op.name,
                    multi: op.multi,
                    qty: op.qty,
                    status: true,
                    draft: true,
                    groups: [],
                    items: (op.items ?? []).map(item => ({
                        id: item.tempId,
                        name: item.name,
                        status: true,
                        draft: true,
                    })),
                };
                const parent = op.parentId === null ? undefined : index.nodeOf(op.parentId);
                if (parent) {
                    (parent.groups ??= []).push(group);
                } else {
                    index.roots.push(group);
                }
                break;
            }
            case "add_item": {
                const found = index.groupOf(op.groupId);
                if (found) {
                    found.group.items.push({ id: op.tempId, name: op.name, status: true, draft: true });
                }
                break;
            }
            case "hide":
            case "restore": {
                const status = op.type === "restore";
                if (op.targetType === "item") {
                    const found = index.itemOf(op.targetId);
                    if (found) {
                        found.item.status = status;
                    }
                } else if (op.targetType === "group") {
                    const found = index.groupOf(op.targetId);
                    if (found) {
                        found.group.status = status;
                    }
                } else {
                    const section = index.sectionOf(op.targetId);
                    if (section) {
                        section.status = status;
                    }
                }
                break;
            }
            case "reorder": {
                if (op.targetType === "item") {
                    const found = index.itemOf(op.targetId);
                    if (found) {
                        swapSibling(found.siblings, entry => entry.id, op.targetId, op.direction);
                    }
                } else if (op.targetType === "group") {
                    const found = index.groupOf(op.targetId);
                    if (found) {
                        swapSibling(found.siblings, entry => entry.id, op.targetId, op.direction);
                    }
                } else {
                    const sections = index.roots.filter(root => root.kind === "section") as ViewSectionNode[];
                    const section = sections.find(entry => entry.id === op.targetId);
                    if (section) {
                        // 分区与根分组同属顶级混排：交换作用于整个根序列中的相邻分区/根分组
                        swapSibling(index.roots, entry => entry.id, op.targetId, op.direction);
                    }
                }
                break;
            }
            case "set_rules": {
                const found = index.groupOf(op.groupId);
                if (found) {
                    found.group.multi = op.multi;
                    found.group.qty = op.qty;
                }
                break;
            }
            case "rename": {
                if (op.targetType === "item") {
                    const found = index.itemOf(op.targetId);
                    if (found) {
                        found.item.name = op.name;
                    }
                } else if (op.targetType === "group") {
                    const found = index.groupOf(op.targetId);
                    if (found) {
                        found.group.name = op.name;
                    }
                } else {
                    const section = index.sectionOf(op.targetId);
                    if (section) {
                        section.name = op.name;
                    }
                }
                break;
            }
            case "move": {
                if (op.targetType === "item") {
                    const from = index.itemOf(op.targetId);
                    const into = op.parentId === null ? undefined : index.groupOf(op.parentId);
                    if (from && into && into.group.id !== op.targetId) {
                        const [moved] = from.siblings.splice(from.siblings.indexOf(from.item), 1);
                        if (moved) {
                            into.group.items.push(moved);
                        }
                    }
                    break;
                }
                const from = index.groupOf(op.targetId);
                if (!from) {
                    break;
                }
                const targetParent = op.parentId === null ? undefined : index.nodeOf(op.parentId);
                if (
                    op.parentId !== null &&
                    (!targetParent || viewNodesOf([from.group]).some(node => node.id === op.parentId))
                ) {
                    break; // 不存在或循环嵌套的目标：与后端校验对齐，本地静默忽略
                }
                const [moved] = from.siblings.splice(from.siblings.indexOf(from.group), 1);
                if (!moved) {
                    break;
                }
                moved.parentId = op.parentId;
                if (targetParent) {
                    (targetParent.groups ??= []).push(moved);
                } else {
                    index.roots.push(moved);
                }
                break;
            }
            case "remove": {
                if (op.targetType === "item") {
                    const found = index.itemOf(op.targetId);
                    if (found) {
                        found.siblings.splice(found.siblings.indexOf(found.item), 1);
                    }
                } else if (op.targetType === "group") {
                    const found = index.groupOf(op.targetId);
                    if (found) {
                        found.siblings.splice(found.siblings.indexOf(found.group), 1);
                    }
                } else {
                    const section = index.sectionOf(op.targetId);
                    if (section) {
                        index.roots.splice(index.roots.indexOf(section), 1);
                    }
                }
                break;
            }
        }
    }
    return tree;
}

/* ---- 草稿删除手术：摘除草稿节点的 add op 及其全部关联 op（等同从未存在） ---- */

const createdIdsOf = (op: StructureOperation): string[] => {
    switch (op.type) {
        case "add_section":
        case "add_item":
            return [op.tempId];
        case "add_group":
            return [op.tempId, ...(op.items ?? []).map(item => item.tempId)];
        default:
            return [];
    }
};

const referencedIdsOf = (op: StructureOperation): string[] => {
    switch (op.type) {
        case "add_group":
            return op.parentId === null ? [] : [op.parentId];
        case "add_item":
            return [op.groupId];
        case "set_rules":
            return [op.groupId];
        case "hide":
        case "restore":
        case "reorder":
        case "rename":
        case "remove":
            return [op.targetId];
        case "move":
            return op.parentId === null ? [op.targetId] : [op.targetId, op.parentId];
        default:
            return [];
    }
};

/** 删除草稿节点（tempId）时对 ops 列表做手术：以各 op 的「主建 id」判定整支摘除
 *  （分组摘除连带其内联物料），引用 doomed id 的后续 op 一并摘除；add_group 未被
 *  摘除但其中某个内联物料 doomed 时，只从该 op 的 items 里剔除该物料（删一条随组
 *  物料不等于删整组）。不动已保存节点相关 op */
export function withoutDraftSubtree(
    operations: readonly StructureOperation[],
    rootTempId: string,
): StructureOperation[] {
    const primaryIdOf = (op: StructureOperation): string | undefined =>
        op.type === "add_section" || op.type === "add_group" || op.type === "add_item" ? op.tempId : undefined;
    const doomed = new Set<string>([rootTempId]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const op of operations) {
            const primary = primaryIdOf(op);
            const dropped =
                (primary !== undefined && doomed.has(primary)) || referencedIdsOf(op).some(id => doomed.has(id));
            if (dropped) {
                // 整支摘除：其创建的全部 id（含 add_group 的内联物料）随之 doomed
                for (const id of createdIdsOf(op)) {
                    if (!doomed.has(id)) {
                        doomed.add(id);
                        grew = true;
                    }
                }
            }
        }
    }
    const isDropped = (op: StructureOperation): boolean => {
        const primary = primaryIdOf(op);
        return (primary !== undefined && doomed.has(primary)) || referencedIdsOf(op).some(id => doomed.has(id));
    };
    return operations
        .filter(op => !isDropped(op))
        .map(op =>
            op.type === "add_group" && op.items?.length
                ? { ...op, items: op.items.filter(item => !doomed.has(item.tempId)) }
                : op,
        );
}

/* ---- 展示辅助：统计、平铺行、重名校验 ---- */

/** 新建品类草稿（本地未入库品类）的投影树 → 平铺 DraftNodeInput[]（DFS 先序，
 *  parentTempId 关联多层父子；草稿品类节点 id 即 tempId）。保存结构时随
 *  createBomCategory 一次性入库，服务端 draftTreeOf 按平铺序重建同构树。 */
export function flatDraftInputOf(roots: readonly ViewRoot[]): DraftNodeInput[] {
    const nodes: DraftNodeInput[] = [];
    const visit = (siblings: readonly ViewRoot[], parentTempId: string | null): void => {
        for (const node of siblings) {
            if (node.kind === "section") {
                nodes.push({ kind: "SECTION", tempId: node.id, name: node.name });
            } else {
                nodes.push({
                    kind: "GROUP",
                    tempId: node.id,
                    name: node.name,
                    ...(parentTempId === null ? {} : { parentTempId }),
                    multi: node.multi,
                    qty: node.qty,
                    items: node.items.map(item => ({ tempId: item.id, name: item.name })),
                });
            }
            visit(viewChildrenOf(node), node.id);
        }
    };
    visit(roots, null);
    return nodes;
}

/** 统计（编辑器头部的「X 个分组 · Y 项物料」口径：分组 = GROUP 节点，物料 = 叶子项） */
export function statsOf(roots: readonly ViewRoot[]): { groups: number; materials: number } {
    const groups = viewNodesOf(roots).filter((node): node is ViewGroupNode => node.kind === "group");
    return { groups: groups.length, materials: groups.reduce((sum, node) => sum + node.items.length, 0) };
}

export interface FlatRow {
    kind: "section" | "group" | "item";
    id: string;
    name: string;
    /** item → 所属分组名；group → 所属父节点名（根分组 null）；section → null */
    holderName: string | null;
    /** 自身是否隐藏（不含祖先） */
    hidden: boolean;
    /** 含祖先隐藏（= 不可选） */
    effectivelyHidden: boolean;
    draft: boolean;
    /** 同级首位/末位（上移/下移禁用态） */
    first: boolean;
    last: boolean;
}

/** 平铺行（树渲染与移动弹窗共用的遍历序：节点 → 直属物料 → 子分组） */
export function flattenTree(roots: readonly ViewRoot[]): FlatRow[] {
    const rows: FlatRow[] = [];
    const visit = (nodes: readonly ViewRoot[], holder: string | null, hidden: boolean) => {
        nodes.forEach((node, index) => {
            const inheritedHidden = hidden || !node.status;
            rows.push({
                kind: node.kind,
                id: node.id,
                name: node.name,
                holderName: holder,
                hidden: !node.status,
                effectivelyHidden: inheritedHidden,
                draft: node.draft === true,
                first: index === 0,
                last: index === nodes.length - 1,
            });
            if (node.kind === "group")
                node.items.forEach((item, itemIndex) =>
                    rows.push({
                        kind: "item",
                        id: item.id,
                        name: item.name,
                        holderName: node.name,
                        hidden: !item.status,
                        effectivelyHidden: inheritedHidden || !item.status,
                        draft: item.draft === true,
                        first: itemIndex === 0,
                        last: itemIndex === node.items.length - 1,
                    }),
                );
            visit(viewChildrenOf(node), node.name, inheritedHidden);
        });
    };
    visit(roots, null, false);
    return rows;
}

/** 同品类内分区与分组共享名称命名空间（与后端 uk_material_group_name 一致）；
 *  物料名按组内唯一校验。返回冲突名（null = 无冲突） */
export function conflictingNodeName(roots: readonly ViewRoot[], name: string, exceptId?: string): string | null {
    return viewNodesOf(roots).some(node => node.id !== exceptId && node.name === name) ? name : null;
}

/** 组内物料重名（新增/改名物料校验）；返回冲突名（null = 无冲突） */
export function conflictingItemName(
    roots: readonly ViewRoot[],
    groupId: string,
    name: string,
    exceptId?: string,
): string | null {
    const group = viewNodesOf(roots).find(node => node.kind === "group" && node.id === groupId) as
        | ViewGroupNode
        | undefined;
    return group?.items.some(item => item.name === name && item.id !== exceptId) ? name : null;
}

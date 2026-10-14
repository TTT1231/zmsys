import { BadRequestException } from "@nestjs/common";
import type { CatalogTreeNode } from "./catalog-validator";

/**
 * 结构操作投影器（db-scheme.md §5.4）：把操作序列顺序应用到目录树上，产出
 * 「应用后全树 + 数据库写差分 + 变动节点摘要」。apply 服务与前端草稿投影共用
 * 同一语义（前后端两处实现必须同构）：
 * - 同级顺序恒归一化：兄弟集合按 sortOrder 稳定排序后以 0..n-1 重排，reorder 即
 *   在该序列中与相邻项交换位置（边界不动 = 无操作）；摘要中的「顺序」用 1 起始的
 *   位置而非裸 sortOrder（归一化会压缩序号，位置才是操作人看到的次序）。
 * - 冗余操作（隐藏已隐藏项、恢复已启项、规则未变化、改名同名）不产生写入也不进摘要。
 * - 草稿节点（tempId）在投影时立即分配真实雪花 id 并登记映射，后续操作可按
 *   tempId 或已存 id 引用；隐藏/恢复只改自身 status，不级联改子节点（可选 =
 *   自身∧祖先启用）。
 * - rename 改名 / move 跨父移动（分组换分区或根、物料换分组，均追加到目标末位）/
 *   remove 删除（分区连带子分组整支）：基线物料被删除/改名/换组、基线分组被改名
 *   的信息单列输出，由服务层做 bom_item 引用守卫（被引用即 400，只能隐藏）。
 */

/** 结构操作（discriminated union；DTO 校验后映射为本类型）。v2 增补：
 *  rename 改名（被既有 BOM 引用的物料/分组由服务层引用守卫拒绝）、move 跨父移动
 *  （分组换分区/根、物料换分组，追加到目标末位）、remove 删除（整支；同样受引用守卫，
 *  被引用时只能隐藏，见 db-scheme.md §5.4） */
export type StructureOperation =
    | { type: "add_section"; tempId: string; name: string }
    | {
          type: "add_group";
          tempId: string;
          name: string;
          parentId: string | null;
          multi: boolean;
          qty: boolean;
          items?: Array<{ tempId: string; name: string }>;
      }
    | { type: "add_item"; tempId: string; groupId: string; name: string }
    | { type: "hide"; targetType: "section" | "group" | "item"; targetId: string }
    | { type: "restore"; targetType: "section" | "group" | "item"; targetId: string }
    | { type: "reorder"; targetType: "section" | "group" | "item"; targetId: string; direction: "up" | "down" }
    | { type: "set_rules"; groupId: string; multi: boolean; qty: boolean }
    | { type: "rename"; targetType: "section" | "group" | "item"; targetId: string; name: string }
    | { type: "move"; targetType: "group" | "item"; targetId: string; parentId: string | null }
    | { type: "remove"; targetType: "section" | "group" | "item"; targetId: string };

/** 变动节点摘要（op_log detail 的 operations 数组元素；只记差异，不复制整树） */
export interface StructureChangeSummary {
    nodeType: "section" | "group" | "item";
    nodeId: string;
    name: string;
    /** 新增节点（nodeId 为本次生成的雪花 id） */
    added?: true;
    /** 删除节点（终态已不存在；nodeId/name 为基线值） */
    removed?: true;
    before?: {
        multi?: boolean;
        qty?: boolean;
        status?: boolean;
        position?: number;
        name?: string;
        /** 移动前父分区名（null = 品类根；物料移动时为原分组名） */
        parent?: string | null;
    };
    after?: {
        multi?: boolean;
        qty?: boolean;
        status?: boolean;
        position?: number;
        name?: string;
        parent?: string | null;
    };
}

export interface ProjectionResult {
    afterTree: CatalogTreeNode[];
    writes: {
        /** categoryId 由调用方补充 */
        createGroups: Array<{
            id: bigint;
            parentId: bigint | null;
            kind: "SECTION" | "GROUP";
            name: string;
            groupKey: string | null;
            multi: boolean | null;
            qty: boolean | null;
            sortOrder: number;
        }>;
        createItems: Array<{ id: bigint; groupId: bigint; name: string; sortOrder: number }>;
        /** 终态已消失的基线节点（带形态：写侧须分组先于分区删除，满足父外键 RESTRICT） */
        deleteGroups: Array<{ id: bigint; kind: "SECTION" | "GROUP" }>;
        deleteItems: bigint[];
        updateGroups: Array<{
            id: bigint;
            data: {
                status?: boolean;
                sortOrder?: number;
                multi?: boolean;
                qty?: boolean;
                name?: string;
                parentId?: bigint | null;
            };
        }>;
        updateItems: Array<{
            id: bigint;
            data: { status?: boolean; sortOrder?: number; name?: string; groupId?: bigint };
        }>;
    };
    /** 本次由启用转停用的物料（引用计数提示用，不阻断） */
    hiddenMaterialIds: bigint[];
    /** 基线物料中被删除/改名/换组的（服务层引用守卫：被 bom_item 引用即 400） */
    removedItemIds: bigint[];
    renamedItemIds: bigint[];
    movedItemIds: bigint[];
    /** 基线分组中被改名的（groupKey 稳定不变，守卫按 bom_item.group_key 计数） */
    renamedGroupKeys: Array<{ groupKey: string; name: string }>;
    summary: StructureChangeSummary[];
}

export function projectStructure(
    base: readonly CatalogTreeNode[],
    operations: readonly StructureOperation[],
    genId: () => bigint,
    /** 键冲突禁区：复合目录伙伴品类的既有 groupKey（服务层锁后重读传入） */
    reservedGroupKeys: ReadonlySet<string> = new Set(),
): ProjectionResult {
    const nodes = new Map<string, CatalogTreeNode>();
    for (const node of base) {
        nodes.set(node.id, { ...node, items: node.items.map(item => ({ ...item })) });
    }
    const baseNodes = new Map(base.map(node => [node.id, node]));
    const baseItemIds = new Set(base.flatMap(node => node.items.map(item => item.id)));
    const baseItems = new Map(base.flatMap(node => node.items.map(item => [item.id, item])));

    const tempToId = new Map<string, string>();
    const claimTemp = (tempId: string): void => {
        if (tempToId.has(tempId)) {
            throw new BadRequestException(`草稿标识「${tempId}」重复`);
        }
        tempToId.set(tempId, "");
    };
    const resolve = (ref: string, what: string): string => {
        const mapped = tempToId.get(ref) ?? (nodes.has(ref) ? ref : undefined);
        if (!mapped) {
            throw new BadRequestException(`${what}「${ref}」不存在（可能已被他人删除或草稿标识无效）`);
        }
        return mapped;
    };
    /** 物料引用：物料不在节点表里，须查草稿映射、基线与当前各组的 items */
    const resolveItem = (ref: string): string => {
        const mapped = tempToId.get(ref);
        if (mapped) {
            return mapped;
        }
        if (baseItems.has(ref)) {
            return ref;
        }
        for (const node of nodes.values()) {
            if (node.items.some(item => item.id === ref)) {
                return ref;
            }
        }
        if (nodes.has(ref)) {
            throw new BadRequestException("目标节点不是物料");
        }
        throw new BadRequestException(`物料「${ref}」不存在（可能已被他人删除或草稿标识无效）`);
    };

    /** 定位物料当前所在分组与下标（hide/reorder/rename/move/remove 共用） */
    const findItem = (
        ref: string,
    ): { node: CatalogTreeNode; index: number; item: CatalogTreeNode["items"][number] } => {
        for (const node of nodes.values()) {
            const index = node.items.findIndex(item => item.id === ref);
            if (index >= 0) {
                return { node, index, item: node.items[index]! };
            }
        }
        throw new BadRequestException("目标节点不是物料");
    };

    /** 分区/分组形态校验（rename/move/remove 的 targetType 与实际节点对齐） */
    const assertNodeKind = (node: CatalogTreeNode, targetType: "section" | "group"): void => {
        const expected = targetType === "section" ? "SECTION" : "GROUP";
        if (node.kind !== expected) {
            throw new BadRequestException(`节点「${node.name}」不是${targetType === "section" ? "分区" : "分组"}`);
        }
    };

    const usedKeys = new Set<string>([
        ...reservedGroupKeys,
        ...base.filter(node => node.kind === "GROUP" && node.groupKey).map(node => node.groupKey!),
    ]);
    const genGroupKey = (): string => {
        let index = 1;
        while (usedKeys.has(`g${index}`)) {
            index += 1;
        }
        const key = `g${index}`;
        usedKeys.add(key);
        return key;
    };

    const siblingsOf = (parentId: string | null): CatalogTreeNode[] =>
        [...nodes.values()].filter(node => node.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);
    const nextSortOrder = (parentId: string | null): number =>
        siblingsOf(parentId).reduce((max, node) => Math.max(max, node.sortOrder), -1) + 1;
    /** 兄弟集合按当前次序重排 sortOrder = 0..n-1（稳定排序保持既有相对次序） */
    const reindexSiblings = (parentId: string | null): void => {
        siblingsOf(parentId).forEach((node, index) => {
            node.sortOrder = index;
        });
    };

    for (const op of operations) {
        switch (op.type) {
            case "add_section": {
                claimTemp(op.tempId);
                const id = genId().toString();
                tempToId.set(op.tempId, id);
                nodes.set(id, {
                    id,
                    parentId: null,
                    kind: "SECTION",
                    name: op.name,
                    groupKey: null,
                    multi: null,
                    qty: null,
                    sortOrder: nextSortOrder(null),
                    status: true,
                    items: [],
                });
                break;
            }
            case "add_group": {
                claimTemp(op.tempId);
                const parentId = op.parentId === null ? null : resolve(op.parentId, "上级分区");
                if (parentId !== null && nodes.get(parentId)!.kind !== "SECTION") {
                    throw new BadRequestException("分组只能挂在品类根或分区下");
                }
                const groupKey = genGroupKey();
                const id = genId().toString();
                tempToId.set(op.tempId, id);
                nodes.set(id, {
                    id,
                    parentId,
                    kind: "GROUP",
                    name: op.name,
                    groupKey,
                    multi: op.multi,
                    qty: op.qty,
                    sortOrder: nextSortOrder(parentId),
                    status: true,
                    items: (op.items ?? []).map((item, index) => {
                        claimTemp(item.tempId);
                        const itemId = genId().toString();
                        tempToId.set(item.tempId, itemId);
                        return { id: itemId, name: item.name, sortOrder: index, status: true };
                    }),
                });
                break;
            }
            case "add_item": {
                claimTemp(op.tempId);
                const groupId = resolve(op.groupId, "所属分组");
                const group = nodes.get(groupId)!;
                if (group.kind !== "GROUP") {
                    throw new BadRequestException("物料只能挂在分组下");
                }
                const id = genId().toString();
                tempToId.set(op.tempId, id);
                group.items.push({ id, name: op.name, sortOrder: group.items.length, status: true });
                break;
            }
            case "hide":
            case "restore": {
                const status = op.type === "restore";
                if (op.targetType === "item") {
                    const itemId = resolveItem(op.targetId);
                    findItem(itemId).item.status = status;
                    break;
                }
                const nodeId = resolve(op.targetId, op.targetType === "section" ? "分区" : "分组");
                const node = nodes.get(nodeId)!;
                assertNodeKind(node, op.targetType);
                node.status = status;
                break;
            }
            case "reorder": {
                if (op.targetType === "item") {
                    const itemId = resolveItem(op.targetId);
                    const { node } = findItem(itemId);
                    const index = node.items.findIndex(item => item.id === itemId);
                    const target = op.direction === "up" ? index - 1 : index + 1;
                    if (target >= 0 && target < node.items.length) {
                        const [moved] = node.items.splice(index, 1);
                        node.items.splice(target, 0, moved!);
                        node.items.forEach((item, order) => {
                            item.sortOrder = order;
                        });
                    }
                    break;
                }
                const nodeId = resolve(op.targetId, op.targetType === "section" ? "分区" : "分组");
                const node = nodes.get(nodeId)!;
                assertNodeKind(node, op.targetType);
                const siblings = siblingsOf(node.parentId);
                const index = siblings.findIndex(entry => entry.id === nodeId);
                const target = op.direction === "up" ? index - 1 : index + 1;
                if (target >= 0 && target < siblings.length) {
                    siblings[index] = siblings[target]!;
                    siblings[target] = node;
                    // 交换位置后立即按当前数组序固化 sortOrder（重排序会认同新次序）
                    siblings.forEach((entry, order) => {
                        entry.sortOrder = order;
                    });
                }
                break;
            }
            case "set_rules": {
                const groupId = resolve(op.groupId, "分组");
                const node = nodes.get(groupId)!;
                if (node.kind !== "GROUP") {
                    throw new BadRequestException("选择规则只能配置在分组上");
                }
                node.multi = op.multi;
                node.qty = op.qty;
                break;
            }
            case "rename": {
                if (op.targetType === "item") {
                    const itemId = resolveItem(op.targetId);
                    findItem(itemId).item.name = op.name;
                    break;
                }
                const nodeId = resolve(op.targetId, op.targetType === "section" ? "分区" : "分组");
                const node = nodes.get(nodeId)!;
                assertNodeKind(node, op.targetType);
                node.name = op.name;
                break;
            }
            case "move": {
                if (op.targetType === "item") {
                    const itemId = resolveItem(op.targetId);
                    if (op.parentId === null) {
                        throw new BadRequestException("物料移动必须指定目标分组");
                    }
                    const targetId = resolve(op.parentId, "目标分组");
                    const target = nodes.get(targetId)!;
                    if (target.kind !== "GROUP") {
                        throw new BadRequestException("物料只能挂在分组下");
                    }
                    const { node: owner, index, item } = findItem(itemId);
                    owner.items.splice(index, 1);
                    item.sortOrder = target.items.length;
                    target.items.push(item);
                    break;
                }
                const nodeId = resolve(op.targetId, "分组");
                const node = nodes.get(nodeId)!;
                assertNodeKind(node, "group");
                const parentId = op.parentId === null ? null : resolve(op.parentId, "目标分区");
                if (parentId !== null && nodes.get(parentId)!.kind !== "SECTION") {
                    throw new BadRequestException("分组只能挂在品类根或分区下");
                }
                node.parentId = parentId;
                node.sortOrder = nextSortOrder(parentId);
                break;
            }
            case "remove": {
                if (op.targetType === "item") {
                    const itemId = resolveItem(op.targetId);
                    const { node: owner, index } = findItem(itemId);
                    owner.items.splice(index, 1);
                    break;
                }
                const nodeId = resolve(op.targetId, op.targetType === "section" ? "分区" : "分组");
                const node = nodes.get(nodeId)!;
                assertNodeKind(node, op.targetType);
                if (node.kind === "SECTION") {
                    // 分区只承载一层分组：连带其子分组整支移除（物料嵌在分组里随之消失）
                    for (const child of [...nodes.values()].filter(entry => entry.parentId === nodeId)) {
                        nodes.delete(child.id);
                    }
                }
                nodes.delete(nodeId);
                break;
            }
        }
    }

    // 终态归一化：根（分区+分组混排）、各分区子组、各组内物料全部按当前次序重排
    reindexSiblings(null);
    for (const node of nodes.values()) {
        if (node.kind === "SECTION") {
            reindexSiblings(node.id);
        } else {
            node.items.forEach((item, index) => {
                item.sortOrder = index;
            });
        }
    }

    // 基线位置（1 起始，供摘要的 position 前后值）
    const basePositions = new Map<string, number>();
    const recordPositions = (parentId: string | null): void => {
        base.filter(node => node.parentId === parentId)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .forEach((node, index) => {
                basePositions.set(node.id, index + 1);
            });
    };
    const baseRootParents: Array<string | null> = [
        null,
        ...base.filter(node => node.kind === "SECTION").map(node => node.id),
    ];
    for (const parent of baseRootParents) {
        recordPositions(parent);
    }
    for (const node of base) {
        node.items.forEach((item, index) => basePositions.set(item.id, index + 1));
    }

    const writes: ProjectionResult["writes"] = {
        createGroups: [],
        createItems: [],
        deleteGroups: [],
        deleteItems: [],
        updateGroups: [],
        updateItems: [],
    };
    const summary: StructureChangeSummary[] = [];
    const hiddenMaterialIds: bigint[] = [];
    const removedItemIds: bigint[] = [];
    const renamedItemIds: bigint[] = [];
    const movedItemIds: bigint[] = [];
    const renamedGroupKeys: Array<{ groupKey: string; name: string }> = [];

    const positionOf = (node: CatalogTreeNode): number =>
        siblingsOf(node.parentId).findIndex(entry => entry.id === node.id) + 1;
    /** 终态父名（分组 → 所属分区名；品类根为 null）——摘要可读性用 */
    const parentLabelOf = (node: CatalogTreeNode): string | null =>
        node.parentId === null ? null : (nodes.get(node.parentId)?.name ?? null);

    for (const node of nodes.values()) {
        const before = baseNodes.get(node.id);
        if (!before) {
            writes.createGroups.push({
                id: BigInt(node.id),
                parentId: node.parentId === null ? null : BigInt(node.parentId),
                kind: node.kind,
                name: node.name,
                groupKey: node.groupKey,
                multi: node.multi,
                qty: node.qty,
                sortOrder: node.sortOrder,
            });
            summary.push({
                nodeType: node.kind === "SECTION" ? "section" : "group",
                nodeId: node.id,
                name: node.name,
                added: true,
                after: { position: positionOf(node) },
            });
            for (const item of node.items) {
                writes.createItems.push({
                    id: BigInt(item.id),
                    groupId: BigInt(node.id),
                    name: item.name,
                    sortOrder: item.sortOrder,
                });
                summary.push({
                    nodeType: "item",
                    nodeId: item.id,
                    name: item.name,
                    added: true,
                    after: { position: item.sortOrder + 1 },
                });
            }
            continue;
        }
        const changedStatus = before.status !== node.status;
        const changedMulti = before.multi !== node.multi;
        const changedQty = before.qty !== node.qty;
        const changedName = before.name !== node.name;
        const changedPosition = basePositions.get(node.id) !== positionOf(node);
        const changedParent = before.parentId !== node.parentId;
        if (changedStatus || changedMulti || changedQty || changedName || changedPosition || changedParent) {
            writes.updateGroups.push({
                id: BigInt(node.id),
                data: {
                    ...(changedStatus ? { status: node.status } : {}),
                    ...(changedPosition ? { sortOrder: node.sortOrder } : {}),
                    ...(changedMulti ? { multi: node.multi! } : {}),
                    ...(changedQty ? { qty: node.qty! } : {}),
                    ...(changedName ? { name: node.name } : {}),
                    ...(changedParent ? { parentId: node.parentId === null ? null : BigInt(node.parentId) } : {}),
                },
            });
            summary.push({
                nodeType: node.kind === "SECTION" ? "section" : "group",
                nodeId: node.id,
                name: node.name,
                before: {
                    ...(changedStatus ? { status: before.status } : {}),
                    ...(changedMulti ? { multi: before.multi! } : {}),
                    ...(changedQty ? { qty: before.qty! } : {}),
                    ...(changedName ? { name: before.name } : {}),
                    ...(changedPosition ? { position: basePositions.get(node.id) } : {}),
                    ...(changedParent
                        ? {
                              parent: before.parentId === null ? null : (baseNodes.get(before.parentId)?.name ?? null),
                          }
                        : {}),
                },
                after: {
                    ...(changedStatus ? { status: node.status } : {}),
                    ...(changedMulti ? { multi: node.multi! } : {}),
                    ...(changedQty ? { qty: node.qty! } : {}),
                    ...(changedName ? { name: node.name } : {}),
                    ...(changedPosition ? { position: positionOf(node) } : {}),
                    ...(changedParent ? { parent: parentLabelOf(node) } : {}),
                },
            });
            if (changedName && node.kind === "GROUP" && node.groupKey) {
                renamedGroupKeys.push({ groupKey: node.groupKey, name: node.name });
            }
        }
    }

    // 基线节点终态消失 = 删除（分区连带子分组分别登记；物料的删除统一在下方
    // 物料差分按终态定位登记——无论其原分组是否存续，避免「移出后删组」双重写）
    for (const baseNode of base) {
        if (nodes.has(baseNode.id)) {
            continue;
        }
        writes.deleteGroups.push({ id: BigInt(baseNode.id), kind: baseNode.kind });
        summary.push({
            nodeType: baseNode.kind === "SECTION" ? "section" : "group",
            nodeId: baseNode.id,
            name: baseNode.name,
            removed: true,
        });
    }

    // 已存物料差分：物料可换组（move），须按终态定位表比对而非基线所属组
    const finalItems = new Map<string, { node: CatalogTreeNode; item: CatalogTreeNode["items"][number] }>();
    for (const node of nodes.values()) {
        for (const item of node.items) {
            finalItems.set(item.id, { node, item });
        }
    }
    for (const baseNode of base) {
        if (baseNode.kind !== "GROUP") {
            continue;
        }
        for (const baseItem of baseNode.items) {
            const final = finalItems.get(baseItem.id);
            if (!final) {
                // 终态不存在 = 被删除（单独 remove 或随组/随分区整支）
                writes.deleteItems.push(BigInt(baseItem.id));
                removedItemIds.push(BigInt(baseItem.id));
                summary.push({ nodeType: "item", nodeId: baseItem.id, name: baseItem.name, removed: true });
                continue;
            }
            const changedStatus = baseItem.status !== final.item.status;
            const changedName = baseItem.name !== final.item.name;
            const changedGroup = baseNode.id !== final.node.id;
            const changedPosition = basePositions.get(baseItem.id) !== final.item.sortOrder + 1;
            if (changedStatus && final.item.status === false) {
                hiddenMaterialIds.push(BigInt(baseItem.id));
            }
            if (changedName) {
                renamedItemIds.push(BigInt(baseItem.id));
            }
            if (changedGroup) {
                movedItemIds.push(BigInt(baseItem.id));
            }
            if (changedStatus || changedName || changedGroup || changedPosition) {
                writes.updateItems.push({
                    id: BigInt(baseItem.id),
                    data: {
                        ...(changedStatus ? { status: final.item.status } : {}),
                        ...(changedName ? { name: final.item.name } : {}),
                        ...(changedGroup ? { groupId: BigInt(final.node.id) } : {}),
                        ...(changedPosition ? { sortOrder: final.item.sortOrder } : {}),
                    },
                });
                summary.push({
                    nodeType: "item",
                    nodeId: baseItem.id,
                    name: final.item.name,
                    before: {
                        ...(changedStatus ? { status: baseItem.status } : {}),
                        ...(changedName ? { name: baseItem.name } : {}),
                        ...(changedGroup ? { parent: baseNode.name } : {}),
                        ...(changedPosition ? { position: basePositions.get(baseItem.id) } : {}),
                    },
                    after: {
                        ...(changedStatus ? { status: final.item.status } : {}),
                        ...(changedName ? { name: final.item.name } : {}),
                        ...(changedGroup ? { parent: final.node.name } : {}),
                        ...(changedPosition ? { position: final.item.sortOrder + 1 } : {}),
                    },
                });
            }
        }
    }

    // 独立 add_item（挂到已存分组）的新物料登记；新增分组的新物料已在新增分支登记
    for (const node of nodes.values()) {
        for (const item of node.items) {
            if (baseItemIds.has(item.id) || !baseNodes.has(node.id)) {
                continue;
            }
            writes.createItems.push({
                id: BigInt(item.id),
                groupId: BigInt(node.id),
                name: item.name,
                sortOrder: item.sortOrder,
            });
            summary.push({
                nodeType: "item",
                nodeId: item.id,
                name: item.name,
                added: true,
                after: { position: item.sortOrder + 1 },
            });
        }
    }

    if (summary.length === 0) {
        throw new BadRequestException("操作未产生任何变更");
    }

    return {
        afterTree: [...nodes.values()],
        writes,
        hiddenMaterialIds,
        removedItemIds,
        renamedItemIds,
        movedItemIds,
        renamedGroupKeys,
        summary,
    };
}

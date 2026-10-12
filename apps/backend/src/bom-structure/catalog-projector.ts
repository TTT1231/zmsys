import { BadRequestException } from "@nestjs/common";
import type { CatalogTreeNode } from "./catalog-validator";

/**
 * 结构操作投影器（db-scheme.md §5.4）：把操作序列顺序应用到目录树上，产出
 * 「应用后全树 + 数据库写差分 + 变动节点摘要」。apply 服务与前端草稿投影共用
 * 同一语义（前后端两处实现必须同构）：
 * - 同级顺序恒归一化：兄弟集合按 sortOrder 稳定排序后以 0..n-1 重排，reorder 即
 *   在该序列中与相邻项交换位置（边界不动 = 无操作）；摘要中的「顺序」用 1 起始的
 *   位置而非裸 sortOrder（归一化会压缩序号，位置才是操作人看到的次序）。
 * - 冗余操作（隐藏已隐藏项、恢复已启项、规则未变化）不产生写入也不进摘要。
 * - 草稿节点（tempId）在投影时立即分配真实雪花 id 并登记映射，后续操作可按
 *   tempId 或已存 id 引用；隐藏/恢复只改自身 status，不级联改子节点（可选 =
 *   自身∧祖先启用）。
 */

/** 结构操作（discriminated union；DTO 校验后映射为本类型） */
export type StructureOperation =
    | { type: "add_section"; tempId: string; name: string }
    | {
          type: "add_group";
          tempId: string;
          name: string;
          parentId: string | null;
          multi: boolean;
          qty: boolean;
          isModel?: boolean;
          items?: Array<{ tempId: string; name: string }>;
      }
    | { type: "add_item"; tempId: string; groupId: string; name: string }
    | { type: "hide"; targetType: "section" | "group" | "item"; targetId: string }
    | { type: "restore"; targetType: "section" | "group" | "item"; targetId: string }
    | { type: "reorder"; targetType: "section" | "group" | "item"; targetId: string; direction: "up" | "down" }
    | { type: "set_rules"; groupId: string; multi: boolean; qty: boolean };

/** 变动节点摘要（op_log detail 的 operations 数组元素；只记差异，不复制整树） */
export interface StructureChangeSummary {
    nodeType: "section" | "group" | "item";
    nodeId: string;
    name: string;
    /** 新增节点（nodeId 为本次生成的雪花 id） */
    added?: true;
    before?: { multi?: boolean; qty?: boolean; status?: boolean; position?: number };
    after?: { multi?: boolean; qty?: boolean; status?: boolean; position?: number };
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
        updateGroups: Array<{
            id: bigint;
            data: { status?: boolean; sortOrder?: number; multi?: boolean; qty?: boolean };
        }>;
        updateItems: Array<{ id: bigint; data: { status?: boolean; sortOrder?: number } }>;
    };
    /** 本次由启用转停用的物料（引用计数提示用，不阻断） */
    hiddenMaterialIds: bigint[];
    summary: StructureChangeSummary[];
}

type ChangeFlags = { multi?: boolean; qty?: boolean; status?: boolean; position?: number };

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
                if (op.isModel && usedKeys.has("model")) {
                    throw new BadRequestException("型号组（model）只能有一个，该品类已有型号组");
                }
                const parentId = op.parentId === null ? null : resolve(op.parentId, "上级分区");
                if (parentId !== null && nodes.get(parentId)!.kind !== "SECTION") {
                    throw new BadRequestException("分组只能挂在品类根或分区下");
                }
                const groupKey = op.isModel ? "model" : genGroupKey();
                if (op.isModel) {
                    usedKeys.add("model");
                }
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
                    let found = false;
                    for (const node of nodes.values()) {
                        const item = node.items.find(entry => entry.id === itemId);
                        if (item) {
                            item.status = status;
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        throw new BadRequestException("目标节点不是物料");
                    }
                    break;
                }
                const nodeId = resolve(op.targetId, op.targetType === "section" ? "分区" : "分组");
                const node = nodes.get(nodeId)!;
                const expected = op.targetType === "section" ? "SECTION" : "GROUP";
                if (node.kind !== expected) {
                    throw new BadRequestException(
                        `节点「${node.name}」不是${op.targetType === "section" ? "分区" : "分组"}`,
                    );
                }
                node.status = status;
                break;
            }
            case "reorder": {
                if (op.targetType === "item") {
                    const itemId = resolveItem(op.targetId);
                    let found = false;
                    for (const node of nodes.values()) {
                        const index = node.items.findIndex(item => item.id === itemId);
                        if (index < 0) {
                            continue;
                        }
                        const target = op.direction === "up" ? index - 1 : index + 1;
                        if (target >= 0 && target < node.items.length) {
                            const [moved] = node.items.splice(index, 1);
                            node.items.splice(target, 0, moved!);
                            node.items.forEach((item, order) => {
                                item.sortOrder = order;
                            });
                        }
                        found = true;
                        break;
                    }
                    if (!found) {
                        throw new BadRequestException("目标节点不是物料");
                    }
                    break;
                }
                const nodeId = resolve(op.targetId, op.targetType === "section" ? "分区" : "分组");
                const node = nodes.get(nodeId)!;
                const expected = op.targetType === "section" ? "SECTION" : "GROUP";
                if (node.kind !== expected) {
                    throw new BadRequestException(
                        `节点「${node.name}」不是${op.targetType === "section" ? "分区" : "分组"}`,
                    );
                }
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

    const writes: ProjectionResult["writes"] = { createGroups: [], createItems: [], updateGroups: [], updateItems: [] };
    const summary: StructureChangeSummary[] = [];
    const hiddenMaterialIds: bigint[] = [];

    const positionOf = (node: CatalogTreeNode): number =>
        siblingsOf(node.parentId).findIndex(entry => entry.id === node.id) + 1;

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
        const flags: ChangeFlags = {};
        if (before.status !== node.status) {
            flags.status = node.status;
        }
        if (before.multi !== node.multi) {
            flags.multi = node.multi!;
        }
        if (before.qty !== node.qty) {
            flags.qty = node.qty!;
        }
        if (basePositions.get(node.id) !== positionOf(node)) {
            flags.position = positionOf(node);
        }
        if (Object.keys(flags).length > 0) {
            writes.updateGroups.push({
                id: BigInt(node.id),
                data: {
                    ...(flags.status !== undefined ? { status: node.status } : {}),
                    ...(flags.position !== undefined ? { sortOrder: node.sortOrder } : {}),
                    ...(flags.multi !== undefined ? { multi: node.multi! } : {}),
                    ...(flags.qty !== undefined ? { qty: node.qty! } : {}),
                },
            });
            const after: NonNullable<StructureChangeSummary["after"]> = { ...flags };
            const beforeFlags: ChangeFlags = {};
            if (after.status !== undefined) beforeFlags.status = before.status;
            if (after.multi !== undefined) beforeFlags.multi = before.multi!;
            if (after.qty !== undefined) beforeFlags.qty = before.qty!;
            if (after.position !== undefined) beforeFlags.position = basePositions.get(node.id);
            summary.push({
                nodeType: node.kind === "SECTION" ? "section" : "group",
                nodeId: node.id,
                name: node.name,
                before: beforeFlags,
                after,
            });
        }
    }

    // 已存物料差分：按基线序迭代（基线节点 → 基线物料），摘要顺序确定可读
    for (const baseNode of base) {
        if (baseNode.kind !== "GROUP") {
            continue;
        }
        const node = nodes.get(baseNode.id)!;
        for (const baseItem of baseNode.items) {
            const item = node.items.find(entry => entry.id === baseItem.id)!;
            const flags: ChangeFlags = {};
            if (baseItem.status !== item.status) {
                flags.status = item.status;
                if (item.status === false) {
                    hiddenMaterialIds.push(BigInt(item.id));
                }
            }
            if (basePositions.get(item.id) !== item.sortOrder + 1) {
                flags.position = item.sortOrder + 1;
            }
            if (Object.keys(flags).length > 0) {
                writes.updateItems.push({
                    id: BigInt(item.id),
                    data: {
                        ...(flags.status !== undefined ? { status: item.status } : {}),
                        ...(flags.position !== undefined ? { sortOrder: item.sortOrder } : {}),
                    },
                });
                summary.push({
                    nodeType: "item",
                    nodeId: item.id,
                    name: item.name,
                    before: {
                        ...(flags.status !== undefined ? { status: baseItem.status } : {}),
                        ...(flags.position !== undefined ? { position: basePositions.get(item.id) } : {}),
                    },
                    after: flags,
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

    return { afterTree: [...nodes.values()], writes, hiddenMaterialIds, summary };
}

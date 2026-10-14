import type { BomCatalogNode, StructureOperation } from "@/api";

/**
 * 「BOM 结构」编辑器的本地视图投影：编辑模式 = 服务端目录快照 + 草稿 ops 按序投影
 * （所见即所存——语义与后端 catalog-projector 同构：同级相邻交换、边界不动、
 * 隐藏/恢复只改自身状态、规则即时生效、改名/跨父移动/删除整支即时生效）。
 * 草稿节点（draft）的删除走 ops 手术（连同其子草稿 op 一并摘除，等同从未存在），
 * 已保存节点的删除走 remove op（服务端按 bom_item 引用守卫拒绝被引用项）。
 */
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

const groupOf = (node: BomCatalogNode): ViewGroupNode => ({
    kind: "group",
    id: node.id,
    parentId: node.parentId,
    name: node.name,
    multi: node.multi === true,
    qty: node.qty === true,
    status: node.status !== false,
    items: node.items.map(item => ({ id: item.id, name: item.name, status: item.status !== false })),
});

/** 目录契约的平铺 groups → 嵌套视图（分区带子组；跨品类悬空分组防御性按根展示） */
export function viewTreeOf(groups: BomCatalogNode[]): ViewRoot[] {
    const sections = new Map<string, ViewSectionNode>();
    const roots: ViewRoot[] = [];
    for (const node of groups) {
        if (node.kind === "section") {
            const section: ViewSectionNode = {
                kind: "section",
                id: node.id,
                name: node.name,
                status: node.status !== false,
                groups: [],
            };
            sections.set(node.id, section);
            roots.push(section);
        } else if (node.parentId !== null && sections.has(node.parentId)) {
            sections.get(node.parentId)!.groups.push(groupOf(node));
        } else {
            roots.push(groupOf(node));
        }
    }
    return roots;
}

const cloneTree = (roots: ViewRoot[]): ViewRoot[] =>
    roots.map(root =>
        root.kind === "section"
            ? {
                  ...root,
                  groups: root.groups.map(group => ({ ...group, items: group.items.map(item => ({ ...item })) })),
              }
            : { ...root, items: root.items.map(item => ({ ...item })) },
    );

interface TreeIndex {
    roots: ViewRoot[];
    sectionOf: (id: string) => ViewSectionNode | undefined;
    groupOf: (id: string) => { group: ViewGroupNode; siblings: ViewGroupNode[] } | undefined;
    itemOf: (id: string) => { item: ViewItem; siblings: ViewItem[] } | undefined;
}

const indexTree = (roots: ViewRoot[]): TreeIndex => ({
    roots,
    sectionOf: id => roots.find(root => root.kind === "section" && root.id === id) as ViewSectionNode | undefined,
    groupOf: id => {
        for (const root of roots) {
            if (root.kind === "group" && root.id === id) {
                return { group: root, siblings: roots as ViewGroupNode[] };
            }
            if (root.kind === "section") {
                const group = root.groups.find(entry => entry.id === id);
                if (group) {
                    return { group, siblings: root.groups };
                }
            }
        }
        return undefined;
    },
    itemOf: id => {
        for (const root of roots) {
            if (root.kind === "group") {
                const item = root.items.find(entry => entry.id === id);
                if (item) {
                    return { item, siblings: root.items };
                }
            } else {
                for (const group of root.groups) {
                    const item = group.items.find(entry => entry.id === id);
                    if (item) {
                        return { item, siblings: group.items };
                    }
                }
            }
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
                    items: (op.items ?? []).map(item => ({
                        id: item.tempId,
                        name: item.name,
                        status: true,
                        draft: true,
                    })),
                };
                const section = op.parentId === null ? undefined : index.sectionOf(op.parentId);
                if (section) {
                    section.groups.push(group);
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
                const targetSection = op.parentId === null ? undefined : index.sectionOf(op.parentId);
                if (op.parentId !== null && !targetSection) {
                    break; // 目标不是分区（或不存在）：与后端 400 对齐，本地静默忽略
                }
                const [moved] = from.siblings.splice(from.siblings.indexOf(from.group), 1);
                if (!moved) {
                    break;
                }
                moved.parentId = op.parentId;
                if (targetSection) {
                    targetSection.groups.push(moved);
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

/** 统计（编辑器头部的「X 个分组 · Y 项物料」口径：分组 = GROUP 节点，物料 = 叶子项） */
export function statsOf(roots: readonly ViewRoot[]): { groups: number; materials: number } {
    let groups = 0;
    let materials = 0;
    for (const root of roots) {
        if (root.kind === "group") {
            groups += 1;
            materials += root.items.length;
        } else {
            for (const group of root.groups) {
                groups += 1;
                materials += group.items.length;
            }
        }
    }
    return { groups, materials };
}

export interface FlatRow {
    kind: "section" | "group" | "item";
    id: string;
    name: string;
    /** item → 所属分组名；group → 所属分区名（根分组 null）；section → null */
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

/** 平铺行（树渲染与移动弹窗共用的遍历序：分区 → 其分组 → 物料） */
export function flattenTree(roots: readonly ViewRoot[]): FlatRow[] {
    const rows: FlatRow[] = [];
    const rootCount = roots.length;
    roots.forEach((root, rootIndex) => {
        if (root.kind === "group") {
            rows.push({
                kind: "group",
                id: root.id,
                name: root.name,
                holderName: null,
                hidden: !root.status,
                effectivelyHidden: !root.status,
                draft: root.draft === true,
                first: rootIndex === 0,
                last: rootIndex === rootCount - 1,
            });
            root.items.forEach((item, itemIndex) => {
                rows.push({
                    kind: "item",
                    id: item.id,
                    name: item.name,
                    holderName: root.name,
                    hidden: !item.status,
                    effectivelyHidden: !root.status || !item.status,
                    draft: item.draft === true,
                    first: itemIndex === 0,
                    last: itemIndex === root.items.length - 1,
                });
            });
            return;
        }
        rows.push({
            kind: "section",
            id: root.id,
            name: root.name,
            holderName: null,
            hidden: !root.status,
            effectivelyHidden: !root.status,
            draft: root.draft === true,
            first: rootIndex === 0,
            last: rootIndex === rootCount - 1,
        });
        const groupCount = root.groups.length;
        root.groups.forEach((group, groupIndex) => {
            rows.push({
                kind: "group",
                id: group.id,
                name: group.name,
                holderName: root.name,
                hidden: !group.status,
                effectivelyHidden: !root.status || !group.status,
                draft: group.draft === true,
                first: groupIndex === 0,
                last: groupIndex === groupCount - 1,
            });
            group.items.forEach((item, itemIndex) => {
                rows.push({
                    kind: "item",
                    id: item.id,
                    name: item.name,
                    holderName: group.name,
                    hidden: !item.status,
                    effectivelyHidden: !root.status || !group.status || !item.status,
                    draft: item.draft === true,
                    first: itemIndex === 0,
                    last: itemIndex === group.items.length - 1,
                });
            });
        });
    });
    return rows;
}

/** 同品类内分区与分组共享名称命名空间（与后端 uk_material_group_name 一致）；
 *  物料名按组内唯一校验。返回冲突名（null = 无冲突） */
export function conflictingNodeName(roots: readonly ViewRoot[], name: string, exceptId?: string): string | null {
    const taken = new Set<string>();
    for (const root of roots) {
        if (root.id !== exceptId) {
            taken.add(root.name);
        }
        if (root.kind === "section") {
            for (const group of root.groups) {
                if (group.id !== exceptId) {
                    taken.add(group.name);
                }
            }
        }
    }
    return taken.has(name) ? name : null;
}

/** 组内物料重名（新增/改名物料校验）；返回冲突名（null = 无冲突） */
export function conflictingItemName(
    roots: readonly ViewRoot[],
    groupId: string,
    name: string,
    exceptId?: string,
): string | null {
    for (const root of roots) {
        const groups = root.kind === "group" ? [root] : root.groups;
        for (const group of groups) {
            if (group.id !== groupId) {
                continue;
            }
            const taken = group.items.some(item => item.name === name && item.id !== exceptId);
            return taken ? name : null;
        }
    }
    return null;
}

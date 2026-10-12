import type { BomCatalogNode, DraftNodeInput, StructureOperation } from "@/api";

/**
 * 「BOM 结构」编辑器的本地视图投影：编辑模式 = 服务端目录快照 + 草稿 ops 按序投影
 * （所见即所存——语义与后端 catalog-projector 同构：同级相邻交换、边界不动、
 * 隐藏/恢复只改自身状态、规则即时生效）；新建模式 = 草稿树直接构建。
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
    /** groupKey === "model"（型号组，后端生成、不可改） */
    isModel: boolean;
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
    isModel: node.key === "model",
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
                    isModel: op.isModel === true,
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
        }
    }
    return tree;
}

/** 新建模式：草稿平铺树 → 视图（全部 draft，可增删） */
export function viewTreeOfDraft(drafts: readonly DraftNodeInput[]): ViewRoot[] {
    const sections = new Map<string, ViewSectionNode>();
    const roots: ViewRoot[] = [];
    for (const draft of drafts) {
        if (draft.kind === "SECTION") {
            const section: ViewSectionNode = {
                kind: "section",
                id: draft.tempId,
                name: draft.name,
                status: true,
                groups: [],
                draft: true,
            };
            sections.set(draft.tempId, section);
            roots.push(section);
        }
    }
    for (const draft of drafts) {
        if (draft.kind !== "GROUP") {
            continue;
        }
        const group: ViewGroupNode = {
            kind: "group",
            id: draft.tempId,
            parentId: draft.parentTempId ?? null,
            name: draft.name,
            multi: draft.multi ?? false,
            qty: draft.qty ?? false,
            status: true,
            isModel: draft.isModel === true,
            draft: true,
            items: (draft.items ?? []).map(item => ({ id: item.tempId, name: item.name, status: true, draft: true })),
        };
        const section = draft.parentTempId ? sections.get(draft.parentTempId) : undefined;
        if (section) {
            section.groups.push(group);
        } else {
            roots.push(group);
        }
    }
    return roots;
}

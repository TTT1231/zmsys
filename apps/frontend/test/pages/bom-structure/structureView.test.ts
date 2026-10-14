/* structureView 投影（v2 扩展）：rename/move/remove 的本地投影与后端 catalog-projector
 * 同构；草稿删除手术 withoutDraftSubtree 摘除关联 op；重名校验与统计/平铺辅助。 */
import { describe, expect, it } from "vitest";
import type { BomCatalogNode, StructureOperation } from "@/api";
import {
    applyOpsToView,
    conflictingItemName,
    conflictingNodeName,
    flattenTree,
    statsOf,
    viewTreeOf,
    viewPathOf,
    withoutDraftSubtree,
} from "@/pages/bom-structure/structureView";

const group = (
    id: string,
    name: string,
    key: string,
    parentId: string | null,
    items: Array<[string, string]>,
): BomCatalogNode => ({
    id,
    parentId,
    kind: "group",
    name,
    key,
    multi: false,
    qty: false,
    items: items.map(([itemId, itemName]) => ({ id: itemId, name: itemName })),
});
const section = (id: string, name: string): BomCatalogNode => ({
    id,
    parentId: null,
    kind: "section",
    name,
    key: null,
    multi: null,
    qty: null,
    items: [],
});

const snapshot: BomCatalogNode[] = [
    section("s1", "塑料件"),
    group("g1", "外壳", "shell", "s1", [
        ["i1", "上盖"],
        ["i2", "底座"],
    ]),
    group("g2", "触点", "contact", "s1", [["i3", "银点"]]),
    group("g3", "规格", "spec", null, [["i4", "0-2"]]),
];

describe("applyOpsToView v2 操作", () => {
    it("rename：分区/分组/物料改名即时生效", () => {
        const tree = applyOpsToView(viewTreeOf(snapshot), [
            { type: "rename", targetType: "section", targetId: "s1", name: "结构件" },
            { type: "rename", targetType: "group", targetId: "g1", name: "壳体" },
            { type: "rename", targetType: "item", targetId: "i1", name: "上壳" },
        ]);
        const rows = flattenTree(tree);
        expect(rows.map(row => row.name)).toContain("结构件");
        expect(rows.map(row => row.name)).toContain("壳体");
        expect(rows.map(row => row.name)).toContain("上壳");
        expect(rows.map(row => row.name)).not.toContain("塑料件");
    });

    it("move：分组换分区并追加到末位，物料换分组", () => {
        const tree = applyOpsToView(viewTreeOf(snapshot), [
            { type: "move", targetType: "group", targetId: "g3", parentId: "s1" },
            { type: "move", targetType: "item", targetId: "i3", parentId: "g1" },
        ]);
        const plastic = tree.find(root => root.kind === "section")!;
        expect(plastic.kind === "section" && plastic.groups.map(g => g.id)).toEqual(["g1", "g2", "g3"]);
        // 根级不再有 g3
        expect(tree.some(root => root.kind === "group" && root.id === "g3")).toBe(false);
        // i3 从 触点 挪到 外壳 末位
        const shell = flattenTree(tree).find(row => row.id === "g1");
        expect(shell?.holderName).toBe("塑料件");
        const items = tree
            .flatMap(root => (root.kind === "section" ? root.groups : [root]))
            .find(node => node.id === "g1")!;
        expect(items.items.map(item => item.id)).toEqual(["i1", "i2", "i3"]);
    });

    it("remove：物料/分组/分区整支删除；后续引用同 id 的操作被忽略", () => {
        const tree = applyOpsToView(viewTreeOf(snapshot), [
            { type: "remove", targetType: "section", targetId: "s1" },
            { type: "hide", targetType: "group", targetId: "g1" }, // 已随分区删除：无操作
        ]);
        expect(tree).toHaveLength(1);
        expect(tree[0]!.kind).toBe("group");
        expect(statsOf(tree)).toEqual({ groups: 1, materials: 1 });
    });

    it("草稿增改删除一条龙：add → rename → remove（草稿）→ ops 手术等同从未存在", () => {
        const operations: StructureOperation[] = [
            { type: "add_section", tempId: "t-sec", name: "新区" },
            {
                type: "add_group",
                tempId: "t-grp",
                name: "新组",
                parentId: "t-sec",
                multi: false,
                qty: false,
                items: [{ tempId: "t-it", name: "新物料" }],
            },
            { type: "set_rules", groupId: "t-grp", multi: true, qty: false },
            { type: "rename", targetType: "group", targetId: "t-grp", name: "改名组" },
        ];
        const withDraft = applyOpsToView(viewTreeOf(snapshot), operations);
        expect(statsOf(withDraft)).toEqual({ groups: 4, materials: 5 });
        expect(withDraft.some(root => root.kind === "section" && root.name === "新区")).toBe(true);

        const surgically = withoutDraftSubtree(operations, "t-sec");
        expect(surgically).toEqual([]);
        expect(statsOf(applyOpsToView(viewTreeOf(snapshot), surgically))).toEqual({ groups: 3, materials: 4 });
    });

    it("withoutDraftSubtree 只动草稿子树，不动已保存节点的操作", () => {
        const operations: StructureOperation[] = [
            { type: "add_group", tempId: "t-grp", name: "新组", parentId: "s1", multi: false, qty: false },
            { type: "add_item", tempId: "t-it", groupId: "t-grp", name: "新物料" },
            { type: "hide", targetType: "item", targetId: "i1" },
            { type: "rename", targetType: "group", targetId: "g1", name: "壳体" },
        ];
        const rest = withoutDraftSubtree(operations, "t-grp");
        expect(rest).toEqual([
            { type: "hide", targetType: "item", targetId: "i1" },
            { type: "rename", targetType: "group", targetId: "g1", name: "壳体" },
        ]);
    });
});

it("多层目录按父引用重建、操作递归生效，隐藏祖先传递到直属及后代物料", () => {
    const tree = viewTreeOf([
        group("D", "D", "d", "B", [["e", "e"]]),
        group("A", "A", "a", null, [["c", "c"]]),
        group("B", "B", "b", "A", []),
    ]);
    expect(flattenTree(tree).map(row => row.id)).toEqual(["A", "c", "B", "D", "e"]);
    expect(viewPathOf(tree, "e").map(node => node.name)).toEqual(["A", "B", "D"]);
    const projected = applyOpsToView(tree, [
        { type: "add_group", tempId: "F", name: "F", parentId: "B", multi: false, qty: false },
        { type: "move", targetType: "group", targetId: "D", parentId: "F" },
        { type: "add_item", tempId: "f", name: "f", groupId: "A" },
        { type: "hide", targetType: "group", targetId: "A" },
    ]);
    expect(viewPathOf(projected, "e").map(node => node.name)).toEqual(["A", "B", "F", "D"]);
    expect(statsOf(projected)).toEqual({ groups: 4, materials: 3 });
    expect(conflictingNodeName(projected, "D")).toBe("D");
    expect(conflictingItemName(projected, "D", "e")).toBe("e");
    expect(
        flattenTree(projected)
            .filter(row => row.kind === "item")
            .every(row => row.effectivelyHidden),
    ).toBe(true);
    expect(flattenTree(projected).find(row => row.id === "e")?.hidden).toBe(false);
    const removed = applyOpsToView(projected, [{ type: "remove", targetType: "group", targetId: "B" }]);
    expect(flattenTree(removed).map(row => row.id)).toEqual(["A", "c", "f"]);
    expect(
        flattenTree(applyOpsToView(tree, [{ type: "move", targetType: "group", targetId: "A", parentId: "D" }])).map(
            row => row.id,
        ),
    ).toEqual(["A", "c", "B", "D", "e"]);
});

describe("重名校验与辅助", () => {
    it("分区与分组共享命名空间；物料按组内校验", () => {
        const tree = viewTreeOf(snapshot);
        expect(conflictingNodeName(tree, "外壳")).toBe("外壳");
        expect(conflictingNodeName(tree, "塑料件")).toBe("塑料件");
        expect(conflictingNodeName(tree, "全新分组")).toBeNull();
        expect(conflictingNodeName(tree, "外壳", "g1")).toBeNull();
        expect(conflictingItemName(tree, "g1", "上盖")).toBe("上盖");
        expect(conflictingItemName(tree, "g2", "上盖")).toBeNull();
        expect(conflictingItemName(tree, "g1", "上盖", "i1")).toBeNull();
    });

    it("flattenTree：遍历序、首末位与归属名", () => {
        const rows = flattenTree(viewTreeOf(snapshot));
        expect(rows.map(row => row.id)).toEqual(["s1", "g1", "i1", "i2", "g2", "i3", "g3", "i4"]);
        expect(rows[0]).toMatchObject({ first: true, last: false, holderName: null });
        expect(rows[2]).toMatchObject({ holderName: "外壳", first: true, last: false });
        expect(rows.find(row => row.id === "g3")).toMatchObject({ holderName: null, first: false, last: true });
    });
});

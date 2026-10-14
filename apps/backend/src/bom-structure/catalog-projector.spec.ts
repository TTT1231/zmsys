/* 结构操作投影器：写差分、变动摘要前后值、冗余操作无变更、草稿 tempId 链、
 * 边界移动容忍、键生成避开保留键与输入防御；分组嵌套（挂任意父、循环移动
 * 静默忽略、整支删除叶先于父）。 */
import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { projectStructure, type StructureOperation } from "./catalog-projector";
import type { CatalogTreeNode } from "./catalog-validator";

let seq = 9000000000000000n;
const genId = () => ++seq;

const base: CatalogTreeNode[] = [
    {
        id: "2001",
        parentId: null,
        kind: "GROUP",
        name: "型号",
        groupKey: "model",
        multi: false,
        qty: false,
        sortOrder: 0,
        status: true,
        items: [
            { id: "3000", name: "0-1", sortOrder: 0, status: true },
            { id: "3001", name: "0-2", sortOrder: 1, status: true },
            { id: "3002", name: "0-3", sortOrder: 2, status: true },
        ],
    },
    {
        id: "2002",
        parentId: null,
        kind: "GROUP",
        name: "A面",
        groupKey: "face-a",
        multi: true,
        qty: false,
        sortOrder: 1,
        status: true,
        items: [
            { id: "3003", name: "a1", sortOrder: 0, status: true },
            { id: "3004", name: "a2", sortOrder: 1, status: true },
        ],
    },
    {
        id: "2600",
        parentId: null,
        kind: "SECTION",
        name: "触点",
        groupKey: null,
        multi: null,
        qty: null,
        sortOrder: 2,
        status: true,
        items: [],
    },
    {
        id: "2601",
        parentId: "2600",
        kind: "GROUP",
        name: "触点大小",
        groupKey: "contact-size",
        multi: false,
        qty: false,
        sortOrder: 0,
        status: true,
        items: [{ id: "3005", name: "大", sortOrder: 0, status: true }],
    },
];

describe("projectStructure", () => {
    it("隐藏物料：updateItems 差分 + 引用提示集合 + 摘要前后值；不动分组", () => {
        const result = projectStructure(base, [{ type: "hide", targetType: "item", targetId: "3001" }], genId);
        expect(result.writes.updateItems).toEqual([{ id: 3001n, data: { status: false } }]);
        expect(result.writes.updateGroups).toEqual([]);
        expect(result.hiddenMaterialIds).toEqual([3001n]);
        expect(result.summary).toEqual([
            { nodeType: "item", nodeId: "3001", name: "0-2", before: { status: true }, after: { status: false } },
        ]);
    });

    it("隐藏后恢复抵消、规则原值重设：未产生任何变更即 400", () => {
        const ops: StructureOperation[] = [
            { type: "hide", targetType: "item", targetId: "3001" },
            { type: "restore", targetType: "item", targetId: "3001" },
        ];
        expect(() => projectStructure(base, ops, genId)).toThrow(new BadRequestException("操作未产生任何变更"));
        expect(() =>
            projectStructure(base, [{ type: "set_rules", groupId: "2002", multi: true, qty: false }], genId),
        ).toThrow(new BadRequestException("操作未产生任何变更"));
    });

    it("连续下移：位置摘要 2→3 / 3→2，sortOrder 差分仅含变动物料", () => {
        const result = projectStructure(
            base,
            [
                { type: "reorder", targetType: "item", targetId: "3001", direction: "down" },
                { type: "reorder", targetType: "item", targetId: "3001", direction: "down" },
            ],
            genId,
        );
        // [0-1,0-2,0-3] → 第二次下移到边界为无操作：0-2 位置 2→3、0-3 3→2
        expect(result.summary).toEqual([
            { nodeType: "item", nodeId: "3001", name: "0-2", before: { position: 2 }, after: { position: 3 } },
            { nodeType: "item", nodeId: "3002", name: "0-3", before: { position: 3 }, after: { position: 2 } },
        ]);
        const sortById = new Map(
            result.writes.updateItems.map(update => [update.id.toString(), update.data.sortOrder]),
        );
        expect(sortById.get("3001")).toBe(2);
        expect(sortById.get("3002")).toBe(1);
        expect(sortById.has("3000")).toBe(false);
    });

    it("首位上移容忍为无操作，不产生该节点的写入", () => {
        const result = projectStructure(
            base,
            [
                { type: "reorder", targetType: "item", targetId: "3000", direction: "up" },
                { type: "hide", targetType: "item", targetId: "3004" },
            ],
            genId,
        );
        expect(result.writes.updateItems).toEqual([{ id: 3004n, data: { status: false } }]);
    });

    it("草稿链：新增分区 → 分组（含物料）→ 追加物料；groupKey 避开保留键", () => {
        const result = projectStructure(
            base,
            [
                { type: "add_section", tempId: "t-sec", name: "弹静片区" },
                {
                    type: "add_group",
                    tempId: "t-grp",
                    name: "弹静片",
                    parentId: "t-sec",
                    multi: false,
                    qty: false,
                    items: [{ tempId: "t-i1", name: "动弹静片" }],
                },
                { type: "add_item", tempId: "t-i2", groupId: "t-grp", name: "静弹静片" },
            ],
            genId,
            new Set(["g1", "model"]),
        );
        const sec = result.afterTree.find(node => node.name === "弹静片区")!;
        const grp = result.afterTree.find(node => node.name === "弹静片")!;
        expect(sec.kind).toBe("SECTION");
        expect(grp.parentId).toBe(sec.id);
        expect(grp.groupKey).toBe("g2"); // g1 被伙伴品类保留键占用
        expect(grp.items.map(item => item.name)).toEqual(["动弹静片", "静弹静片"]);
        expect(result.writes.createGroups.map(row => [row.name, row.parentId])).toEqual([
            ["弹静片区", null],
            ["弹静片", BigInt(sec.id)],
        ]);
        expect(result.writes.createItems).toHaveLength(2);
        expect(result.summary.filter(entry => entry.added).map(entry => [entry.nodeType, entry.name])).toEqual([
            ["section", "弹静片区"],
            ["group", "弹静片"],
            ["item", "动弹静片"],
            ["item", "静弹静片"],
        ]);
    });

    it("规则修改产出 multi/qty 前后值", () => {
        const result = projectStructure(base, [{ type: "set_rules", groupId: "2002", multi: false, qty: true }], genId);
        expect(result.writes.updateGroups).toEqual([{ id: 2002n, data: { multi: false, qty: true } }]);
        expect(result.summary).toEqual([
            {
                nodeType: "group",
                nodeId: "2002",
                name: "A面",
                before: { multi: true, qty: false },
                after: { multi: false, qty: true },
            },
        ]);
    });

    it("未知目标 / 重复草稿标识 / 物料目标给成分组均 400；分组挂分组合法", () => {
        expect(() => projectStructure(base, [{ type: "hide", targetType: "item", targetId: "nope" }], genId)).toThrow(
            BadRequestException,
        );
        expect(() =>
            projectStructure(
                base,
                [
                    { type: "add_section", tempId: "dup", name: "A" },
                    { type: "add_section", tempId: "dup", name: "B" },
                ],
                genId,
            ),
        ).toThrow(new BadRequestException("草稿标识「dup」重复"));
        // 分组挂分组（嵌套目录）：createGroups 差分带分组父 id
        const nested = projectStructure(
            base,
            [{ type: "add_group", tempId: "t", name: "嵌套组", parentId: "2001", multi: false, qty: false }],
            genId,
        );
        expect(nested.writes.createGroups.map(row => [row.name, row.parentId])).toEqual([["嵌套组", 2001n]]);
        expect(nested.afterTree.find(node => node.name === "嵌套组")!.parentId).toBe("2001");
        expect(() => projectStructure(base, [{ type: "hide", targetType: "item", targetId: "2002" }], genId)).toThrow(
            new BadRequestException("目标节点不是物料"),
        );
    });

    it("嵌套目录：分组挂分组、循环移动静默忽略、移动进分组带归属摘要", () => {
        const result = projectStructure(
            base,
            [
                { type: "add_group", tempId: "t-l1", name: "一级壳", parentId: "2601", multi: false, qty: false },
                {
                    type: "add_group",
                    tempId: "t-l2",
                    name: "二级壳",
                    parentId: "t-l1",
                    multi: true,
                    qty: false,
                    items: [{ tempId: "t-i", name: "嵌套物料" }],
                },
                // 循环移动：把 2601（触点大小）移入自己的后代 t-l2 —— 静默忽略
                { type: "move", targetType: "group", targetId: "2601", parentId: "t-l2" },
            ],
            genId,
        );
        const l1 = result.afterTree.find(node => node.name === "一级壳")!;
        const l2 = result.afterTree.find(node => node.name === "二级壳")!;
        expect(l1.parentId).toBe("2601");
        expect(l2.parentId).toBe(l1.id);
        // 循环移动未生效：触点大小仍挂分区 2600 下
        expect(result.afterTree.find(node => node.id === "2601")!.parentId).toBe("2600");
        expect(result.writes.createGroups.map(row => [row.name, row.parentId])).toEqual([
            ["一级壳", 2601n],
            ["二级壳", BigInt(l1.id)],
        ]);
        // 已存分组移入另一分组：parentId 差分 + 归属前后值摘要
        const moved = projectStructure(
            base,
            [
                { type: "add_group", tempId: "t-h", name: "壳", parentId: null, multi: false, qty: false },
                { type: "move", targetType: "group", targetId: "2601", parentId: "t-h" },
            ],
            genId,
        );
        const holder = moved.afterTree.find(node => node.name === "壳")!;
        // 移动前后都是父下唯一子节点（position 恒 1），差分只含改挂
        expect(moved.writes.updateGroups).toEqual([{ id: 2601n, data: { parentId: BigInt(holder.id) } }]);
        expect(moved.summary).toContainEqual({
            nodeType: "group",
            nodeId: "2601",
            name: "触点大小",
            before: { parent: "触点" },
            after: { parent: "壳" },
        });
    });

    it("嵌套删除：删分组连带多层子分组整支，删除序叶先于父", () => {
        const planted = projectStructure(
            base,
            [
                { type: "add_group", tempId: "t-l1", name: "一级壳", parentId: "2601", multi: false, qty: false },
                {
                    type: "add_group",
                    tempId: "t-l2",
                    name: "二级壳",
                    parentId: "t-l1",
                    multi: true,
                    qty: false,
                    items: [{ tempId: "t-i", name: "嵌套物料" }],
                },
            ],
            genId,
        );
        const l1 = planted.afterTree.find(node => node.name === "一级壳")!;
        const l2 = planted.afterTree.find(node => node.name === "二级壳")!;
        const removed = projectStructure(
            planted.afterTree,
            [{ type: "remove", targetType: "group", targetId: "2601" }],
            genId,
        );
        // 触点大小 + 一级壳 + 二级壳整支消失，叶先于父
        expect(removed.writes.deleteGroups).toEqual([
            { id: BigInt(l2.id), kind: "GROUP" },
            { id: BigInt(l1.id), kind: "GROUP" },
            { id: 2601n, kind: "GROUP" },
        ]);
        expect(removed.afterTree.some(node => node.name === "一级壳" || node.name === "二级壳")).toBe(false);
        // 分区删除同样整支：连带其下分组（含嵌套支），删除序子先于父
        const sectionRemoved = projectStructure(
            planted.afterTree,
            [{ type: "remove", targetType: "section", targetId: "2600" }],
            genId,
        );
        expect(sectionRemoved.writes.deleteGroups).toEqual([
            { id: BigInt(l2.id), kind: "GROUP" },
            { id: BigInt(l1.id), kind: "GROUP" },
            { id: 2601n, kind: "GROUP" },
            { id: 2600n, kind: "SECTION" },
        ]);
    });

    it("v2 移出后删组：物料只落改挂差分，不进 deleteItems/removedItemIds（被引用物料合法保留）", () => {
        const result = projectStructure(
            base,
            [
                { type: "move", targetType: "item", targetId: "3003", parentId: "2001" },
                { type: "remove", targetType: "group", targetId: "2002" },
            ],
            genId,
        );
        expect(result.writes.deleteGroups).toEqual([{ id: 2002n, kind: "GROUP" }]);
        // a2 随组消亡（进删除集合 + 引用守卫集合），a1 已移出合法保留
        expect(result.writes.deleteItems).toEqual([3004n]);
        expect(result.removedItemIds).toEqual([3004n]);
        expect(result.movedItemIds).toEqual([3003n]);
        // a1 换组且随终态归一到型号组末位（position 4 → sortOrder 3）
        expect(result.writes.updateItems).toEqual([{ id: 3003n, data: { groupId: 2001n, sortOrder: 3 } }]);
    });

    it("v2 单独删除物料：deleteItems + 引用守卫集合 + removed 摘要", () => {
        const result = projectStructure(base, [{ type: "remove", targetType: "item", targetId: "3005" }], genId);
        expect(result.writes.deleteItems).toEqual([3005n]);
        expect(result.removedItemIds).toEqual([3005n]);
        expect(result.summary).toEqual([{ nodeType: "item", nodeId: "3005", name: "大", removed: true }]);
    });

    it("v2 删分区连带子分组整支登记；同批删组后新建分组派生新键", () => {
        const cascaded = projectStructure(base, [{ type: "remove", targetType: "section", targetId: "2600" }], genId);
        // 删除序叶先于父（自引用外键 RESTRICT）
        expect(cascaded.writes.deleteGroups).toEqual([
            { id: 2601n, kind: "GROUP" },
            { id: 2600n, kind: "SECTION" },
        ]);
        expect(cascaded.writes.deleteItems).toEqual([3005n]);
        expect(cascaded.removedItemIds).toEqual([3005n]);

        const released = projectStructure(
            base,
            [
                { type: "remove", targetType: "group", targetId: "2001" },
                {
                    type: "add_group",
                    tempId: "t-m",
                    name: "新型号",
                    parentId: null,
                    multi: false,
                    qty: false,
                },
            ],
            genId,
        );
        expect(released.writes.deleteGroups).toEqual([{ id: 2001n, kind: "GROUP" }]);
        expect(released.writes.deleteItems).toEqual([3000n, 3001n, 3002n]);
        const replacement = released.afterTree.find(node => node.name === "新型号")!;
        expect(replacement.groupKey).toBe("g1");
    });

    it("v2 同批换名环链产出双向 name 前后值（写侧两阶段落库不撞 uk）", () => {
        const result = projectStructure(
            base,
            [
                { type: "rename", targetType: "group", targetId: "2002", name: "触点大小" },
                { type: "rename", targetType: "group", targetId: "2601", name: "A面" },
            ],
            genId,
        );
        expect(result.writes.updateGroups).toEqual([
            { id: 2002n, data: { name: "触点大小" } },
            { id: 2601n, data: { name: "A面" } },
        ]);
        expect(result.renamedGroupKeys).toEqual([
            { groupKey: "face-a", name: "触点大小" },
            { groupKey: "contact-size", name: "A面" },
        ]);
    });

    it("v2 分组跨分区移动：parentId 差分 + 归属前后值摘要", () => {
        const result = projectStructure(
            base,
            [{ type: "move", targetType: "group", targetId: "2601", parentId: null }],
            genId,
        );
        // 根序 [型号, A面, 触点, 触点大小→末位]：位置 1 → 4
        expect(result.writes.updateGroups).toEqual([{ id: 2601n, data: { parentId: null, sortOrder: 3 } }]);
        expect(result.summary).toEqual([
            {
                nodeType: "group",
                nodeId: "2601",
                name: "触点大小",
                before: { parent: "触点", position: 1 },
                after: { parent: null, position: 4 },
            },
        ]);
    });
});

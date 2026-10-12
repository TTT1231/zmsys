/* 结构操作投影器：写差分、变动摘要前后值、冗余操作无变更、草稿 tempId 链、
 * 边界移动容忍、键生成避开保留键与输入防御。 */
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

    it("重复型号组 400；规则修改产出 multi/qty 前后值", () => {
        expect(() =>
            projectStructure(
                base,
                [
                    {
                        type: "add_group",
                        tempId: "t",
                        name: "型号2",
                        parentId: null,
                        multi: false,
                        qty: false,
                        isModel: true,
                    },
                ],
                genId,
            ),
        ).toThrow(new BadRequestException("型号组（model）只能有一个，该品类已有型号组"));
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

    it("未知目标 / 重复草稿标识 / 分组挂分组 / 物料目标给成分组均 400", () => {
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
        expect(() =>
            projectStructure(
                base,
                [{ type: "add_group", tempId: "t", name: "X", parentId: "2001", multi: false, qty: false }],
                genId,
            ),
        ).toThrow(new BadRequestException("分组只能挂在品类根或分区下"));
        expect(() => projectStructure(base, [{ type: "hide", targetType: "item", targetId: "2002" }], genId)).toThrow(
            new BadRequestException("目标节点不是物料"),
        );
    });
});

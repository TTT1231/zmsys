/* 目录结构校验器：层级契约（分区仅根/分组可嵌套且分支含物料层 ≤5/物料挂分组）、
 * 无环、品类内唯一、组内物料名唯一；复合目录伙伴键冲突与编码前缀数字延长校验。 */
import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import {
    assertGroupKeysExclusive,
    assertPrefixSafe,
    validateCatalogTree,
    type CatalogTreeNode,
} from "./catalog-validator";

const group = (id: string, name: string, key: string, parentId: string | null = null): CatalogTreeNode => ({
    id,
    parentId,
    kind: "GROUP",
    name,
    groupKey: key,
    multi: false,
    qty: false,
    sortOrder: 0,
    status: true,
    items: [],
});
const section = (id: string, name: string): CatalogTreeNode => ({
    id,
    parentId: null,
    kind: "SECTION",
    name,
    groupKey: null,
    multi: null,
    qty: null,
    sortOrder: 0,
    status: true,
    items: [],
});

describe("validateCatalogTree", () => {
    it("合法两级树通过：根分组 + 分区下分组 + 组内物料", () => {
        expect(() =>
            validateCatalogTree([
                { ...group("2001", "型号", "model"), items: [{ id: "3001", name: "0-2", sortOrder: 0, status: true }] },
                section("2600", "触点"),
                {
                    ...group("2601", "触点大小", "contact-size", "2600"),
                    items: [{ id: "3005", name: "大", sortOrder: 0, status: true }],
                },
            ]),
        ).not.toThrow();
    });

    it("分区挂子节点 / 分区带规则 / 分组缺规则 400；分组挂分组合法", () => {
        expect(() =>
            validateCatalogTree([{ ...section("2600", "触点"), parentId: "2001" }, group("2001", "型号", "model")]),
        ).toThrow(new BadRequestException("分区「触点」只能作为根节点，不能挂在其他节点下"));
        expect(() =>
            validateCatalogTree([{ ...section("2600", "触点"), groupKey: "x", multi: false, qty: false }]),
        ).toThrow(new BadRequestException("分区「触点」不携带选择规则，也不能直接挂物料"));
        // 分组挂分组（嵌套目录）合法，层级上限另测
        expect(() =>
            validateCatalogTree([group("2001", "型号", "model"), group("2002", "型号2", "model2", "2001")]),
        ).not.toThrow();
        expect(() => validateCatalogTree([{ ...group("2002", "A面", "face-a"), multi: null }])).toThrow(
            new BadRequestException("分组「A面」缺少选择规则（groupKey/multi/qty）"),
        );
    });

    it("层级上限：分支可见层数（含物料层）≤5；同名单选折叠不占层、超限 400", () => {
        const chain = (deepestItems: CatalogTreeNode["items"]): CatalogTreeNode[] => [
            section("2600", "分区"),
            group("2601", "一级", "g1", "2600"),
            group("2602", "二级", "g2", "2601"),
            { ...group("2603", "三级", "g3", "2602"), items: deepestItems },
        ];
        // 分区(1) + 分组(2,3,4) + 物料(5) = 5 层，合法
        expect(() => chain([{ id: "3005", name: "物料", sortOrder: 0, status: true }])).not.toThrow();
        // 空分组占第 5 层仍合法（与编辑器移动口径一致）；其内物料落到第 6 层 → 400
        expect(() => validateCatalogTree([...chain([]), group("2604", "四级", "g4", "2603")])).not.toThrow();
        expect(() =>
            validateCatalogTree([
                ...chain([]),
                {
                    ...group("2604", "四级", "g4", "2603"),
                    items: [{ id: "3005", name: "物料", sortOrder: 0, status: true }],
                },
            ]),
        ).toThrow(new BadRequestException("「分区」分支超过 5 层上限（含物料层），请减少嵌套"));
        // 同名单选折叠：第 5 层分组内唯一与组同名的物料不额外占层，合法
        expect(() =>
            validateCatalogTree([
                ...chain([]),
                {
                    ...group("2604", "四级", "g4", "2603"),
                    items: [{ id: "3005", name: "四级", sortOrder: 0, status: true }],
                },
            ]),
        ).not.toThrow();
        // 折叠口径只认单选：多选组的同名唯一物料照常占层 → 400
        expect(() =>
            validateCatalogTree([
                ...chain([]),
                {
                    ...group("2604", "四级", "g4", "2603"),
                    multi: true,
                    items: [{ id: "3005", name: "四级", sortOrder: 0, status: true }],
                },
            ]),
        ).toThrow(BadRequestException);
    });

    it("悬空父引用 400（防跨品类挂接与误删引用）", () => {
        expect(() => validateCatalogTree([group("2002", "触点大小", "contact-size", "missing")])).toThrow(
            new BadRequestException("分组「触点大小」的父节点不存在"),
        );
    });

    it("品类内组名 / groupKey / 组内物料名重复与双型号组均 400", () => {
        // v2 起分区与分组共享名称命名空间（uk_material_group_name 覆盖两类节点）
        expect(() => validateCatalogTree([group("2001", "A面", "a"), group("2002", "A面", "b")])).toThrow(
            new BadRequestException("名称「A面」重复（与「A面」同名，同品类内分区与分组不能重名）"),
        );
        expect(() => validateCatalogTree([section("2700", "结构分区"), group("2002", "结构分区", "x")])).toThrow(
            new BadRequestException("名称「结构分区」重复（与「结构分区」同名，同品类内分区与分组不能重名）"),
        );
        expect(() => validateCatalogTree([group("2001", "A面", "face"), group("2002", "B面", "face")])).toThrow(
            new BadRequestException("分组「B面」的内部 key 与「A面」冲突"),
        );
        // 双 model 组：等价 groupKey 先命中键冲突（model 唯一性检查是不可达的纵深防御，
        // add_group 的 isModel 分支给出更友好的「型号组只能有一个」）
        expect(() =>
            validateCatalogTree([{ ...group("2001", "型号", "model") }, { ...group("2002", "新型号", "model") }]),
        ).toThrow(new BadRequestException("分组「新型号」的内部 key 与「型号」冲突"));
        expect(() =>
            validateCatalogTree([
                {
                    ...group("2001", "A面", "face-a"),
                    items: [
                        { id: "3001", name: "同物", sortOrder: 0, status: true },
                        { id: "3002", name: "同物", sortOrder: 1, status: true },
                    ],
                },
            ]),
        ).toThrow(new BadRequestException("分组「A面」内物料名「同物」重复"));
    });
});

describe("assertGroupKeysExclusive", () => {
    it("与复合伙伴品类键交集即 400（消息带伙伴品类名），无交集通过", () => {
        const own = new Set(["base", "shared"]);
        const partners = new Map([["焊线", new Set(["shared", "wire"])]]);
        expect(() => assertGroupKeysExclusive(own, partners)).toThrow(
            new BadRequestException("分组内部 key「shared」与共用目录的品类「焊线」冲突，请调整分组"),
        );
        expect(() => assertGroupKeysExclusive(new Set(["base"]), partners)).not.toThrow();
    });
});

describe("assertPrefixSafe", () => {
    it("数字延长双向拒绝：XK21 对 XK2、XK2 对既有 XK21", () => {
        expect(() => assertPrefixSafe("XK21", ["XK2"])).toThrow(BadRequestException);
        expect(() => assertPrefixSafe("XK2", ["XK21"])).toThrow(BadRequestException);
    });

    it("字母尾差合法（KW/KWO、XK3/XK3W）；相同前缀交由唯一键口径", () => {
        expect(() => assertPrefixSafe("KWO", ["KW"])).not.toThrow();
        expect(() => assertPrefixSafe("XK3W", ["XK3"])).not.toThrow();
        expect(() => assertPrefixSafe("KW", ["KW"])).not.toThrow();
    });
});

/* 物料目录种子与派生：3 品类树、目录序物料行、摘要拼接、编码自增 */
import { describe, expect, it } from "vitest";

import { bomSpecOfItems, BOM_CATEGORIES, catalogRowsOf, categoryOf, nextBomCode } from "@/data/categories";

/* 构造带品类名的编码列表（nextBomCode 按品类过滤后再取序号） */
const of = (name: string, ...codes: string[]) => codes.map(code => ({ code, name }));
/* 页面把接口下发的品类对象直接传入，这里用种子目录模拟 */
const cat = (name: string) => categoryOf(name)!;

describe("categoryOf", () => {
    it("系统共 6 个品类：旋转XK2 / 旋转XK3 / 新微动 / 老微动 / 安全开关 / 跌倒开关", () => {
        expect(BOM_CATEGORIES.map(category => category.key)).toEqual([
            "rotary-switch",
            "rotary-xk3",
            "new-micro-switch",
            "old-micro-switch",
            "safety-switch",
            "tipover-switch",
        ]);
        expect(cat("旋转XK2").codePrefix).toBe("XK2");
        expect(categoryOf("琴键开关")).toBeUndefined();
        expect(categoryOf("旋转XK3")!.codePrefix).toBe("XK3");
        expect(categoryOf("安全开关")!.codePrefix).toBe("AQ");
        expect(categoryOf("跌倒开关")!.codePrefix).toBe("KD");
        expect(categoryOf("跌倒开关")!.childCategories).toEqual(["new-micro-switch", "old-micro-switch"]);
        expect(categoryOf("新微动")!.childCategories).toBeUndefined();
        expect(categoryOf("XK3")).toBeUndefined();
        expect(categoryOf("不存在")).toBeUndefined();
    });

    it("旋转XK2为无分区的单选组；新微动/老微动为 PA66塑料/五金件/触点 分区树", () => {
        const rotary = cat("旋转XK2");
        expect(rotary.groups.map(group => [group.kind, group.name, group.multi])).toEqual([
            ["group", "型号", false],
            ["group", "规格", false],
            ["group", "方向", false],
            ["group", "杆子点位厚度", false],
            ["group", "A面", false],
            ["group", "B面", false],
            ["group", "弹簧", false],
        ]);
        const micro = cat("新微动");
        expect(micro.seqWidth).toBe(4);
        for (const microName of ["新微动", "老微动"]) {
            const target = cat(microName);
            expect(target.groups.filter(node => node.kind === "section").map(node => node.name)).toEqual([
                "PA66塑料",
                "五金件",
                "触点",
            ]);
            const contactItems = (groupName: string) =>
                target.groups
                    .filter(
                        node =>
                            node.kind === "group" && node.parentId === target.groups.find(s => s.name === "触点")!.id,
                    )
                    .find(node => node.name === groupName)!
                    .items.map(item => item.name);
            expect(contactItems("触点大小")).toEqual(["0.3", "0.35"]);
            expect(contactItems("触点厚度")).toEqual(["0.15", "0.2", "0.3"]);
            expect(contactItems("触点类别")).toEqual(["铜", "银"]);
        }
        const bracket = micro.groups.find(node => node.name === "支架")!;
        expect(bracket).toMatchObject({ kind: "group", key: "bracket", multi: false, parentId: "2102" });
        // 完整物料名（含口径与镀层）逐项可选，不再组合
        expect(bracket.items.map(item => item.name)).toEqual([
            "6.3支架：铜镀银",
            "6.3支架：铜镀镍",
            "6.3支架：复合铜镀镍",
            "4.8支架：铜镀镍",
            "4.8支架：复合铜镀镍",
        ]);
    });
});

describe("catalogRowsOf", () => {
    it("按目录序拍平分区→组→物料；分区不产出行、空组无行", () => {
        const rows = catalogRowsOf(cat("新微动"));
        expect(rows.map(row => row.groupName)).toEqual([
            "底座",
            "底座",
            "盖子",
            "按钮",
            "按钮",
            "按钮",
            "按钮",
            "按钮",
            "按钮",
            "按钮",
            "按钮",
            "支架",
            "支架",
            "支架",
            "支架",
            "支架",
            "静片",
            "静片",
            "静片",
            "静片",
            "静片",
            "动片",
            "动片",
            "摆片",
            "摆片",
            "摆片",
            "弹片",
            "弹片",
            "弹片",
            "触点大小",
            "触点大小",
            "触点厚度",
            "触点厚度",
            "触点厚度",
            "触点类别",
            "触点类别",
        ]);
        expect(rows[0]).toEqual({
            id: "3101",
            groupKey: "base",
            groupName: "底座",
            name: "二脚底座（无挡脚）",
        });
    });

    it("旋转XK2目录：型号全集、规格、方向与杆子点位厚度；A面与B面共用 9 项触点选项", () => {
        const rotary = cat("旋转XK2");
        const itemsOf = (groupName: string) =>
            rotary.groups.find(node => node.name === groupName)!.items.map(item => item.name);
        expect(itemsOf("型号")).toHaveLength(21);
        expect(itemsOf("型号")).toContain("无");
        expect(itemsOf("方向")).toEqual(["正面", "反面", "正面反轴", "反面转90°扁位朝上", "正面转90°扁位朝上"]);
        expect(itemsOf("规格")).toHaveLength(22);
        expect(itemsOf("规格")[0]).toBe("211-1");
        expect(itemsOf("杆子点位厚度")).toEqual(["4.8", "4.9"]);
        const faceOptions = [
            "三脚银点",
            "三脚铜点",
            "塑料盖板",
            "全方位左脚银点",
            "全方位右脚银点",
            "左脚银点（全银点）",
            "右脚银点",
            "右脚铜点",
            "全方位左脚铜点",
        ];
        expect(itemsOf("A面")).toEqual(faceOptions);
        expect(itemsOf("B面")).toEqual(faceOptions);
        // 同名物料分属两组，id 各自独立
        expect(rotary.groups.find(node => node.name === "A面")!.items[0]!.id).not.toBe(
            rotary.groups.find(node => node.name === "B面")!.items[0]!.id,
        );
    });
});

describe("旋转XK3 / 安全开关目录", () => {
    it("旋转XK3：三个根分组 + 五金件/触点分区，小静片等按 不电镀/镀锡 拆选项", () => {
        const xk3 = categoryOf("旋转XK3")!;
        expect(xk3.groups.slice(0, 3).map(node => [node.kind, node.name])).toEqual([
            ["group", "PC塑料外壳"],
            ["group", "PC塑料底座"],
            ["group", "PA66塑料杆子"],
        ]);
        expect(xk3.groups.filter(node => node.kind === "section").map(node => node.name)).toEqual(["五金件", "触点"]);
        const itemsOf = (groupName: string) =>
            xk3.groups.find(node => node.name === groupName)!.items.map(item => item.name);
        expect(itemsOf("PC塑料外壳")).toHaveLength(5);
        expect(itemsOf("小静片")).toEqual(["不电镀", "镀锡"]);
        expect(itemsOf("卡线片")).toEqual(["0.15", "0.2"]);
        expect(itemsOf("弹簧")).toEqual(["0.45长弹簧", "0.45短弹簧"]);
    });

    it("安全开关：外壳单选（KW16 31mm 茶色/透明拆两项）、短款/长款系列为多选组", () => {
        const safety = categoryOf("安全开关")!;
        expect(safety.groups.filter(node => node.kind === "section").map(node => node.name)).toEqual([
            "PA66塑料",
            "五金件",
            "触点",
        ]);
        const shell = safety.groups.find(node => node.name === "PC塑料（外壳类）")!;
        expect(shell).toMatchObject({ kind: "group", multi: false });
        expect(shell.items.map(item => item.name)).toEqual([
            "安全开关KD-2 (30mm/31mm) 外壳 / 茶色",
            "安全开关KW16 (31mm) 外壳 / 茶色",
            "安全开关KW16 (31mm) 外壳 / 透明",
            "安全开关KD-2 (40mm/43mm) 外壳 / 茶色",
            "安全开关KW16 (43mm) 外壳 / 茶色",
        ]);
        const short = safety.groups.find(node => node.name === "短款/31mm系列配件")!;
        expect(short).toMatchObject({ kind: "group", multi: true });
        expect(short.items.map(item => item.name)).toEqual(["动片", "静片", "短杆子", "短帽子", "短弹簧"]);
        const long = safety.groups.find(node => node.name === "长款/43mm系列配件")!;
        expect(long.multi).toBe(true);
        expect(long.items.map(item => item.name)).toEqual(["动片", "静片", "长杆子", "长帽子", "长弹簧"]);
    });
});

describe("bomSpecOfItems", () => {
    it("按入参顺序以“组名：物料名”拼接摘要", () => {
        expect(
            bomSpecOfItems([
                { groupName: "型号", name: "1-1" },
                { groupName: "方向", name: "正面" },
            ]),
        ).toBe("型号：1-1 · 方向：正面");
        expect(bomSpecOfItems([])).toBe("");
    });
});

describe("nextBomCode", () => {
    it("starts from 001 when category has no codes", () => {
        expect(nextBomCode(cat("旋转XK2"), [])).toBe("ZMXK2001");
        expect(nextBomCode(cat("老微动"), [])).toBe("ZMKW16001");
        expect(nextBomCode(cat("新微动"), [])).toBe("ZMKW0001");
    });

    it("increments max sequence within the same category only", () => {
        expect(nextBomCode(cat("旋转XK2"), of("旋转XK2", "ZMXK2001", "ZMXK2003"))).toBe("ZMXK2004");
        expect(nextBomCode(cat("新微动"), of("旋转XK2", "ZMXK2002"))).toBe("ZMKW0001");
    });

    it("ignores other categories even with similar prefixes", () => {
        // 老微动 ZMKW16xxx 不污染新微动 ZMKWxxxxxx
        expect(
            nextBomCode(cat("新微动"), [...of("新微动", "ZMKW0001"), ...of("老微动", "ZMKW16001", "ZMKW16012")]),
        ).toBe("ZMKW0002");
        expect(
            nextBomCode(cat("老微动"), [...of("老微动", "ZMKW16001", "ZMKW16012"), ...of("新微动", "ZMKW3744")]),
        ).toBe("ZMKW16013");
    });

    it("counts sequences beyond 999 within the same category", () => {
        expect(nextBomCode(cat("新微动"), of("新微动", "ZMKW0999", "ZMKW1000", "ZMKW3744"))).toBe("ZMKW3745");
    });

    it("ignores non-numeric suffixes", () => {
        expect(nextBomCode(cat("旋转XK2"), of("旋转XK2", "ZMXK2001", "ZMXK-XX"))).toBe("ZMXK2002");
    });
});

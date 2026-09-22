/* 物料目录种子与派生：7 品类树、目录序物料行、摘要拼接、编码自增 */
import { describe, expect, it } from "vitest";

import { bomSpecOfItems, BOM_CATEGORIES, catalogRowsOf, categoryOf, nextBomCode } from "@/data/categories";

/* 构造带品类名的编码列表（nextBomCode 按品类过滤后再取序号） */
const of = (name: string, ...codes: string[]) => codes.map(code => ({ code, name }));
/* 页面把接口下发的品类对象直接传入，这里用种子目录模拟 */
const cat = (name: string) => categoryOf(name)!;

describe("categoryOf", () => {
    it("系统共 9 个品类：7 个建档品类 + 旋转XK3 的焊线/插线两个工艺变体（目录容器，不在建档下拉）", () => {
        expect(BOM_CATEGORIES.filter(category => category.status !== false).map(category => category.key)).toEqual([
            "rotary-switch",
            "rotary-xk3",
            "new-micro-switch",
            "old-micro-switch",
            "safety-switch",
            "tipover-switch",
            "piano-key-switch",
        ]);
        expect(BOM_CATEGORIES.filter(category => category.status === false).map(category => category.key)).toEqual([
            "xk3-wire",
            "xk3-plug",
        ]);
        expect(BOM_CATEGORIES.map(category => category.key)).toEqual([
            "rotary-switch",
            "rotary-xk3",
            "xk3-wire",
            "xk3-plug",
            "new-micro-switch",
            "old-micro-switch",
            "safety-switch",
            "tipover-switch",
            "piano-key-switch",
        ]);
        expect(cat("旋转XK2").codePrefix).toBe("XK2");
        expect(categoryOf("琴键开关")!.codePrefix).toBe("KQ");
        expect(categoryOf("旋转XK3")!.codePrefix).toBe("XK3");
        expect(categoryOf("安全开关")!.codePrefix).toBe("AQ");
        expect(categoryOf("跌倒开关")!.codePrefix).toBe("KD");
        expect(categoryOf("跌倒开关")!.childCategories).toEqual(["new-micro-switch", "old-micro-switch"]);
        expect(categoryOf("新微动")!.childCategories).toBeUndefined();
        expect(categoryOf("XK3")).toBeUndefined();
        expect(categoryOf("不存在")).toBeUndefined();
    });

    it("旋转XK2为单选根组+尾部触点分区；新微动/老微动为 PA66塑料/五金件/触点 分区树", () => {
        const rotary = cat("旋转XK2");
        expect(rotary.groups.map(group => [group.kind, group.name, group.multi])).toEqual([
            ["group", "型号", false],
            ["group", "规格", false],
            ["group", "方向", false],
            ["group", "杆子点位厚度", false],
            ["group", "A面", false],
            ["group", "B面", false],
            ["group", "弹簧", false],
            ["section", "触点", null],
            ["group", "触点大小", false],
            ["group", "触点厚度", false],
            ["group", "触点类别", false],
        ]);
        const micro = cat("新微动");
        expect(micro.seqWidth).toBeUndefined();
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
            expect(contactItems("触点大小")).toEqual(["3.0mm", "3.5mm"]);
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
            "动片",
            "摆片",
            "摆片",
            "摆片",
            "弹片",
            "弹片",
            "弹片",
            "压杆",
            "压杆",
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
            "左脚银点",
            "右脚银点",
            "右脚铜点",
            "全方位左脚铜点",
            "左脚铜点",
            "全方位双脚铜点",
            "全方位双脚银点",
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
    it("旋转XK3：接线工艺二分——主品类无目录指向焊线/插线；插线目录三根分组 + 五金件分区", () => {
        const xk3 = categoryOf("旋转XK3")!;
        expect(xk3.groups).toEqual([]);
        expect(xk3.childCategories).toEqual(["xk3-wire", "xk3-plug"]);

        const plug = categoryOf("插线")!;
        expect(plug.groups.slice(0, 3).map(node => [node.kind, node.name])).toEqual([
            ["group", "PC塑料外壳"],
            ["group", "PC塑料底座"],
            ["group", "PA66塑料杆子"],
        ]);
        expect(plug.groups.filter(node => node.kind === "section").map(node => node.name)).toEqual(["五金件"]);
        const itemsOf = (groupName: string) =>
            plug.groups.find(node => node.name === groupName)!.items.map(item => item.name);
        expect(itemsOf("PC塑料外壳")).toHaveLength(5);
        expect(itemsOf("小静片")).toEqual(["不电镀", "镀锡"]);
        expect(itemsOf("卡线片")).toEqual(["底0.15 盖0.2", "底盖0.15", "底盖0.2"]);
        // 弹簧多选：0.45长/短弹簧可同时勾选
        expect(plug.groups.find(node => node.name === "弹簧")).toMatchObject({ kind: "group", multi: true });
        expect(itemsOf("弹簧")).toEqual(["0.45长弹簧", "0.45短弹簧"]);
    });

    it("焊线目录：外壳/底座各一种，杆子圆轴/扁轴4.8，静片/弹簧多选，3.0mm电镀钢球", () => {
        const wire = categoryOf("焊线")!;
        expect(wire.groups.map(node => node.name)).toEqual([
            "PC塑料",
            "外壳",
            "底座",
            "PA66塑料杆子",
            "五金件",
            "静片",
            "动片",
            "弹簧",
            "钢球",
        ]);
        const itemsOf = (groupName: string) =>
            wire.groups.find(node => node.name === groupName)!.items.map(item => item.name);
        expect(itemsOf("外壳")).toEqual(["外壳"]);
        expect(itemsOf("PA66塑料杆子")).toEqual(["圆轴", "扁轴4.8"]);
        expect(itemsOf("静片")).toEqual(["小静片", "半圆静片"]);
        expect(wire.groups.find(node => node.name === "静片")).toMatchObject({ multi: true });
        expect(itemsOf("钢球")).toEqual(["3.0mm电镀钢球"]);
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
        // 30mm/40mm 系列与既有 31mm/43mm 内容一致，物料 ids 独立
        const short30 = safety.groups.find(node => node.name === "短款/30mm系列配件")!;
        expect(short30).toMatchObject({ kind: "group", multi: true, parentId: "2503" });
        expect(short30.items.map(item => item.name)).toEqual(["动片", "静片", "短杆子", "短帽子", "短弹簧"]);
        expect(short30.items.map(item => item.id)).toEqual(["3607", "3608", "3609", "3610", "3611"]);
        const long41 = safety.groups.find(node => node.name === "长款/40mm系列配件")!;
        expect(long41).toMatchObject({ kind: "group", multi: true, parentId: "2503" });
        expect(long41.items.map(item => item.name)).toEqual(["动片", "静片", "长杆子", "长帽子", "长弹簧"]);
        expect(long41.items.map(item => item.id)).toEqual(["3612", "3613", "3614", "3615", "3616"]);
        // 四个系列按 短款30→短款31→长款40→长款43 排列，分组 id 连续递增
        expect(safety.groups.filter(node => node.parentId === "2503").map(node => node.id)).toEqual([
            "2611",
            "2612",
            "2613",
            "2614",
        ]);
    });
});

describe("琴键开关目录", () => {
    it("根组按序排列；静片/动片多选，扣板/连锁片/静片/动片为数量分组（qty=true）", () => {
        const piano = cat("琴键开关");
        expect(piano.groups.map(node => [node.name, node.multi, node.qty])).toEqual([
            ["琴键底", false, false],
            ["琴键盖", false, false],
            ["卡板", false, false],
            ["扣板", false, true],
            ["连锁片", false, true],
            ["静片", true, true],
            ["动片", true, true],
            ["弹簧规格", false, false],
        ]);
        expect(piano.groups.flatMap(node => node.items)).toHaveLength(46);
        const itemsOf = (groupName: string) =>
            piano.groups.find(node => node.name === groupName)!.items.map(item => item.name);
        expect(itemsOf("琴键底")).toEqual([
            "四键焊线底",
            "四键插线底",
            "五键焊线底",
            "五键插线底",
            "小太阳四键三档底（摇头）茶色",
            "小太阳四键三档底（摇头）灰色",
            "小太阳四键二档底（不摇头）茶色",
            "小太阳四键二档底（不摇头）灰色",
            "冷风扇琴键底（茶色）",
            "冷风扇琴键底（透明）大功率带触点",
        ]);
        expect(itemsOf("静片")).toEqual([
            "带点静片",
            "不带点静片",
            "四键焊线静片",
            "四键插线静片",
            "五键焊线静片",
            "五键插线静片",
        ]);
        expect(itemsOf("弹簧规格")).toEqual(["0.3", "0.35"]);
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
        expect(nextBomCode(cat("旋转XK2"), [])).toBe("XK2001");
        expect(nextBomCode(cat("老微动"), [])).toBe("KWO001");
        expect(nextBomCode(cat("新微动"), [])).toBe("KW001");
    });

    it("increments max sequence within the same category only", () => {
        expect(nextBomCode(cat("旋转XK2"), of("旋转XK2", "XK2001", "XK2003"))).toBe("XK2004");
        expect(nextBomCode(cat("新微动"), of("旋转XK2", "XK2002"))).toBe("KW001");
    });

    it("ignores other categories even with similar prefixes", () => {
        // 老微动 KWOxxx 不污染新微动 KWxxx
        expect(nextBomCode(cat("新微动"), [...of("新微动", "KW001"), ...of("老微动", "KWO001", "KWO012")])).toBe(
            "KW002",
        );
        expect(nextBomCode(cat("老微动"), [...of("老微动", "KWO001", "KWO012"), ...of("新微动", "KW744")])).toBe(
            "KWO013",
        );
    });

    it("counts sequences beyond 999 within the same category", () => {
        expect(nextBomCode(cat("新微动"), of("新微动", "KW999", "KW1000", "KW3744"))).toBe("KW3745");
    });

    it("ignores non-numeric suffixes", () => {
        expect(nextBomCode(cat("旋转XK2"), of("旋转XK2", "XK2001", "XK2-XX"))).toBe("XK2002");
    });
});

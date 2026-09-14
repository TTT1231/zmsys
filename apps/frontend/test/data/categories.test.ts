/* 品类模板派生：编码自增、默认规格与表单初值 */
import { describe, expect, it } from "vitest";

import {
    BOM_CATEGORIES,
    categoryOf,
    defaultsOf,
    initialValuesOf,
    NEW_MICRO_SWITCH_BRACKET_OPTIONS,
    NEW_MICRO_SWITCH_STATIC_PLATE_OPTIONS,
    newMicroSwitchGaugeOf,
    nextBomCode,
} from "@/data/categories";

const rotary = categoryOf("旋转开关")!;

/* 构造带品类名的编码列表（nextBomCode 按品类过滤后再取序号） */
const of = (name: string, ...codes: string[]) => codes.map(code => ({ code, name }));
/* 页面把接口下发的品类对象直接传入，这里用种子目录模拟 */
const cat = (name: string) => categoryOf(name)!;

describe("categoryOf", () => {
    it("finds category by name", () => {
        expect(rotary.codePrefix).toBe("XK2");
        expect(BOM_CATEGORIES).toHaveLength(5);
        expect(categoryOf("不存在")).toBeUndefined();
    });

    it("defines one matching-gauge bracket and static-plate field for new micro switches", () => {
        const category = categoryOf("新微动")!;
        expect(category.fields.map(field => field.key)).toContain("支架");
        expect(category.fields.map(field => field.key)).toContain("静片");
        expect(category.fields.map(field => field.key)).not.toEqual(
            expect.arrayContaining(["6.3支架", "4.8支架", "6.3静片", "4.8静片"]),
        );
        expect(category.fields.find(field => field.key === "支架")?.options).toEqual(NEW_MICRO_SWITCH_BRACKET_OPTIONS);
        expect(category.fields.find(field => field.key === "静片")?.options).toEqual(
            NEW_MICRO_SWITCH_STATIC_PLATE_OPTIONS,
        );
        expect(newMicroSwitchGaugeOf("6.3支架：铜镀银")).toBe("6.3");
        expect(newMicroSwitchGaugeOf("4.8静片：复合铜镀镍")).toBe("4.8");
    });

    it("archives the fixed cover as a constant for every new micro switch", () => {
        expect(defaultsOf(categoryOf("新微动")!)).toEqual({ 盖子: "盖子" });
    });
});

describe("nextBomCode", () => {
    it("starts from 001 when category has no codes", () => {
        expect(nextBomCode(cat("旋转开关"), [])).toBe("ZMXK2001");
        expect(nextBomCode(cat("老微动"), [])).toBe("ZMKW16001");
        expect(nextBomCode(cat("新微动"), [])).toBe("ZMKW0001");
        expect(nextBomCode(cat("琴键开关"), [])).toBe("ZMKQ001");
    });

    it("increments max sequence within the same category only", () => {
        expect(nextBomCode(cat("旋转开关"), of("旋转开关", "ZMXK2001", "ZMXK2003"))).toBe("ZMXK2004");
        expect(nextBomCode(cat("新微动"), of("旋转开关", "ZMXK2002"))).toBe("ZMKW0001");
    });

    it("ignores other categories even with similar prefixes", () => {
        // 老微动 ZMKW16xxx 不污染新微动 ZMKWxxxxxx，XK3 ZMXK3xxx 不污染旋转开关 ZMXK2xxx
        expect(
            nextBomCode(cat("新微动"), [...of("新微动", "ZMKW0001"), ...of("老微动", "ZMKW16001", "ZMKW16012")]),
        ).toBe("ZMKW0002");
        expect(
            nextBomCode(cat("老微动"), [...of("老微动", "ZMKW16001", "ZMKW16012"), ...of("新微动", "ZMKW3744")]),
        ).toBe("ZMKW16013");
        expect(
            nextBomCode(cat("旋转开关"), [...of("旋转开关", "ZMXK2001", "ZMXK2033"), ...of("XK3", "ZMXK31280")]),
        ).toBe("ZMXK2034");
    });

    it("counts sequences beyond 999 within the same category", () => {
        // 新微动全组合 3744 条（序号 4 位）、XK3 全组合 1280 条都会跨 999 边界，超 3 位序号也要参与自增
        expect(nextBomCode(cat("新微动"), of("新微动", "ZMKW0999", "ZMKW1000", "ZMKW3744"))).toBe("ZMKW3745");
        expect(nextBomCode(cat("XK3"), of("XK3", "ZMXK3001", "ZMXK31280"))).toBe("ZMXK31281");
    });

    it("ignores non-numeric suffixes", () => {
        expect(nextBomCode(cat("旋转开关"), of("旋转开关", "ZMXK2001", "ZMXK-XX"))).toBe("ZMXK2002");
    });
});

describe("defaultsOf / initialValuesOf", () => {
    it("collects only defaultValue fields as archived constants", () => {
        expect(defaultsOf(rotary)).toEqual({
            杆子高度: "4.8",
            A面触点: "A面银点",
            B面触点: "B面塑料盖板",
        });
    });

    it("builds form initial values with initial preferred over defaultValue", () => {
        expect(initialValuesOf(rotary)).toEqual({
            银点厚度: "0.2",
            弹簧: "0.5",
            杆子高度: "4.8",
            A面触点: "A面银点",
            B面触点: "B面塑料盖板",
        });
        // 脚位 / 档位等无默认、无初值的字段不出现
        expect(initialValuesOf(rotary)).not.toHaveProperty("脚位");
    });

    it("returns empty specs for categories without defaults", () => {
        expect(defaultsOf(categoryOf("琴键开关")!)).toEqual({});
        expect(initialValuesOf(categoryOf("琴键开关")!)).toEqual({});
    });
});

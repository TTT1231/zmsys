/* 品类模板派生：编码自增、默认规格与表单初值 */
import { describe, expect, it } from "vitest";

import { BOM_CATEGORIES, categoryOf, defaultsOf, initialValuesOf, nextBomCode } from "@/data/categories";

const rotary = categoryOf("旋转开关")!;

describe("categoryOf", () => {
    it("finds category by name", () => {
        expect(rotary.codePrefix).toBe("XK");
        expect(BOM_CATEGORIES).toHaveLength(3);
        expect(categoryOf("不存在")).toBeUndefined();
    });
});

describe("nextBomCode", () => {
    it("starts from 001 when category has no codes", () => {
        expect(nextBomCode("旋转开关", [])).toBe("ZMXK001");
        expect(nextBomCode("跌倒开关", [])).toBe("ZMDD001");
    });

    it("increments max sequence within the same category only", () => {
        expect(nextBomCode("旋转开关", ["ZMXK001", "ZMXK003", "ZMKW010"])).toBe("ZMXK004");
        expect(nextBomCode("微动开关", ["ZMXK002"])).toBe("ZMKW001");
    });

    it("ignores non-numeric suffixes", () => {
        expect(nextBomCode("旋转开关", ["ZMXK001", "ZMXK-XX"])).toBe("ZMXK002");
    });

    it("throws on unknown category", () => {
        expect(() => nextBomCode("未知品类", [])).toThrow("未知品类：未知品类");
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
        expect(defaultsOf(categoryOf("微动开关")!)).toEqual({});
        expect(initialValuesOf(categoryOf("微动开关")!)).toEqual({});
    });
});

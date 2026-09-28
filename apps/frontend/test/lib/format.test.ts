/* 千分位格式化 */
import { describe, expect, it } from "vitest";

import { num } from "@/lib/format";

describe("num", () => {
    it("formats thousands separators in zh-CN", () => {
        expect(num(0)).toBe("0");
        expect(num(999)).toBe("999");
        expect(num(1234567)).toBe("1,234,567");
    });
});

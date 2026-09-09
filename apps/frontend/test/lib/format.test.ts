/* csvEscape 注入防护与千分位格式化（downloadCsv 依赖浏览器 API，不做单测） */
import { describe, expect, it } from "vitest";

import { csvEscape, num } from "@/lib/format";

describe("num", () => {
    it("formats thousands separators in zh-CN", () => {
        expect(num(0)).toBe("0");
        expect(num(999)).toBe("999");
        expect(num(1234567)).toBe("1,234,567");
    });
});

describe("csvEscape", () => {
    it("prefixes formula injection characters with a quote", () => {
        expect(csvEscape("=SUM(A1)")).toBe("'=SUM(A1)");
        expect(csvEscape("+62")).toBe("'+62");
        expect(csvEscape("-5")).toBe("'-5");
        expect(csvEscape("@import")).toBe("'@import");
    });

    it("wraps and escapes values containing comma, quote or newline", () => {
        expect(csvEscape("普通值")).toBe("普通值");
        expect(csvEscape("a,b")).toBe('"a,b"');
        expect(csvEscape('说"话')).toBe('"说""话"');
        expect(csvEscape("多\n行")).toBe('"多\n行"');
    });
});

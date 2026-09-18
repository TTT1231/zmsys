import { describe, expect, it } from "vitest";
import { formatBeijingStamp } from "./datetime";

describe("formatBeijingStamp（契约展示格式 MM-dd HH:mm）", () => {
    it("UTC 时间换算为北京时间展示值", () => {
        // UTC 2026-09-11 04:59 = 北京时间 12:59
        expect(formatBeijingStamp(new Date("2026-09-11T04:59:00Z"))).toBe("09-11 12:59");
    });

    it("跨日边界换算正确（UTC 前一天 16:05 = 北京 次日 00:05）", () => {
        expect(formatBeijingStamp(new Date("2026-09-11T16:05:00Z"))).toBe("09-12 00:05");
    });

    it("从未登录返回破折号", () => {
        expect(formatBeijingStamp(null)).toBe("—");
    });
});

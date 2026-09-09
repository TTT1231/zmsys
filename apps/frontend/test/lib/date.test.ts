/* ISO 日期工具：本地时区解析与跨月/跨年进位 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addDays, nowStamp, nowTime, toIso, todayIso } from "@/lib/date";

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T08:05:00"));
});

afterEach(() => {
    vi.useRealTimers();
});

describe("toIso / todayIso", () => {
    it("pads month and day to two digits in local timezone", () => {
        expect(toIso(new Date(2026, 2, 9))).toBe("2026-03-09");
        expect(toIso(new Date(2026, 11, 31))).toBe("2026-12-31");
        expect(todayIso()).toBe("2026-03-09");
    });
});

describe("addDays", () => {
    it("carries over month and year boundaries", () => {
        expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
        expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
        expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
        expect(addDays("2026-03-09", -10)).toBe("2026-02-27");
    });

    it("keeps ordinary dates stable", () => {
        expect(addDays("2026-03-09", 0)).toBe("2026-03-09");
        expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    });
});

describe("nowTime / nowStamp", () => {
    it("formats clock with padded minutes and display stamp", () => {
        expect(nowTime()).toBe("08:05");
        expect(nowStamp()).toBe("03-09 08:05");
    });
});

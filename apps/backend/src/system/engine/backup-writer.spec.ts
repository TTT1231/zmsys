import { describe, expect, it } from "vitest";
import { ALL_GROUP_KEYS } from "../backup.catalog";
import { backupFileName } from "./backup-writer";

describe("backupFileName", () => {
    const at = new Date(2026, 8, 28, 2, 22, 20);
    it("全部目录分组（顺序无关）= full", () => {
        expect(backupFileName("zmdb", ALL_GROUP_KEYS, true, at)).toBe("zmdb-full-20260928-022220.sql.gz");
        expect(backupFileName("zmdb", [...ALL_GROUP_KEYS].reverse(), false, at)).toBe("zmdb-full-20260928-022220.sql");
    });
    it("单分组 = 组名", () => {
        expect(backupFileName("zmdb", ["users"], true, at)).toBe("zmdb-users-20260928-022220.sql.gz");
    });
    it("多分组但闭包未覆盖全集 = partial-N", () => {
        // users+customers+bom 闭包含 sequences，但缺 orders/inbound/outbound/system
        expect(backupFileName("zmdb", ["users", "customers", "bom"], true, at)).toBe(
            "zmdb-partial-3-20260928-022220.sql.gz",
        );
    });
});

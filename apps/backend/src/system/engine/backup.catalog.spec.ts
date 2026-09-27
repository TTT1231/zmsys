import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    ALL_GROUP_KEYS,
    BACKUP_GROUPS,
    allCatalogTables,
    closureTables,
    expandGroupClosure,
    isFullBackupClosure,
    RUNTIME_TABLES,
} from "../backup.catalog";

describe("备份分组目录", () => {
    it("入库↔出库互为依赖：单独选其一闭包都会包含两者", () => {
        expect([...expandGroupClosure(["inbound"])].sort()).toEqual(
            ["inbound", "outbound", "bom", "users", "sequences", "orders", "customers"].sort(),
        );
        expect([...expandGroupClosure(["outbound"])].sort()).toEqual(
            ["inbound", "outbound", "bom", "users", "sequences", "orders", "customers"].sort(),
        );
    });
    it("未知分组直接抛错", () => {
        expect(() => expandGroupClosure(["nope"])).toThrow("未知备份分组");
    });
    it("闭包表集合 = 各组表去重并集", () => {
        const tables = closureTables(["sequences"]);
        expect([...tables]).toEqual(["biz_sequence"]);
        const usersTables = closureTables(["users"]);
        expect([...usersTables].sort()).toEqual(
            ["sys_role", "sys_user", "sys_grant", "sys_grant_log", "sys_user_change_log"].sort(),
        );
    });
    it("完整备份判定：目录全集动态计算", () => {
        expect(isFullBackupClosure(ALL_GROUP_KEYS)).toBe(true);
        // 入库↔出库互依拉平了大部分组，但 system（op_log）无人依赖，仍不构成全集
        expect(isFullBackupClosure(["inbound"])).toBe(false);
        expect(isFullBackupClosure(["users"])).toBe(false);
        expect(
            isFullBackupClosure(["users", "sequences", "customers", "bom", "orders", "inbound", "outbound", "system"]),
        ).toBe(true);
    });
    it("运行态表永不入目录", () => {
        const all = allCatalogTables();
        for (const table of RUNTIME_TABLES) {
            expect(all.has(table)).toBe(false);
        }
        expect(BACKUP_GROUPS.length).toBe(8);
    });
    it("每张 Prisma 实体表都纳入备份或显式列为运行态例外", () => {
        const schema = readFileSync(resolve(__dirname, "../../../prisma/schema.prisma"), "utf8");
        const models = [...schema.matchAll(/^model\s+\w+\s*\{([\s\S]*?)^\}/gm)];
        const physicalTables = models
            .map(([, body]) => /@@map\("([^"]+)"\)/.exec(body)?.[1])
            .filter((table): table is string => !!table);
        expect(physicalTables).toHaveLength(models.length);
        expect([...new Set([...allCatalogTables(), ...RUNTIME_TABLES])].sort()).toEqual(physicalTables.sort());
    });
});

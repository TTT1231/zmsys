/**
 * 恢复引擎单测：以脚本化 SqlExecutor + 小目录 mock 驱动纯引擎。
 * catalog mock 与真实实现算法一致（真实目录逻辑在 backup.catalog.spec 单独覆盖），
 * 仅缩小分组集合使夹具体量可控。
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CHECKSUM_PREFIX, encodeSqlString, FORMAT_END, FORMAT_HEADER, SET_NAMES_LINE } from "./backup-format";
import {
    FIXTURE_CHECK_ROWS,
    FIXTURE_COLUMN_ROWS,
    FIXTURE_FK_ROWS,
    FIXTURE_LATEST_MIGRATION,
    FIXTURE_STAT_ROWS,
    FIXTURE_VERSION,
} from "./engine-fixtures";
import type { SqlExecutor } from "./db-introspection";

vi.mock("../backup.catalog", () => {
    const GROUPS = [
        { key: "users", label: "用户", tables: ["sys_role", "sys_user"], dependsOn: [] },
        { key: "logs", label: "日志", tables: ["op_log"], dependsOn: ["users"] },
        { key: "sequences", label: "序列", tables: ["biz_sequence"], dependsOn: [] },
        { key: "materials", label: "物料", tables: ["material_group"], dependsOn: ["users"] },
    ];
    const byKey = new Map(GROUPS.map(group => [group.key, group]));
    const expand = (keys: readonly string[]): Set<string> => {
        const out = new Set<string>();
        const visit = (key: string): void => {
            const group = byKey.get(key);
            if (!group) throw new Error(`未知备份分组：${key}`);
            if (out.has(key)) return;
            out.add(key);
            group.dependsOn.forEach(visit);
        };
        keys.forEach(visit);
        return out;
    };
    const tablesOf = (keys: readonly string[]): Set<string> => {
        const tables = new Set<string>();
        for (const key of expand(keys)) {
            for (const table of byKey.get(key)!.tables) tables.add(table);
        }
        return tables;
    };
    return {
        BACKUP_GROUPS: GROUPS,
        RUNTIME_TABLES: ["sys_permission", "api_idempotency", "sys_restore_job"],
        CLEANABLE_RUNTIME_TABLES: ["api_idempotency"],
        ALL_GROUP_KEYS: GROUPS.map(group => group.key),
        expandGroupClosure: expand,
        closureTables: tablesOf,
        allCatalogTables: () => tablesOf(GROUPS.map(group => group.key)),
        isFullBackupClosure: (keys: readonly string[]) => GROUPS.every(group => expand(keys).has(group.key)),
    };
});

import {
    BackupLimitError,
    executeRestore,
    RestoreAbortedError,
    RestoreUnknownError,
    RestoreValidationError,
    validateBackup,
    type RestoreCredential,
} from "./restore-engine";
import { closureTables } from "../backup.catalog";
import { computeSchemaFingerprint } from "./db-introspection";

const DATABASE = "zmdb_test";

/* ------------------------------------------------------------------ */
/* 脚本化执行器                                                        */
/* ------------------------------------------------------------------ */

interface Script {
    insert?: (sql: string, params: unknown[]) => unknown;
    count?: (sql: string, params: unknown[]) => Array<{ n: number | bigint }>;
    commit?: () => unknown;
    rollback?: () => unknown;
    tokenVersions?: Array<{ id: bigint; token_version: bigint }>;
}

class ScriptedExecutor implements SqlExecutor {
    readonly statements: Array<{ sql: string; params: unknown[] }> = [];

    constructor(private readonly script: Script = {}) {}

    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T> {
        this.statements.push({ sql, params: params ?? [] });
        if (sql.includes("information_schema.COLUMNS")) return FIXTURE_COLUMN_ROWS as T;
        if (sql.includes("information_schema.STATISTICS")) return FIXTURE_STAT_ROWS as T;
        if (sql.includes("information_schema.KEY_COLUMN_USAGE")) return FIXTURE_FK_ROWS as T;
        if (sql.includes("information_schema.CHECK_CONSTRAINTS")) return FIXTURE_CHECK_ROWS as T;
        if (sql.startsWith("SELECT VERSION()")) return [{ v: FIXTURE_VERSION }] as T;
        if (sql.includes("_prisma_migrations")) return [{ migration_name: FIXTURE_LATEST_MIGRATION }] as T;
        if (sql === "COMMIT") {
            return (this.script.commit?.() ?? { affectedRows: 0 }) as T;
        }
        if (sql === "ROLLBACK") {
            return (this.script.rollback?.() ?? { affectedRows: 0 }) as T;
        }
        if (sql.startsWith("SELECT COUNT(*)")) {
            return (this.script.count?.(sql, params ?? []) ?? [{ n: 0 }]) as T;
        }
        if (sql === "SELECT id, token_version FROM sys_user") {
            return (this.script.tokenVersions ?? []) as T;
        }
        if (sql.startsWith("INSERT")) {
            return (this.script.insert?.(sql, params ?? []) ?? { affectedRows: 1 }) as T;
        }
        // START TRANSACTION / SET SESSION / DELETE 等
        return { affectedRows: 0 } as T;
    }
}

/* ------------------------------------------------------------------ */
/* 备份文件构造                                                        */
/* ------------------------------------------------------------------ */

interface FileTable {
    name: string;
    lines?: string[];
    /** 覆盖 meta 声明行数（构造行数不一致场景） */
    declaredRowCount?: number;
}

interface FileOptions {
    groups: string[];
    tables: FileTable[];
    fingerprint: string;
    serverVersion?: string;
    latestMigration?: string;
    /** 对最终行列表做篡改后重算 checksum（模拟“内容与摘要不符”以外的构造途径） */
    mutateLines?: (lines: string[]) => string[];
    /** 直接给出错误 checksum（构造摘要不符） */
    brokenChecksum?: boolean;
    endMarker?: boolean;
}

const ROLE_COLUMNS = "`code`, `name`, `locked`, `grant_version`, `created_at`, `updated_at`";

const roleLine = (code: string, name: string, updatedAt: string): string =>
    `INSERT INTO \`sys_role\` (${ROLE_COLUMNS}) VALUES (${encodeSqlString(code)}, ${encodeSqlString(name)}, 0, 1, '2026-01-01 00:00:00.000', ${encodeSqlString(updatedAt)});`;

const USER_COLUMNS =
    "`id`, `account`, `password_hash`, `name`, `role_code`, `status`, `token_version`, `row_version`, `password_changed_at`, `last_login_at`, `created_at`, `updated_at`";

const userLine = (id: string, account: string, tokenVersion: string, lastLogin: string | null): string =>
    `INSERT INTO \`sys_user\` (${USER_COLUMNS}) VALUES (${id}, ${encodeSqlString(account)}, '$2a$10$hash', ${encodeSqlString(account)}, 'super', 1, ${tokenVersion}, 1, NULL, ${lastLogin === null ? "NULL" : encodeSqlString(lastLogin)}, '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000');`;

const SEQ_COLUMNS = "`sequence_key`, `next_value`, `updated_at`";
const sequenceLine = (key: string, next: string): string =>
    `INSERT INTO \`biz_sequence\` (${SEQ_COLUMNS}) VALUES (${encodeSqlString(key)}, ${next}, '2026-01-01 00:00:00.000');`;

const MG_COLUMNS =
    "`id`, `category_id`, `parent_id`, `kind`, `name`, `group_key`, `multi`, `qty`, `sort_order`, `status`, `created_at`, `updated_at`";
const materialLine = (id: string, parent: string | null, name: string): string =>
    `INSERT INTO \`material_group\` (${MG_COLUMNS}) VALUES (${id}, 1001, ${parent === null ? "NULL" : parent}, 'GROUP', ${encodeSqlString(name)}, NULL, NULL, NULL, 0, 1, '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000');`;

const buildFile = (options: FileOptions): Buffer => {
    const metaTables = options.tables.map(table => ({
        name: table.name,
        rowCount: table.declaredRowCount ?? table.lines?.length ?? 0,
    }));
    const metaJson = {
        format: "zmsys-backup",
        version: 1,
        createdAt: "2026-09-27T00:00:00.000Z",
        groups: options.groups,
        serverProduct: "MySQL",
        serverVersion: options.serverVersion ?? FIXTURE_VERSION,
        latestMigration: options.latestMigration ?? FIXTURE_LATEST_MIGRATION,
        schemaFingerprint: options.fingerprint,
        tables: metaTables,
    };
    const lines: string[] = [FORMAT_HEADER, `-- meta: ${JSON.stringify(metaJson)}`, SET_NAMES_LINE];
    for (const table of options.tables) {
        lines.push(`-- table ${table.name}`);
        lines.push(...(table.lines ?? []));
    }
    const mutated = options.mutateLines ? options.mutateLines(lines) : lines;
    const hash = createHash("sha256");
    // checksum 覆盖 header 后、checksum 行前的全部行
    for (const line of mutated.slice(1)) {
        hash.update(line);
        hash.update("\n");
    }
    const checksum = options.brokenChecksum ? "0".repeat(64) : hash.digest("hex");
    const final = [...mutated, `${CHECKSUM_PREFIX}${checksum}`];
    if (options.endMarker !== false) {
        final.push(FORMAT_END);
    }
    return Buffer.from(`${final.join("\n")}\n`, "utf8");
};

const fixtureFingerprint = async (executor: SqlExecutor, groups: string[]): Promise<string> =>
    computeSchemaFingerprint(executor, DATABASE, [...closureTables(groups)]);

const fromBuffer =
    (buffer: Buffer): (() => Readable) =>
    () =>
        Readable.from([buffer]);

const credential: RestoreCredential = {
    jobId: 123n,
    requestKey: "test-request-key",
    fileSha256: "a".repeat(64),
    mode: "merge",
    operatorId: 1n,
    operatorName: "tester",
};

/* ------------------------------------------------------------------ */
/* 校验                                                                */
/* ------------------------------------------------------------------ */

describe("validateBackup 文法与一致性", () => {
    it("合法文件通过并返回行数统计（含空表段）", async () => {
        const executor = new ScriptedExecutor();
        const fingerprint = await fixtureFingerprint(executor, ["users"]);
        const file = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [
                { name: "sys_role", lines: [roleLine("super", "超级管理员", "2026-01-01 00:00:00.000")] },
                { name: "sys_user", lines: [userLine("1", "guojun", "3", null)] },
            ],
        });
        const validated = await validateBackup(executor, DATABASE, fromBuffer(file), "merge");
        expect(validated.fullBackup).toBe(false);
        expect(validated.tables.map(table => table.rowCount)).toEqual([1, 1]);
    });

    it("checksum 不符拒绝", async () => {
        const executor = new ScriptedExecutor();
        const fingerprint = await fixtureFingerprint(executor, ["users"]);
        const file = buildFile({ groups: ["users"], fingerprint, tables: [], brokenChecksum: true });
        await expect(validateBackup(executor, DATABASE, fromBuffer(file), "merge")).rejects.toThrow(
            RestoreValidationError,
        );
    });

    it("gzip 文件可解压校验", async () => {
        const executor = new ScriptedExecutor();
        const fingerprint = await fixtureFingerprint(executor, ["sequences"]);
        const plain = buildFile({
            groups: ["sequences"],
            fingerprint,
            tables: [{ name: "biz_sequence", lines: [sequenceLine("bom", "10")] }],
        });
        const gzipped = gzipSync(plain);
        const validated = await validateBackup(executor, DATABASE, () => Readable.from([gzipped]), "merge");
        expect(validated.tables[0]?.rowCount).toBe(1);
    });

    it("部分备份执行 replace 拒绝", async () => {
        const executor = new ScriptedExecutor();
        const fingerprint = await fixtureFingerprint(executor, ["users"]);
        const file = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [
                { name: "sys_role", lines: [roleLine("super", "超级管理员", "2026-01-01 00:00:00.000")] },
                { name: "sys_user" },
            ],
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(file), "replace")).rejects.toThrow(
            "部分备份不得执行 replace",
        );
    });

    it("指纹不一致拒绝", async () => {
        const executor = new ScriptedExecutor();
        const file = buildFile({
            groups: ["users"],
            fingerprint: "f".repeat(64),
            tables: [{ name: "sys_role" }, { name: "sys_user" }],
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(file), "merge")).rejects.toThrow("指纹不一致");
    });

    it("迁移基线/大版本不一致拒绝", async () => {
        const executor = new ScriptedExecutor();
        const fingerprint = await fixtureFingerprint(executor, ["users"]);
        const badMigration = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [{ name: "sys_role" }, { name: "sys_user" }],
            latestMigration: "20250101000000_old",
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(badMigration), "merge")).rejects.toThrow(
            "迁移基线不一致",
        );
        const badVersion = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [{ name: "sys_role" }, { name: "sys_user" }],
            serverVersion: "5.7.40",
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(badVersion), "merge")).rejects.toThrow(
            "大版本不一致",
        );
    });

    it("非白名单表 / 重复表段 / 缺空表段 拒绝", async () => {
        const executor = new ScriptedExecutor();
        const fingerprint = await fixtureFingerprint(executor, ["users"]);
        // meta.tables 校验先行：含闭包外表直接拒绝
        const rogueMeta = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [{ name: "sys_role" }, { name: "sys_user" }, { name: "api_idempotency" }],
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(rogueMeta), "merge")).rejects.toThrow(
            "超出分组闭包",
        );

        // meta 合法但表段声明白名单外表
        const rogueSection = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [{ name: "sys_role" }, { name: "sys_user" }],
            mutateLines: lines => [...lines, "-- table api_idempotency"],
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(rogueSection), "merge")).rejects.toThrow(
            "不在备份分组闭包白名单内",
        );

        // 重复表段
        const dup = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [{ name: "sys_role" }, { name: "sys_user" }],
            mutateLines: lines => [...lines, "-- table sys_role"],
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(dup), "merge")).rejects.toThrow("重复段");

        const missingEmpty = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [{ name: "sys_role" }, { name: "sys_user" }],
            mutateLines: lines => lines.filter(line => line !== "-- table sys_user"),
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(missingEmpty), "merge")).rejects.toThrow("缺少表段");
    });

    it("行数与 meta 不符拒绝（含空表 rowCount=0）", async () => {
        const executor = new ScriptedExecutor();
        const fingerprint = await fixtureFingerprint(executor, ["users"]);
        const file = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [
                {
                    name: "sys_role",
                    lines: [
                        roleLine("a", "A", "2026-01-01 00:00:00.000"),
                        roleLine("b", "B", "2026-01-01 00:00:00.000"),
                    ],
                    declaredRowCount: 3,
                },
                { name: "sys_user" },
            ],
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(file), "merge")).rejects.toThrow("行数不一致");
    });

    it("任意注释 / 结束后追加内容 / CR 拒绝", async () => {
        const executor = new ScriptedExecutor();
        const fingerprint = await fixtureFingerprint(executor, ["users"]);
        const commented = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [{ name: "sys_role" }, { name: "sys_user" }],
            mutateLines: lines => [...lines, "-- extra comment"],
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(commented), "merge")).rejects.toThrow(
            "不接受任意注释",
        );

        const appended = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [{ name: "sys_role" }, { name: "sys_user" }],
            mutateLines: lines => lines,
        });
        const withTrailing = Buffer.concat([appended, Buffer.from("-- after end\n")]);
        await expect(validateBackup(executor, DATABASE, fromBuffer(withTrailing), "merge")).rejects.toThrow(
            "结束标记后仍有追加内容",
        );

        const withCr = Buffer.from(appended.toString("utf8").replace("SET NAMES", "SET\r\nNAMES"), "utf8");
        await expect(validateBackup(executor, DATABASE, fromBuffer(withCr), "merge")).rejects.toThrow();
    });

    it("表段顺序违反 FK 拓扑拒绝（sys_user 段先于 sys_role 段）", async () => {
        const executor = new ScriptedExecutor();
        const fingerprint = await fixtureFingerprint(executor, ["users"]);
        const file = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [
                { name: "sys_user", lines: [userLine("1", "guojun", "3", null)] },
                { name: "sys_role", lines: [roleLine("super", "超级管理员", "2026-01-01 00:00:00.000")] },
            ],
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(file), "merge")).rejects.toThrow(
            "表段顺序违反外键依赖",
        );
    });

    it("自引用行序（子先于父）拒绝；父先子后通过", async () => {
        const executor = new ScriptedExecutor();
        const fingerprint = await fixtureFingerprint(executor, ["materials"]);
        const bad = buildFile({
            groups: ["materials"],
            fingerprint,
            tables: [
                { name: "sys_role" },
                { name: "sys_user" },
                {
                    name: "material_group",
                    lines: [materialLine("500", "100", "子分组"), materialLine("100", null, "父分组")],
                },
            ],
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(bad), "merge")).rejects.toThrow("自引用行顺序错误");

        const good = buildFile({
            groups: ["materials"],
            fingerprint,
            tables: [
                { name: "sys_role" },
                { name: "sys_user" },
                {
                    name: "material_group",
                    lines: [
                        materialLine("100", null, "父分组"),
                        materialLine("500", "100", "子分组"),
                        materialLine("900", "100", "同层子分组"),
                    ],
                },
            ],
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(good), "merge")).resolves.toBeTruthy();
    });

    it("列清单与实际结构不符拒绝", async () => {
        const executor = new ScriptedExecutor();
        const fingerprint = await fixtureFingerprint(executor, ["users"]);
        const rogueColumn = `INSERT INTO \`sys_role\` (\`code\`, \`extra_col\`) VALUES ('a', 1);`;
        const file = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [{ name: "sys_role", lines: [rogueColumn] }, { name: "sys_user" }],
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(file), "merge")).rejects.toThrow(
            "列清单与实际结构不一致",
        );
    });

    it("类型不匹配拒绝（非空列 NULL / 整数列字符串）", async () => {
        const executor = new ScriptedExecutor();
        const fingerprint = await fixtureFingerprint(executor, ["users"]);
        const nullLine = `INSERT INTO \`sys_role\` (${ROLE_COLUMNS}) VALUES (NULL, 'n', 0, 1, '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000');`;
        const file = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [{ name: "sys_role", lines: [nullLine] }, { name: "sys_user" }],
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(file), "merge")).rejects.toThrow(
            "非空列不接受 NULL",
        );

        const stringInt = `INSERT INTO \`sys_user\` (${USER_COLUMNS}) VALUES ('1', 'a', '$2a$10$hash', 'n', 'super', 1, '2', 1, NULL, NULL, '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000');`;
        const file2 = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [{ name: "sys_role" }, { name: "sys_user", lines: [stringInt] }],
        });
        await expect(validateBackup(executor, DATABASE, fromBuffer(file2), "merge")).rejects.toThrow("整数列不接受");
    });

    it("超限：行数超上限抛 BackupLimitError", async () => {
        const executor = new ScriptedExecutor();
        const fingerprint = await fixtureFingerprint(executor, ["sequences"]);
        const big = "x".repeat(300);
        const file = buildFile({
            groups: ["sequences"],
            fingerprint,
            tables: [{ name: "biz_sequence", lines: [sequenceLine(big, "10")] }],
        });
        // readLines 的 maxTotalBytes 参数：模拟解压上限（BackupLimitError 语义）
        const { readLines, openDecompressed } = await import("./restore-engine.js");
        const stream = await openDecompressed(fromBuffer(file));
        await expect(async () => {
            for await (const _ of readLines(stream, 64)) {
                void _;
            }
        }).rejects.toThrow(BackupLimitError);
    });
});

/* ------------------------------------------------------------------ */
/* merge 执行                                                          */
/* ------------------------------------------------------------------ */

const dupPrimary = (key: string): never => {
    throw Object.assign(new Error(`Duplicate entry '${key}' for key 'PRIMARY'`), { errno: 1062, code: "ER_DUP_ENTRY" });
};
const dupUnique = (index: string): never => {
    throw Object.assign(new Error(`Duplicate entry 'x' for key '${index}'`), { errno: 1062, code: "ER_DUP_ENTRY" });
};

describe("executeRestore merge", () => {
    const mergeFile = async (
        executor: SqlExecutor,
        roleLines: string[],
        mode: "merge" | "replace" = "merge",
    ): Promise<Buffer> => {
        const fingerprint = await computeSchemaFingerprint(executor, DATABASE, [
            ...closureTables(mode === "replace" ? ["users", "logs", "sequences", "materials"] : ["users"]),
        ]);
        if (mode === "merge") {
            return buildFile({
                groups: ["users"],
                fingerprint,
                tables: [{ name: "sys_role", lines: roleLines }, { name: "sys_user" }],
            });
        }
        return buildFile({
            groups: ["users", "logs", "sequences", "materials"],
            fingerprint,
            tables: [
                { name: "sys_role", lines: roleLines },
                { name: "sys_user", lines: [userLine("1", "guojun", "2", null)] },
                { name: "op_log" },
                { name: "biz_sequence" },
                { name: "material_group" },
            ],
        });
    };

    it("全部新行：参数化插入并同事务写成功凭证", async () => {
        const executor = new ScriptedExecutor();
        const file = await mergeFile(executor, [
            roleLine("new1", "新1", "2026-01-01 00:00:00.000"),
            roleLine("new2", "新2", "2026-01-01 00:00:00.000"),
        ]);
        const report = await executeRestore(
            { executor, database: DATABASE, mode: "merge", credential },
            fromBuffer(file),
        );
        expect(report.tables.find(table => table.name === "sys_role")).toMatchObject({ inserted: 2, skipped: 0 });
        const sql = executor.statements.map(statement => statement.sql);
        expect(sql).toContain("START TRANSACTION");
        expect(sql.some(statement => statement.startsWith("INSERT INTO sys_restore_job"))).toBe(true);
        expect(sql.indexOf("START TRANSACTION")).toBeLessThan(
            sql.findIndex(statement => statement.startsWith("INSERT INTO sys_restore_job")),
        );
        expect(sql.indexOf("COMMIT")).toBeGreaterThan(
            sql.findIndex(statement => statement.startsWith("INSERT INTO sys_restore_job")),
        );
    });

    it("PRIMARY 冲突内容一致 → 跳过；豁免列差异（updated_at）→ 跳过保留目标值", async () => {
        const executor = new ScriptedExecutor({
            insert: (sql, params) => {
                if (sql.startsWith("INSERT INTO `sys_role`")) {
                    // 批次与单行重试都命中 PRIMARY 冲突
                    dupPrimary(String(params[0]));
                }
                return { affectedRows: 1 };
            },
            count: sql => {
                // 全列一致查询：第一行完全一致；豁免查询走不到（批次二分后单行分别比较）
                return [{ n: sql.includes("`code` = ? AND") ? 1 : 0 }];
            },
        });
        const file = await mergeFile(executor, [
            roleLine("same", "同名", "2026-01-01 00:00:00.000"),
            roleLine("stale", "旧值", "2020-01-01 00:00:00.000"),
        ]);
        const report = await executeRestore(
            { executor, database: DATABASE, mode: "merge", credential },
            fromBuffer(file),
        );
        const role = report.tables.find(table => table.name === "sys_role")!;
        expect(role.skipped).toBe(2);
        expect(role.inserted).toBe(0);
    });

    it("豁免列差异：sys_user.last_login_at 免疫，其余表仅 updated_at", async () => {
        const executor = new ScriptedExecutor({
            insert: (sql, params) => {
                if (sql.startsWith("INSERT INTO `sys_user`")) {
                    dupPrimary(String(params[0]));
                }
                return { affectedRows: 1 };
            },
            count: sql => [{ n: sql.includes("CAST(`last_login_at`") || sql.includes("`last_login_at` <=>") ? 1 : 0 }],
        });
        const fingerprint = await computeSchemaFingerprint(executor, DATABASE, [...closureTables(["users"])]);
        const file = buildFile({
            groups: ["users"],
            fingerprint,
            tables: [
                { name: "sys_role" },
                { name: "sys_user", lines: [userLine("1", "guojun", "2", "2020-01-01 00:00:00.000")] },
            ],
        });
        const report = await executeRestore(
            { executor, database: DATABASE, mode: "merge", credential },
            fromBuffer(file),
        );
        expect(report.tables.find(table => table.name === "sys_user")!.skipped).toBe(1);
    });

    it("非豁免列差异 → RestoreAbortedError + ROLLBACK + 不写凭证", async () => {
        const executor = new ScriptedExecutor({
            insert: (sql, params) => {
                if (sql.startsWith("INSERT INTO `sys_role`")) {
                    dupPrimary(String(params[0]));
                }
                return { affectedRows: 1 };
            },
            // 全列一致 → 0；逐列探测：仅 name 列差异
            count: sql => [{ n: sql.includes("`name`") && sql.includes("NOT (") ? 1 : 0 }],
        });
        const file = await mergeFile(executor, [roleLine("conflict", "改名了", "2026-01-01 00:00:00.000")]);
        await expect(
            executeRestore({ executor, database: DATABASE, mode: "merge", credential }, fromBuffer(file)),
        ).rejects.toThrow(RestoreAbortedError);
        const sql = executor.statements.map(statement => statement.sql);
        expect(sql).toContain("ROLLBACK");
        expect(sql.some(statement => statement.startsWith("INSERT INTO sys_restore_job"))).toBe(false);
        expect(sql).not.toContain("COMMIT");
    });

    it("非 PRIMARY 唯一键冲突 → 中止并报告索引名", async () => {
        const executor = new ScriptedExecutor({
            insert: sql => {
                if (sql.startsWith("INSERT INTO `sys_role`")) {
                    dupUnique("uk_sys_role_name");
                }
                return { affectedRows: 1 };
            },
        });
        const file = await mergeFile(executor, [roleLine("x", "重名", "2026-01-01 00:00:00.000")]);
        await expect(
            executeRestore({ executor, database: DATABASE, mode: "merge", credential }, fromBuffer(file)),
        ).rejects.toThrow(/uk_sys_role_name/);
        expect(executor.statements.map(statement => statement.sql)).toContain("ROLLBACK");
    });

    it("biz_sequence 走 GREATEST：affectedRows=2 计入抬升", async () => {
        const executor = new ScriptedExecutor({
            insert: sql => {
                if (sql.startsWith("INSERT INTO `biz_sequence`")) {
                    return { affectedRows: sql.includes("ON DUPLICATE KEY UPDATE") ? 2 : 1 };
                }
                return { affectedRows: 1 };
            },
        });
        const fingerprint = await computeSchemaFingerprint(executor, DATABASE, [...closureTables(["sequences"])]);
        const file = buildFile({
            groups: ["sequences"],
            fingerprint,
            tables: [{ name: "biz_sequence", lines: [sequenceLine("bom", "100"), sequenceLine("cus", "5")] }],
        });
        const report = await executeRestore(
            { executor, database: DATABASE, mode: "merge", credential },
            fromBuffer(file),
        );
        expect(report.tables[0]).toMatchObject({ inserted: 2, sequenceRaised: 2 });
        const sequenceStatement = executor.statements.find(statement =>
            statement.sql.includes("GREATEST(next_value, ?)"),
        );
        expect(sequenceStatement).toBeTruthy();
    });
});

/* ------------------------------------------------------------------ */
/* replace 执行                                                        */
/* ------------------------------------------------------------------ */

describe("executeRestore replace", () => {
    const buildFullFile = async (executor: SqlExecutor): Promise<Buffer> => {
        const fingerprint = await computeSchemaFingerprint(executor, DATABASE, [
            ...closureTables(["users", "logs", "sequences", "materials"]),
        ]);
        return buildFile({
            groups: ["users", "logs", "sequences", "materials"],
            fingerprint,
            tables: [
                { name: "sys_role", lines: [roleLine("super", "超级管理员", "2026-01-01 00:00:00.000")] },
                { name: "sys_user", lines: [userLine("1", "guojun", "2", null)] },
                { name: "op_log" },
                { name: "biz_sequence", lines: [sequenceLine("bom", "10")] },
                { name: "material_group", lines: [materialLine("100", null, "父"), materialLine("500", "100", "子")] },
            ],
        });
    };

    it("完整流程：预检→清理→FK off 逆序删除→插回（token_version 抬升）→孤儿复核→同事务凭证→commit", async () => {
        const executor = new ScriptedExecutor({
            tokenVersions: [{ id: 1n, token_version: 7n }],
        });
        const file = await buildFullFile(executor);
        const report = await executeRestore(
            { executor, database: DATABASE, mode: "replace", credential: { ...credential, mode: "replace" } },
            fromBuffer(file),
        );
        expect(report.tokenVersionsRaised).toBe(1);
        expect(report.apiIdempotencyPurged).toBe(0);

        const sql = executor.statements.map(statement => statement.sql);
        const fkOff = sql.indexOf("SET SESSION FOREIGN_KEY_CHECKS = 0");
        const fkOn = sql.indexOf("SET SESSION FOREIGN_KEY_CHECKS = 1");
        const deleteRole = sql.indexOf("DELETE FROM `sys_role`");
        const deleteUser = sql.indexOf("DELETE FROM `sys_user`");
        const deleteOpLog = sql.indexOf("DELETE FROM `op_log`");
        const credentialIndex = sql.findIndex(statement => statement.startsWith("INSERT INTO sys_restore_job"));
        expect(fkOff).toBeGreaterThan(-1);
        expect(fkOn).toBeGreaterThan(fkOff);
        expect(sql).toContain("DELETE FROM api_idempotency");
        // 逆序：子表先删（op_log 引用 sys_user → 先删）
        expect(deleteOpLog).toBeGreaterThan(-1);
        expect(deleteOpLog).toBeLessThan(deleteUser);
        expect(deleteUser).toBeLessThan(deleteRole);
        expect(deleteRole).toBeLessThan(fkOn);
        expect(credentialIndex).toBeGreaterThan(fkOn);
        expect(sql.indexOf("COMMIT")).toBeGreaterThan(credentialIndex);

        // token_version：恢复前 7 / 备份 2 → 写入 8
        const userInsert = executor.statements.find(statement => statement.sql.startsWith("INSERT INTO `sys_user`"));
        expect(userInsert?.params).toContain(8n);

        // 范围外引用预检执行过（fixture 含 sys_grant → sys_role 的范围外 FK）
        expect(sql.some(statement => statement.includes("EXISTS") && statement.includes("`sys_grant`"))).toBe(true);
        // 孤儿复核执行过
        expect(sql.some(statement => statement.includes("LEFT JOIN") && statement.includes("IS NULL"))).toBe(true);
    });

    it("api_idempotency 有行时计数并清空", async () => {
        const executor = new ScriptedExecutor({
            count: sql => (sql.includes("api_idempotency") ? [{ n: 3 }] : [{ n: 0 }]),
        });
        const file = await buildFullFile(executor);
        const report = await executeRestore(
            { executor, database: DATABASE, mode: "replace", credential: { ...credential, mode: "replace" } },
            fromBuffer(file),
        );
        expect(report.apiIdempotencyPurged).toBe(3);
    });

    it("范围外表仍引用范围内表 → 预检中止", async () => {
        const executor = new ScriptedExecutor({
            count: sql => (sql.includes("EXISTS") ? [{ n: 5 }] : [{ n: 0 }]),
        });
        const file = await buildFullFile(executor);
        await expect(
            executeRestore(
                { executor, database: DATABASE, mode: "replace", credential: { ...credential, mode: "replace" } },
                fromBuffer(file),
            ),
        ).rejects.toThrow(/悬空引用/);
    });

    it("孤儿复核发现孤儿 → 中止回滚", async () => {
        const executor = new ScriptedExecutor({
            count: sql => (sql.includes("LEFT JOIN") ? [{ n: 2 }] : [{ n: 0 }]),
        });
        const file = await buildFullFile(executor);
        await expect(
            executeRestore(
                { executor, database: DATABASE, mode: "replace", credential: { ...credential, mode: "replace" } },
                fromBuffer(file),
            ),
        ).rejects.toThrow(/孤儿行/);
        expect(executor.statements.map(statement => statement.sql)).toContain("ROLLBACK");
    });
});

/* ------------------------------------------------------------------ */
/* 提交结果未知                                                        */
/* ------------------------------------------------------------------ */

describe("提交结果分类", () => {
    it("COMMIT 失败且回滚成功 → 确定性失败（Aborted）", async () => {
        const executor = new ScriptedExecutor({
            commit: () => {
                throw new Error("commit failed deterministically");
            },
        });
        const fingerprint = await computeSchemaFingerprint(executor, DATABASE, [...closureTables(["sequences"])]);
        const file = buildFile({
            groups: ["sequences"],
            fingerprint,
            tables: [{ name: "biz_sequence", lines: [sequenceLine("bom", "10")] }],
        });
        await expect(
            executeRestore({ executor, database: DATABASE, mode: "merge", credential }, fromBuffer(file)),
        ).rejects.toThrow(RestoreAbortedError);
    });

    it("COMMIT 失败且 ROLLBACK 也失败 → RestoreUnknownError（不自动重跑）", async () => {
        const executor = new ScriptedExecutor({
            commit: () => {
                throw Object.assign(new Error("connection lost during commit"), { fatal: true });
            },
            rollback: () => {
                throw new Error("connection already gone");
            },
        });
        const fingerprint = await computeSchemaFingerprint(executor, DATABASE, [...closureTables(["sequences"])]);
        const file = buildFile({
            groups: ["sequences"],
            fingerprint,
            tables: [{ name: "biz_sequence", lines: [sequenceLine("bom", "10")] }],
        });
        await expect(
            executeRestore({ executor, database: DATABASE, mode: "merge", credential }, fromBuffer(file)),
        ).rejects.toThrow(RestoreUnknownError);
    });
});

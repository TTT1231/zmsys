/**
 * 恢复引擎（实施计划 §3；纯模块：node:* + SqlExecutor，merge/replace 两模式同一实现）。
 *
 * 提交语义：
 * - 成功凭证（sys_restore_job SUCCEEDED 行）与恢复数据**同事务**写入；
 * - 预检/内容错误 → RestoreValidationError（HTTP 400）/ BackupLimitError（413）；
 * - 执行期确定性错误（冲突分歧、FK/CHECK 违反）→ 尽力 rollback 后抛 RestoreAbortedError；
 * - COMMIT 回执丢失、连接中断、rollback 失败 → RestoreUnknownError（进入 UNKNOWN 核实流程）；
 * - 执行总是重新流式读取并完整校验文件，不信任 preview 结果。
 *
 * merge：单事务层级序参数化插入；biz_sequence 走 GREATEST 特例；PRIMARY 1062 二分到行
 * 逐列比对（JSON 列用数据库 `<=> CAST(? AS JSON)`，不经 JS 解析）；非 PRIMARY 唯一键
 * 冲突中止回滚。豁免列：sys_user {last_login_at, updated_at}，其余表 {updated_at}。
 *
 * replace：范围外引用预检 → 保存恢复前 token_version → 清 api_idempotency →
 * FK off 逆序整表 DELETE → FK on 按文件序插回（sys_user token_version 按规则 +1）→
 * 范围内 FK 孤儿复核 → 同事务凭证 → commit。
 */
import { createGunzip } from "node:zlib";
import { pipeline, Readable } from "node:stream";
import { CLEANABLE_RUNTIME_TABLES, closureTables, isFullBackupClosure } from "../backup.catalog";
import {
    BackupFormatError,
    bindParam,
    CHECKSUM_PREFIX,
    createChecksumHash,
    FORMAT_END,
    FORMAT_HEADER,
    hashLine,
    MAX_DECOMPRESSED_BYTES,
    MAX_LINE_BYTES,
    META_PREFIX,
    parseInsertLine,
    parseMetaLine,
    SET_NAMES_LINE,
    TABLE_PREFIX,
    valueMatchesColumn,
    type BackupMeta,
    type ParsedValue,
} from "./backup-format";
import {
    computeSchemaFingerprint,
    loadTableSchemas,
    reverseTopologicalTableOrder,
    selfReferenceParentColumn,
    type SqlExecutor,
    type TableSchema,
} from "./db-introspection";

/* ------------------------------------------------------------------ */
/* 错误分类                                                            */
/* ------------------------------------------------------------------ */

/** 内容错误 → HTTP 400（校验/文法/指纹/迁移名不符等） */
export class RestoreValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RestoreValidationError";
    }
}

/** 超限 → HTTP 413（解压超 2GiB / 行超限） */
export class BackupLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BackupLimitError";
    }
}

/** 执行期确定性失败（已尽力回滚；服务侧另写 FAILED 凭证） */
export class RestoreAbortedError extends Error {
    readonly detail: Record<string, unknown>;
    constructor(message: string, detail: Record<string, unknown> = {}, cause?: unknown) {
        super(message);
        this.name = "RestoreAbortedError";
        this.detail = detail;
        if (cause !== undefined) {
            (this as { cause?: unknown }).cause = cause;
        }
    }
}

/** 提交结果未知（COMMIT 回执丢失/断线/回滚失败；进入 UNKNOWN 核实，禁止自动重跑） */
export class RestoreUnknownError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = "RestoreUnknownError";
        if (cause !== undefined) {
            (this as { cause?: unknown }).cause = cause;
        }
    }
}

const isValidationError = (error: unknown): boolean =>
    error instanceof BackupFormatError || error instanceof RestoreValidationError || error instanceof BackupLimitError;

/** 演练专用故障注入（正常部署绝不设置）：见 scripts/restore-drill.ts */
const FAULT = process.env.ZMSYS_RESTORE_FAULT;
const faultExit = (point: string): void => {
    if (FAULT === point) {
        console.error(`[fault-inject] ${point} 触发，进程退出`);
        process.exit(70);
    }
};

/* ------------------------------------------------------------------ */
/* 流式读取                                                            */
/* ------------------------------------------------------------------ */

async function* iteratorToChunks(reader: AsyncIterator<unknown>): AsyncGenerator<Buffer> {
    for (;;) {
        const next = await reader.next();
        if (next.done) return;
        yield Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value as Uint8Array | string);
    }
}

/** 打开（必要时解压的）SQL 字节流；gzip 按魔数识别（首块一并送入解压器） */
export async function openDecompressed(openStream: () => Readable): Promise<Readable> {
    const source = openStream();
    const reader = source[Symbol.asyncIterator]();
    const first = await reader.next();
    if (first.done) {
        return Readable.from([]);
    }
    const head = Buffer.isBuffer(first.value) ? first.value : Buffer.from(first.value as Uint8Array | string);
    const combined = Readable.from(
        (async function* (): AsyncGenerator<Buffer> {
            yield head;
            yield* iteratorToChunks(reader);
        })(),
    );
    if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) {
        const gunzip = createGunzip();
        void pipeline(combined, gunzip, () => undefined);
        return gunzip;
    }
    return combined;
}

/** 逐行读取（LF 分隔；拒绝 CR；行/总量限额在流中累计，不能先收满再检查） */
export async function* readLines(
    stream: Readable,
    maxTotalBytes: number = MAX_DECOMPRESSED_BYTES,
): AsyncGenerator<Buffer> {
    let pending: Buffer = Buffer.alloc(0);
    let total = 0;
    const assertLine = (line: Buffer): void => {
        if (line.length > MAX_LINE_BYTES) {
            throw new BackupLimitError(`单行超过 ${Math.floor(MAX_LINE_BYTES / 1024 / 1024)}MiB 上限`);
        }
    };
    for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > maxTotalBytes) {
            throw new BackupLimitError(`解压后内容超过上限（${Math.floor(maxTotalBytes / 1024 / 1024 / 1024)}GiB）`);
        }
        let start = 0;
        for (let i = 0; i < buffer.length; i += 1) {
            const byte = buffer[i];
            if (byte === 0x0d) {
                throw new BackupFormatError("文件包含 CR（\\r）：备份文件固定 LF");
            }
            if (byte === 0x0a) {
                const line =
                    pending.length === 0
                        ? buffer.subarray(start, i)
                        : Buffer.concat([pending, buffer.subarray(start, i)]);
                assertLine(line);
                yield line;
                pending = Buffer.alloc(0);
                start = i + 1;
            }
        }
        pending = Buffer.concat([pending, buffer.subarray(start)]);
        assertLine(pending);
    }
    if (pending.length > 0) {
        yield pending;
    }
}

async function nextLine(lines: AsyncGenerator<Buffer>): Promise<Buffer | undefined> {
    const next = await lines.next();
    return next.done ? undefined : next.value;
}

/* ------------------------------------------------------------------ */
/* 上下文与校验                                                        */
/* ------------------------------------------------------------------ */

export type RestoreMode = "merge" | "replace";

export interface RestoreCredential {
    jobId: bigint;
    requestKey: string;
    fileSha256: string;
    mode: RestoreMode;
    operatorId: bigint;
    operatorName: string;
}

export interface ServerExpectation {
    serverVersion: string;
    latestMigration: string;
    schemaFingerprint: string;
}

export interface TableValidationStats {
    table: string;
    rowCount: number;
    insertStatements: number;
}

export interface ValidatedBackup {
    meta: BackupMeta;
    fullBackup: boolean;
    tables: TableValidationStats[];
    schema: Map<string, TableSchema>;
}

/** 目标库现状（指纹/迁移名/版本），供与 meta 比对 */
export async function readServerExpectation(
    q: SqlExecutor,
    database: string,
    tables: readonly string[],
): Promise<ServerExpectation> {
    const versionRow = await q.query<Array<{ v: string }>>("SELECT VERSION() AS v");
    const migrationRows = await q.query<Array<{ migration_name: string }>>(
        "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1",
    );
    if (migrationRows.length === 0) {
        throw new RestoreValidationError("目标库缺少迁移记录（_prisma_migrations 为空）");
    }
    return {
        serverVersion: versionRow[0]?.v ?? "",
        latestMigration: migrationRows[0].migration_name,
        schemaFingerprint: await computeSchemaFingerprint(q, database, tables),
    };
}

/**
 * 完整流式校验（计划 §3-1）：checksum（含 meta）、文法、白名单表、列清单、类型匹配、
 * 行数一致、表序满足 FK 拓扑、自引用父先子后；指纹/迁移名/版本一致。
 * 不执行任何写操作，不整份驻留内存（自引用表仅跟踪 id 集合）。
 */
export async function validateBackup(
    q: SqlExecutor,
    database: string,
    openStream: () => Readable,
    mode: RestoreMode,
): Promise<ValidatedBackup> {
    const stream = await openDecompressed(openStream);
    const lines = readLines(stream);
    const hash = createChecksumHash();

    const first = await nextLine(lines);
    if (first === undefined || first.toString("utf8") !== FORMAT_HEADER) {
        throw new RestoreValidationError("缺少固定文件头（-- zmsys-backup v1）");
    }
    const second = await nextLine(lines);
    if (second === undefined || !second.toString("utf8").startsWith(META_PREFIX)) {
        throw new RestoreValidationError("文件头后缺少 meta 行");
    }
    let meta: BackupMeta;
    try {
        meta = parseMetaLine(second.toString("utf8"));
    } catch (error) {
        throw new RestoreValidationError(error instanceof Error ? error.message : String(error));
    }
    hashLine(hash, second);

    // 分组与闭包
    let expectedTables: Set<string>;
    try {
        expectedTables = closureTables(meta.groups);
    } catch (error) {
        throw new RestoreValidationError(error instanceof Error ? error.message : String(error));
    }
    const metaTableNames = meta.tables.map(table => table.name);
    if (metaTableNames.length !== new Set(metaTableNames).size) {
        throw new RestoreValidationError("meta.tables 存在重复表");
    }
    const metaTableSet = new Set(metaTableNames);
    for (const table of expectedTables) {
        if (!metaTableSet.has(table)) {
            throw new RestoreValidationError(`meta.tables 缺少闭包表 ${table}`);
        }
    }
    for (const table of metaTableSet) {
        if (!expectedTables.has(table)) {
            throw new RestoreValidationError(`meta.tables 含超出分组闭包的表 ${table}`);
        }
    }
    const fullBackup = isFullBackupClosure(meta.groups);
    if (mode === "replace" && !fullBackup) {
        throw new RestoreValidationError("部分备份不得执行 replace（仅完整备份可整库快照还原）");
    }

    // 与目标库现状比对（指纹/迁移名/大版本）
    const schema = await loadTableSchemas(q, database, [...expectedTables]);
    const expectation = await readServerExpectation(q, database, [...expectedTables]);
    if (meta.serverProduct !== "MySQL") {
        throw new RestoreValidationError(`备份来自不支持的数据库产品：${meta.serverProduct}`);
    }
    const majorOf = (version: string): string => version.split(".")[0] ?? "";
    if (majorOf(meta.serverVersion) !== majorOf(expectation.serverVersion)) {
        throw new RestoreValidationError(
            `服务器大版本不一致：备份 ${meta.serverVersion} / 目标 ${expectation.serverVersion}`,
        );
    }
    if (meta.latestMigration !== expectation.latestMigration) {
        throw new RestoreValidationError(
            `迁移基线不一致：备份 ${meta.latestMigration} / 目标 ${expectation.latestMigration}`,
        );
    }
    if (meta.schemaFingerprint !== expectation.schemaFingerprint) {
        throw new RestoreValidationError("schema 指纹不一致（表结构与备份时不符）");
    }

    const setNamesLine = await nextLine(lines);
    if (setNamesLine === undefined || setNamesLine.toString("utf8") !== SET_NAMES_LINE) {
        throw new RestoreValidationError("meta 行后必须是固定的 SET NAMES utf8mb4;");
    }
    hashLine(hash, setNamesLine);

    // 表段与 INSERT（单对象承载当前段，避免平行变量的控制流漂移）
    interface CurrentSection {
        table: string;
        schema: TableSchema;
        columns: string[];
        selfRefParentColumn: string | null;
        selfRefIdColumn: string | null;
        seenIds: Set<string> | null;
    }
    const stats = new Map<string, TableValidationStats>();
    const sectionPosition = new Map<string, number>();
    const rowCountByTable = new Map(meta.tables.map(table => [table.name, table.rowCount]));
    let currentSection: CurrentSection | null = null;

    const openSection = (table: string): CurrentSection => {
        if (!expectedTables.has(table)) {
            throw new RestoreValidationError(`表 ${table} 不在备份分组闭包白名单内`);
        }
        if (stats.has(table)) {
            throw new RestoreValidationError(`表 ${table} 存在重复段`);
        }
        const tableSchema = schema.get(table)!;
        const parentColumn = selfReferenceParentColumn(tableSchema);
        const section: CurrentSection = {
            table,
            schema: tableSchema,
            columns: tableSchema.columns.map(column => column.name),
            selfRefParentColumn: parentColumn,
            selfRefIdColumn:
                parentColumn === null ? null : tableSchema.foreignKeys.find(fk => fk.refTable === table)!.refColumns[0],
            seenIds: parentColumn === null ? null : new Set<string>(),
        };
        sectionPosition.set(table, sectionPosition.size);
        stats.set(table, { table, rowCount: 0, insertStatements: 0 });
        return section;
    };

    for (;;) {
        const raw = await nextLine(lines);
        if (raw === undefined) {
            throw new RestoreValidationError("文件在 checksum 前结束（不完整）");
        }
        const line = raw.toString("utf8");
        if (line.startsWith(CHECKSUM_PREFIX)) {
            const expected = hash.digest("hex");
            const actual = line.slice(CHECKSUM_PREFIX.length);
            if (!/^[0-9a-f]{64}$/.test(actual) || actual !== expected) {
                throw new RestoreValidationError("checksum 校验失败（文件内容与摘要不符）");
            }
            break;
        }
        hashLine(hash, raw);
        if (line.startsWith(TABLE_PREFIX)) {
            const table = line.slice(TABLE_PREFIX.length).trim();
            if (!/^[A-Za-z0-9_]+$/.test(table)) {
                throw new RestoreValidationError(`表段标记非法：${line.slice(0, 60)}`);
            }
            currentSection = openSection(table);
            continue;
        }
        if (line.startsWith("--") || line.length === 0) {
            throw new RestoreValidationError("不接受任意注释或空行");
        }
        if (!line.startsWith("INSERT INTO ")) {
            throw new RestoreValidationError(`无法识别的语句行：${line.slice(0, 60)}`);
        }
        const section = currentSection;
        if (section === null) {
            throw new RestoreValidationError("INSERT 出现在任何表段之前");
        }
        let parsed: { table: string; columns: string[]; rows: ParsedValue[][] };
        try {
            parsed = parseInsertLine(line);
        } catch (error) {
            throw new RestoreValidationError(
                `表 ${section.table}：${error instanceof Error ? error.message : String(error)}`,
            );
        }
        if (parsed.table !== section.table) {
            throw new RestoreValidationError(`INSERT 目标表 ${parsed.table} 与所在表段 ${section.table} 不符`);
        }
        if (parsed.columns.join("\u0000") !== section.columns.join("\u0000")) {
            throw new RestoreValidationError(`表 ${section.table} 列清单与实际结构不一致`);
        }
        const columnSchemas = section.schema.columns;
        const stat = stats.get(section.table)!;
        for (const row of parsed.rows) {
            for (let i = 0; i < row.length; i += 1) {
                const column = columnSchemas[i];
                try {
                    valueMatchesColumn(row[i], column.family, column.nullable);
                } catch (error) {
                    throw new RestoreValidationError(
                        `表 ${section.table} 列 ${column.name}：${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }
            if (section.seenIds !== null && section.selfRefIdColumn !== null && section.selfRefParentColumn !== null) {
                verifySelfReferenceOrder(
                    section.table,
                    row,
                    section.columns,
                    section.selfRefIdColumn,
                    section.selfRefParentColumn,
                    section.seenIds,
                );
            }
        }
        stat.rowCount += parsed.rows.length;
        stat.insertStatements += 1;
    }

    // 段声明集合 = 闭包集合（空表也必须有段标记）
    for (const table of expectedTables) {
        if (!stats.has(table)) {
            throw new RestoreValidationError(`缺少表段：${table}`);
        }
    }
    for (const [table, stat] of stats) {
        const declared = rowCountByTable.get(table);
        if (declared === undefined || declared !== stat.rowCount) {
            throw new RestoreValidationError(
                `表 ${table} 行数不一致：meta 声明 ${declared ?? "-"} / 实际 ${stat.rowCount}`,
            );
        }
    }
    // 表段顺序满足 FK 拓扑（非自引用：父表段在前）
    for (const tableSchema of schema.values()) {
        for (const fk of tableSchema.foreignKeys) {
            if (fk.refTable === tableSchema.table) continue;
            if (!sectionPosition.has(fk.refTable) || !sectionPosition.has(tableSchema.table)) continue;
            if (sectionPosition.get(fk.refTable)! >= sectionPosition.get(tableSchema.table)!) {
                throw new RestoreValidationError(
                    `表段顺序违反外键依赖：${tableSchema.table} 引用 ${fk.refTable}，但父表段未在前`,
                );
            }
        }
    }

    const endLine = await nextLine(lines);
    if (endLine === undefined || endLine.toString("utf8") !== FORMAT_END) {
        throw new RestoreValidationError("checksum 后缺少结束标记");
    }
    const trailing = await nextLine(lines);
    if (trailing !== undefined) {
        throw new RestoreValidationError("结束标记后仍有追加内容");
    }

    return { meta, fullBackup, tables: [...stats.values()], schema };
}

function verifySelfReferenceOrder(
    table: string,
    row: ParsedValue[],
    columns: readonly string[],
    idColumn: string,
    parentColumn: string,
    seenIds: Set<string>,
): void {
    const idIndex = columns.indexOf(idColumn);
    const parentIndex = columns.indexOf(parentColumn);
    const parentValue = row[parentIndex];
    if (parentValue.kind === "int" || parentValue.kind === "decimal") {
        const parentText = BigInt(parentValue.text).toString();
        if (!seenIds.has(parentText)) {
            throw new RestoreValidationError(`表 ${table} 自引用行顺序错误：父行（${parentText}）未先于子行出现`);
        }
    } else if (parentValue.kind !== "null") {
        throw new RestoreValidationError(`表 ${table} 自引用父列类型非法`);
    }
    const idValue = row[idIndex];
    if (idValue.kind === "int" || idValue.kind === "decimal") {
        seenIds.add(BigInt(idValue.text).toString());
    } else {
        throw new RestoreValidationError(`表 ${table} 自引用 id 列类型非法`);
    }
}

/* ------------------------------------------------------------------ */
/* 执行                                                                */
/* ------------------------------------------------------------------ */

export interface TableReport {
    name: string;
    inserted: number;
    skipped: number;
    /** biz_sequence GREATEST 抬升计数 */
    sequenceRaised: number;
}

export interface RestoreReport {
    mode: RestoreMode;
    startedAt: string;
    finishedAt: string;
    tables: TableReport[];
    /** replace：token_version 被抬升的用户数 */
    tokenVersionsRaised: number;
    /** replace：随恢复清理的幂等占位行数 */
    apiIdempotencyPurged: number;
}

export interface ExecuteRestoreOptions {
    executor: SqlExecutor;
    database: string;
    mode: RestoreMode;
    credential: RestoreCredential;
}

/** merge 冲突豁免列（其余表仅 updated_at） */
const EXEMPT_COLUMNS: Record<string, readonly string[]> = {
    sys_user: ["last_login_at", "updated_at"],
};
const DEFAULT_EXEMPT = ["updated_at"];

/** 单批插入行数上限（占位符 65535 内留余量；文件侧仍按 1000 行/1MiB 切批） */
const INSERT_BATCH_ROWS = 400;

interface TokenOverride {
    preTokenVersions: Map<string, bigint>;
    idIndex: number;
    tokenVersionIndex: number;
    onRaised: () => void;
}

export async function executeRestore(
    options: ExecuteRestoreOptions,
    openStream: () => Readable,
): Promise<RestoreReport> {
    const { executor, database, mode, credential } = options;
    const startedAt = new Date();
    // 执行前重新完整校验（不信任 preview）
    const validated = await validateBackup(executor, database, openStream, mode);

    const reports: TableReport[] = [];
    let tokenVersionsRaised = 0;
    let apiIdempotencyPurged = 0;
    let preTokenVersions = new Map<string, bigint>();

    if (mode === "replace") {
        // ① 范围外表引用预检（FK 图 + EXISTS；可清理运行表除外）
        await precheckOutsideReferences(executor, database, validated);
        // 恢复前用户 token_version（replace 会话例外的基准）
        preTokenVersions = await readTokenVersions(executor);
    }

    let inTransaction = false;
    try {
        await executor.query("START TRANSACTION");
        inTransaction = true;
        faultExit("exit-in-transaction");

        if (mode === "replace") {
            const purged = await executor.query<Array<{ n: number | bigint }>>(
                "SELECT COUNT(*) AS n FROM api_idempotency",
            );
            apiIdempotencyPurged = Number(purged[0]?.n ?? 0);
            await executor.query("DELETE FROM api_idempotency");
            await executor.query("SET SESSION FOREIGN_KEY_CHECKS = 0");
            const deleteOrder = reverseTopologicalTableOrder(validated.schema);
            for (const table of deleteOrder) {
                await executor.query(`DELETE FROM \`${table}\``);
            }
            await executor.query("SET SESSION FOREIGN_KEY_CHECKS = 1");
        }

        // 数据插回/补插：按文件序流式读取（校验已确认父先子后与列序一致）
        const stream = await openDecompressed(openStream);
        const lines = readLines(stream);
        interface InsertSection {
            table: string;
            schema: TableSchema;
            columns: string[];
            report: TableReport;
            tokenOverride: TokenOverride | null;
        }
        let section: InsertSection | null = null;
        let batchRows: ParsedValue[][] = [];

        const flushBatch = async (): Promise<void> => {
            const active = section;
            if (active === null || batchRows.length === 0) {
                return;
            }
            if (active.table === "biz_sequence") {
                for (const row of batchRows) {
                    await insertSequenceRow(executor, active.columns, row, active.report);
                }
            } else {
                await insertBatchWithDuplicateHandling(
                    executor,
                    active.table,
                    active.columns,
                    batchRows,
                    active.schema,
                    active.report,
                    active.tokenOverride,
                );
            }
            batchRows = [];
        };

        for (;;) {
            const raw = await nextLine(lines);
            if (raw === undefined) break;
            const line = raw.toString("utf8");
            if (line.startsWith(TABLE_PREFIX)) {
                await flushBatch();
                const table = line.slice(TABLE_PREFIX.length).trim();
                const tableSchema = validated.schema.get(table)!;
                const columns = tableSchema.columns.map(column => column.name);
                const report: TableReport = { name: table, inserted: 0, skipped: 0, sequenceRaised: 0 };
                reports.push(report);
                let tokenOverride: TokenOverride | null = null;
                if (mode === "replace" && table === "sys_user") {
                    const tokenVersionIndex = columns.indexOf("token_version");
                    const idIndex =
                        tableSchema.primaryKey.length === 1 ? columns.indexOf(tableSchema.primaryKey[0]) : -1;
                    if (tokenVersionIndex >= 0 && idIndex >= 0) {
                        tokenOverride = {
                            preTokenVersions,
                            idIndex,
                            tokenVersionIndex,
                            onRaised: () => {
                                tokenVersionsRaised += 1;
                            },
                        };
                    }
                }
                section = { table, schema: tableSchema, columns, report, tokenOverride };
                continue;
            }
            if (line.startsWith("INSERT INTO ")) {
                const parsed = parseInsertLine(line);
                batchRows.push(...parsed.rows);
                if (batchRows.length >= INSERT_BATCH_ROWS) {
                    await flushBatch();
                }
            }
        }
        await flushBatch();

        if (mode === "replace") {
            await verifyNoOrphans(executor, validated.schema);
        }

        // 成功凭证与恢复数据同事务
        const finishedAt = new Date();
        const restoreReport: RestoreReport = {
            mode,
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            tables: reports,
            tokenVersionsRaised,
            apiIdempotencyPurged,
        };
        await insertCredentialRow(executor, credential, "SUCCEEDED", restoreReport, "", startedAt, finishedAt);

        faultExit("exit-before-commit");
        const commitPromise = executor.query("COMMIT");
        if (FAULT === "commit-receipt-lost") {
            // 已派发 COMMIT（服务端大概率已提交）后模拟回执丢失 → UNKNOWN
            await new Promise(resolve => setImmediate(resolve));
            throw new RestoreUnknownError("注入故障：COMMIT 回执丢失");
        }
        await commitPromise;
        faultExit("exit-after-commit");
        return restoreReport;
    } catch (error) {
        if (error instanceof RestoreUnknownError) {
            // 回执丢失：事务状态未知，由服务侧销毁连接并走核实流程
            throw error;
        }
        if (isValidationError(error)) {
            await rollbackQuietly(executor);
            throw error;
        }
        if (inTransaction) {
            await rollbackOrUnknown(executor, error);
        }
        throw error instanceof RestoreAbortedError
            ? error
            : new RestoreAbortedError(
                  error instanceof Error ? error.message : String(error),
                  { stage: "execute" },
                  error,
              );
    }
}

async function rollbackQuietly(executor: SqlExecutor): Promise<void> {
    try {
        await executor.query("ROLLBACK");
    } catch {
        // 校验失败时可能尚未开启事务；错误仍如实上抛
    }
}

async function rollbackOrUnknown(executor: SqlExecutor, cause: unknown): Promise<void> {
    try {
        await executor.query("ROLLBACK");
    } catch (rollbackError) {
        throw new RestoreUnknownError("回滚失败，提交结果未知", rollbackError instanceof Error ? rollbackError : cause);
    }
}

/* ------------------------------------------------------------------ */
/* merge 冲突分诊                                                      */
/* ------------------------------------------------------------------ */

interface DuplicateKeyLike {
    errno?: unknown;
    code?: unknown;
    message?: unknown;
}

/** 1062 判定；返回命中的索引名（PRIMARY / uk_*），非 1062 返回 null。
 * MySQL 8 消息形如 "for key 'bom_category.PRIMARY'"（8.0.19+ 带表名前缀），取末段归一化 */
const isDuplicateEntry = (error: unknown): string | null => {
    if (typeof error !== "object" || error === null) return null;
    const candidate = error as DuplicateKeyLike;
    if (candidate.errno !== 1062 && candidate.code !== "ER_DUP_ENTRY") return null;
    const message = typeof candidate.message === "string" ? candidate.message : String(candidate.message ?? "");
    const match = /for key '(?:.+\.)?([^'.]+)'/.exec(message);
    return match ? match[1] : "";
};

const backtick = (name: string): string => `\`${name}\``;

async function insertBatchWithDuplicateHandling(
    executor: SqlExecutor,
    table: string,
    columns: string[],
    rows: ParsedValue[][],
    schema: TableSchema,
    report: TableReport,
    tokenOverride: TokenOverride | null,
): Promise<void> {
    if (rows.length === 0) return;
    try {
        await insertPlain(executor, table, columns, rows, tokenOverride);
        report.inserted += rows.length;
        return;
    } catch (error) {
        const keyName = isDuplicateEntry(error);
        if (keyName === null) throw error;
        if (keyName !== "PRIMARY") {
            throw new RestoreAbortedError(
                `表 ${table} 命中非主键唯一索引 ${keyName} 冲突，整体回滚`,
                { table, uniqueIndex: keyName },
                error,
            );
        }
        await insertRowsIndividually(executor, table, columns, rows, schema, report, tokenOverride);
    }
}

async function insertRowsIndividually(
    executor: SqlExecutor,
    table: string,
    columns: string[],
    rows: ParsedValue[][],
    schema: TableSchema,
    report: TableReport,
    tokenOverride: TokenOverride | null,
): Promise<void> {
    if (rows.length === 1) {
        try {
            await insertPlain(executor, table, columns, rows, tokenOverride);
            report.inserted += 1;
            return;
        } catch (error) {
            const keyName = isDuplicateEntry(error);
            if (keyName === null) throw error;
            if (keyName !== "PRIMARY") {
                throw new RestoreAbortedError(
                    `表 ${table} 命中非主键唯一索引 ${keyName} 冲突，整体回滚`,
                    { table, uniqueIndex: keyName },
                    error,
                );
            }
            await compareAndResolve(executor, table, columns, rows[0], schema, report);
            return;
        }
    }
    const mid = Math.floor(rows.length / 2);
    await insertRowsIndividually(executor, table, columns, rows.slice(0, mid), schema, report, tokenOverride);
    await insertRowsIndividually(executor, table, columns, rows.slice(mid), schema, report, tokenOverride);
}

function insertPlain(
    executor: SqlExecutor,
    table: string,
    columns: string[],
    rows: ParsedValue[][],
    tokenOverride: TokenOverride | null,
): Promise<unknown> {
    const columnList = columns.map(backtick).join(", ");
    const rowPlaceholders = rows.map(() => `(${columns.map(() => "?").join(", ")})`).join(",");
    const params: unknown[] = [];
    for (const row of rows) {
        for (let i = 0; i < row.length; i += 1) {
            if (tokenOverride !== null && i === tokenOverride.tokenVersionIndex) {
                const idValue = row[tokenOverride.idIndex];
                if (!(idValue.kind === "int" || idValue.kind === "decimal")) {
                    throw new RestoreAbortedError("sys_user id 列类型非法，无法计算 token_version");
                }
                const idText = BigInt(idValue.text).toString();
                const pre = tokenOverride.preTokenVersions.get(idText) ?? 0n;
                const tokenValue = row[i];
                const backupValue = tokenValue.kind === "int" ? BigInt(tokenValue.text) : 0n;
                const base = pre > backupValue ? pre : backupValue;
                const next = base + 1n;
                if (next !== backupValue) {
                    tokenOverride.onRaised();
                }
                params.push(next);
                continue;
            }
            params.push(bindParam(row[i]));
        }
    }
    return executor.query(`INSERT INTO ${backtick(table)} (${columnList}) VALUES ${rowPlaceholders}`, params);
}

/** 单行 PRIMARY 冲突：逐列无损比对；JSON 列由数据库比较（<=> CAST(? AS JSON)），文本族按字节比较 */
async function compareAndResolve(
    executor: SqlExecutor,
    table: string,
    columns: string[],
    row: ParsedValue[],
    schema: TableSchema,
    report: TableReport,
): Promise<void> {
    const pkColumns = schema.primaryKey;
    if (pkColumns.length === 0) {
        throw new RestoreAbortedError(`表 ${table} 无主键但发生 PRIMARY 冲突`, { table });
    }
    const pkIndexes = pkColumns.map(column => columns.indexOf(column));
    const pkParams = pkIndexes.map(index => bindParam(row[index]));
    const pkWhere = pkColumns.map(column => `${backtick(column)} = ?`).join(" AND ");

    const probes: Array<{ column: string; sql: string; param: unknown }> = [];
    for (let i = 0; i < columns.length; i += 1) {
        const column = schema.columns[i];
        const param = bindParam(row[i]);
        let condition: string;
        if (column.family === "json") {
            condition = `${backtick(column.name)} <=> CAST(? AS JSON)`;
        } else if (column.family === "string") {
            condition = `CAST(${backtick(column.name)} AS BINARY) <=> CAST(? AS BINARY)`;
        } else {
            condition = `${backtick(column.name)} <=> ?`;
        }
        probes.push({ column: column.name, sql: condition, param });
    }
    const identical = await executor.query<Array<{ n: number | bigint }>>(
        `SELECT COUNT(*) AS n FROM ${backtick(table)} WHERE ${pkWhere} AND ${probes.map(probe => probe.sql).join(" AND ")}`,
        [...pkParams, ...probes.map(probe => probe.param)],
    );
    if (Number(identical[0]?.n ?? 0) === 1) {
        report.skipped += 1;
        return;
    }
    const diffColumns: string[] = [];
    for (const probe of probes) {
        const result = await executor.query<Array<{ n: number | bigint }>>(
            `SELECT COUNT(*) AS n FROM ${backtick(table)} WHERE ${pkWhere} AND NOT (${probe.sql})`,
            [...pkParams, probe.param],
        );
        if (Number(result[0]?.n ?? 0) > 0) {
            diffColumns.push(probe.column);
        }
    }
    const exempt = EXEMPT_COLUMNS[table] ?? DEFAULT_EXEMPT;
    const nonExempt = diffColumns.filter(column => !exempt.includes(column));
    if (nonExempt.length > 0) {
        const pkText = pkParams.map(param => (typeof param === "bigint" ? param.toString() : String(param))).join(",");
        throw new RestoreAbortedError(
            `表 ${table} 主键 ${pkText} 内容不一致（差异列：${nonExempt.join(", ")}），整体回滚`,
            { table, primaryKey: pkText, diffColumns: nonExempt },
        );
    }
    // 差异 ⊆ 豁免列：跳过保留目标值
    report.skipped += 1;
}

/** biz_sequence 特例：INSERT ... ON DUPLICATE KEY UPDATE next_value = GREATEST(next_value, ?) */
async function insertSequenceRow(
    executor: SqlExecutor,
    columns: string[],
    row: ParsedValue[],
    report: TableReport,
): Promise<void> {
    const params = row.map(value => bindParam(value));
    const nextValueIndex = columns.indexOf("next_value");
    if (nextValueIndex < 0) {
        throw new RestoreAbortedError("biz_sequence 缺少 next_value 列");
    }
    const columnList = columns.map(backtick).join(", ");
    const placeholders = `(${columns.map(() => "?").join(", ")})`;
    const result = (await executor.query<{ affectedRows?: number }>(
        `INSERT INTO \`biz_sequence\` (${columnList}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE next_value = GREATEST(next_value, ?)`,
        [...params, params[nextValueIndex]],
    )) as { affectedRows?: number };
    const affected = Number(result?.affectedRows ?? 1);
    if (affected >= 2) {
        // 更新（抬升）
        report.sequenceRaised += 1;
        report.inserted += 1;
    } else if (affected === 1) {
        report.inserted += 1;
    } else {
        // 无变化（GREATEST 后等于现值）
        report.skipped += 1;
    }
}

/* ------------------------------------------------------------------ */
/* replace 专属                                                        */
/* ------------------------------------------------------------------ */

async function readTokenVersions(executor: SqlExecutor): Promise<Map<string, bigint>> {
    const rows = await executor.query<Array<{ id: unknown; token_version: unknown }>>(
        "SELECT id, token_version FROM sys_user",
    );
    const map = new Map<string, bigint>();
    for (const row of rows) {
        map.set(String(row.id), BigInt(row.token_version as bigint | number | string));
    }
    return map;
}

/** 范围外表引用预检：除可清理运行表外，任何指向范围内表的外键存在行即中止 */
async function precheckOutsideReferences(
    executor: SqlExecutor,
    database: string,
    validated: ValidatedBackup,
): Promise<void> {
    const scope = [...validated.schema.keys()];
    const placeholders = scope.map(() => "?").join(", ");
    const refs = await executor.query<
        Array<{
            TABLE_NAME: string;
            CONSTRAINT_NAME: string;
            COLUMN_NAME: string;
            REFERENCED_TABLE_NAME: string;
            REFERENCED_COLUMN_NAME: string;
        }>
    >(
        `SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IN (${placeholders})
         ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
        [database, ...scope],
    );
    const grouped = new Map<string, { table: string; columns: string[]; refTable: string; refColumns: string[] }>();
    for (const row of refs) {
        if (scope.includes(row.TABLE_NAME)) continue;
        const key = `${row.TABLE_NAME}\u0000${row.CONSTRAINT_NAME}`;
        let entry = grouped.get(key);
        if (!entry) {
            entry = { table: row.TABLE_NAME, columns: [], refTable: row.REFERENCED_TABLE_NAME, refColumns: [] };
            grouped.set(key, entry);
        }
        entry.columns.push(row.COLUMN_NAME);
        entry.refColumns.push(row.REFERENCED_COLUMN_NAME);
    }
    for (const entry of grouped.values()) {
        if (CLEANABLE_RUNTIME_TABLES.includes(entry.table)) continue;
        const join = entry.columns
            .map((column, i) => `o.${backtick(column)} = i.${backtick(entry.refColumns[i])}`)
            .join(" AND ");
        const existing = await executor.query<Array<{ n: number | bigint }>>(
            `SELECT COUNT(*) AS n FROM ${backtick(entry.table)} o
             WHERE EXISTS (SELECT 1 FROM ${backtick(entry.refTable)} i WHERE ${join})`,
        );
        if (Number(existing[0]?.n ?? 0) > 0) {
            throw new RestoreAbortedError(
                `范围外表 ${entry.table}（${entry.columns.join(",")}）仍引用 ${entry.refTable}，replace 将产生悬空引用`,
                { table: entry.table, constraint: entry.columns.join(",") },
            );
        }
    }
}

/** 范围内 FK 孤儿复核（插回后、凭证前） */
async function verifyNoOrphans(executor: SqlExecutor, schemas: Map<string, TableSchema>): Promise<void> {
    for (const schema of schemas.values()) {
        for (const fk of schema.foreignKeys) {
            const parent = schemas.get(fk.refTable);
            if (!parent || parent.primaryKey.length !== fk.refColumns.length) continue;
            const join = fk.columns
                .map((column, i) => `c.${backtick(column)} = p.${backtick(fk.refColumns[i])}`)
                .join(" AND ");
            const notNull = fk.columns.map(column => `c.${backtick(column)} IS NOT NULL`).join(" AND ");
            const parentNull = fk.refColumns.map(column => `p.${backtick(column)} IS NULL`).join(" AND ");
            const orphans = await executor.query<Array<{ n: number | bigint }>>(
                `SELECT COUNT(*) AS n FROM ${backtick(schema.table)} c
                 LEFT JOIN ${backtick(fk.refTable)} p ON ${join}
                 WHERE ${notNull} AND ${parentNull}`,
            );
            if (Number(orphans[0]?.n ?? 0) > 0) {
                throw new RestoreAbortedError(`表 ${schema.table} 外键 ${fk.name} 存在孤儿行，恢复数据不完整`, {
                    table: schema.table,
                    constraint: fk.name,
                });
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* 凭证                                                                */
/* ------------------------------------------------------------------ */

/** Date → 驱动可接受的 UTC DATETIME(3) 字面量（显式字符串，不依赖 Date 序列化方向） */
export function toMariaDatetime(date: Date): string {
    return date.toISOString().slice(0, 23).replace("T", " ");
}

export async function insertCredentialRow(
    executor: SqlExecutor,
    credential: RestoreCredential,
    status: "SUCCEEDED" | "SUCCEEDED_AUDIT_FAILED" | "FAILED",
    report: RestoreReport,
    errorText: string,
    createdAt: Date,
    finishedAt: Date,
): Promise<void> {
    await executor.query(
        `INSERT INTO sys_restore_job
             (id, request_key, file_sha256, mode, status, operator_id, operator_name, report_json, error_text, created_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            credential.jobId,
            credential.requestKey,
            credential.fileSha256,
            credential.mode,
            status,
            credential.operatorId,
            credential.operatorName,
            JSON.stringify(report),
            errorText,
            toMariaDatetime(createdAt),
            toMariaDatetime(finishedAt),
        ],
    );
}

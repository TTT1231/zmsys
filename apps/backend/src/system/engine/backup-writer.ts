/**
 * 备份写侧（实施计划 §5）：单连接显式 REPEATABLE READ + CONSISTENT SNAPSHOT →
 * COUNT 进 meta → 依赖顺序 queryStream → Readable 背压 → 按需 gzip(6)。
 *
 * - 表序：information_schema FK 拓扑（topologicalTableOrder）；自引用表
 *   （material_group / stock_adjustment / outbound_ledger）按递归 CTE 深度父先子后、
 *   同层主键序输出——NULL-first 排序不能替代行依赖顺序；
 * - 字节上限与恢复器一致（SQL 平文 2GiB、单行 8MiB），超限中止导出、不输出尾标记；
 * - 流开始后发生错误终止流，不向 SQL 文件尾部混入 JSON 错误信封；
 * - 结束后 ROLLBACK 释放快照；连接由调用方（服务/CLI）负责销毁。
 */
import { createHash } from "node:crypto";
import { createGzip } from "node:zlib";
import { pipeline, Readable } from "node:stream";
import {
    FORMAT_END,
    FORMAT_HEADER,
    MAX_BATCH_ROWS,
    MAX_BATCH_TARGET_BYTES,
    MAX_DECOMPRESSED_BYTES,
    MAX_ROW_BYTES,
    SET_NAMES_LINE,
    checksumLineOf,
    encodeMetaLine,
    hashLine,
    serializeColumnValue,
    type BackupMeta,
} from "./backup-format";
import {
    loadTableSchemas,
    primaryKeyOrderBy,
    selfReferenceParentColumn,
    topologicalTableOrder,
    type SqlExecutor,
    type TableSchema,
} from "./db-introspection";
import { closureTables } from "../backup.catalog";
import { readServerExpectation } from "./restore-engine";

/** 支持流式读取的执行器（mariadb 专用连接适配；测试可用内存行实现） */
export interface SqlStreamingExecutor extends SqlExecutor {
    queryStream<T = Record<string, unknown>>(sql: string): AsyncIterable<T>;
}

export interface BackupWriterOptions {
    executor: SqlStreamingExecutor;
    database: string;
    /** 预定文件名（审计先行时由调用方先算出，保持 op_log 与附件名一致）；缺省内部生成 */
    fileName?: string;
    /** 选中的分组（闭包在内部展开）；空数组 = 拒绝 */
    groups: readonly string[];
    gzip: boolean;
}

export interface BackupStreamHandle {
    /** 最终输出流（gzip 或平文 SQL 字节） */
    stream: Readable;
    /** 备份完成（快照已释放）；失败 reject，流终止 */
    done: Promise<void>;
    fileName: string;
    /** 完成后可用：实际 SQL 平文字节数 */
    sqlBytes: () => number;
    /** 完成后可用：写出的 meta（含每表行数） */
    meta: () => BackupMeta;
}

const pad = (value: number): string => String(value).padStart(2, "0");

export function backupFileName(database: string, groups: readonly string[], gzip: boolean, now = new Date()): string {
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const scope = groups.length === 0 ? "full" : groups.length === 1 ? groups[0] : `partial-${groups.length}`;
    return `${database}-${scope}-${stamp}.sql${gzip ? ".gz" : ""}`;
}

/** 生成备份字节流；调用方负责连接生命周期（done 后连接可复用/销毁） */
export async function createBackupStream(options: BackupWriterOptions): Promise<BackupStreamHandle> {
    const { executor, database, groups, gzip } = options;
    if (groups.length === 0) {
        throw new Error("未选择任何备份分组");
    }
    const tables = closureTables(groups);
    const tableOrder = [...tables].sort();

    // 一致性快照：REPEATABLE READ + WITH CONSISTENT SNAPSHOT（COUNT 与行数据同快照）
    await executor.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await executor.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");

    const schemas = await loadTableSchemas(executor, database, tableOrder);
    const orderedTables = topologicalTableOrder(schemas);
    const expectation = await readServerExpectation(executor, database, tableOrder);

    const counts = new Map<string, number>();
    for (const table of orderedTables) {
        const rows = await executor.query<Array<{ n: number | bigint }>>(`SELECT COUNT(*) AS n FROM \`${table}\``);
        counts.set(table, Number(rows[0]?.n ?? 0));
    }

    const meta: BackupMeta = {
        format: "zmsys-backup",
        version: 1,
        createdAt: new Date().toISOString(),
        groups: [...groups],
        serverProduct: "MySQL",
        serverVersion: expectation.serverVersion,
        latestMigration: expectation.latestMigration,
        schemaFingerprint: expectation.schemaFingerprint,
        tables: orderedTables.map(table => ({ name: table, rowCount: counts.get(table) ?? 0 })),
    };

    let sqlByteCount = 0;
    const hash = createHash("sha256");

    const generator = async function* (): AsyncGenerator<Buffer> {
        const emit = (line: string): Buffer => {
            sqlByteCount += Buffer.byteLength(line) + 1;
            if (sqlByteCount > MAX_DECOMPRESSED_BYTES) {
                throw new Error("备份平文超过 2GiB 上限，中止导出");
            }
            return Buffer.from(`${line}\n`, "utf8");
        };
        yield emit(FORMAT_HEADER);
        const metaLine = encodeMetaLine(meta);
        yield emit(metaLine);
        hashLine(hash, metaLine);
        yield emit(SET_NAMES_LINE);
        hashLine(hash, SET_NAMES_LINE);

        for (const table of orderedTables) {
            const schema = schemas.get(table)!;
            yield emit(`-- table ${table}`);
            hashLine(hash, `-- table ${table}`);
            const counter = { rows: 0 };
            for await (const line of tableInsertLines(executor, schema, counter)) {
                yield emit(line);
                hashLine(hash, line);
            }
            // 写侧自检：流出行数与快照 COUNT 一致（自引用树不可达行会在此暴露）
            if (counter.rows !== (counts.get(table) ?? 0)) {
                throw new Error(`表 ${table} 输出行数 ${counter.rows} 与快照计数 ${counts.get(table)} 不一致`);
            }
        }

        const checksum = checksumLineOf(hash.digest("hex"));
        // checksum 行自身不参与摘要
        yield emit(checksum);
        yield emit(FORMAT_END);
    };

    const plain = Readable.from(generator());
    const done = (async (): Promise<void> => {
        try {
            await new Promise<void>((resolveDone, rejectDone) => {
                plain.on("end", () => resolveDone());
                plain.on("error", rejectDone);
            });
            await executor.query("ROLLBACK");
        } catch (error) {
            // 失败也尽力释放快照；连接本身由调用方销毁
            try {
                await executor.query("ROLLBACK");
            } catch {
                /* 快照释放尽力而为 */
            }
            throw error instanceof Error ? error : new Error(String(error));
        }
    })();

    const fileName = options.fileName ?? backupFileName(database, groups, gzip);
    if (!gzip) {
        return {
            stream: plain,
            done,
            fileName,
            sqlBytes: () => sqlByteCount,
            meta: () => meta,
        };
    }
    const gz = createGzip({ level: 6 });
    void pipeline(plain, gz, () => undefined);
    return {
        stream: gz,
        done,
        fileName,
        sqlBytes: () => sqlByteCount,
        meta: () => meta,
    };
}

/** 单表 INSERT 行流：按批聚合（≤1000 行 / 目标 1MiB，单行 ≤8MiB），一行一语句 */
async function* tableInsertLines(
    executor: SqlStreamingExecutor,
    schema: TableSchema,
    counter: { rows: number },
): AsyncGenerator<string> {
    const columns = schema.columns;
    const columnList = columns.map(column => `\`${column.name}\``).join(", ");
    const selectColumns = columnList;
    // CTE 联表路径下列名须限定表别名，避免与 tree 的同名列歧义
    const qualifiedColumns = columns.map(column => `m.\`${column.name}\``).join(", ");
    const parentColumn = selfReferenceParentColumn(schema);
    const idColumn =
        parentColumn === null ? null : schema.foreignKeys.find(fk => fk.refTable === schema.table)!.refColumns[0];

    const sql =
        parentColumn !== null && idColumn !== null
            ? `WITH RECURSIVE \`tree\` (\`${idColumn}\`, \`depth\`) AS (
                   SELECT \`${idColumn}\`, 0 FROM \`${schema.table}\` WHERE \`${parentColumn}\` IS NULL
                   UNION ALL
                   SELECT m.\`${idColumn}\`, t.\`depth\` + 1 FROM \`${schema.table}\` m
                       INNER JOIN \`tree\` t ON m.\`${parentColumn}\` = t.\`${idColumn}\`
               )
               SELECT ${qualifiedColumns} FROM \`${schema.table}\` m INNER JOIN \`tree\` t ON m.\`${idColumn}\` = t.\`${idColumn}\`
               ORDER BY t.\`depth\`, m.\`${idColumn}\``
            : `SELECT ${selectColumns} FROM \`${schema.table}\` ORDER BY ${primaryKeyOrderBy(schema)}`;

    let batch: string[] = [];
    let batchBytes = 0;
    let batchRows = 0;

    const flush = (): string | null => {
        if (batch.length === 0) return null;
        const line = `INSERT INTO \`${schema.table}\` (${columnList}) VALUES ${batch.join(",")};`;
        batch = [];
        batchBytes = 0;
        batchRows = 0;
        return line;
    };

    for await (const row of executor.queryStream<Record<string, unknown>>(sql)) {
        const values = columns.map(column => serializeColumnValue(column.family, row[column.name]));
        const rowSql = `(${values.join(",")})`;
        const rowBytes = Buffer.byteLength(rowSql, "utf8");
        if (rowBytes > MAX_ROW_BYTES) {
            throw new Error(`表 ${schema.table} 单行超过 8MiB 上限，中止导出`);
        }
        batch.push(rowSql);
        batchBytes += rowBytes;
        batchRows += 1;
        counter.rows += 1;
        if (batchRows >= MAX_BATCH_ROWS || batchBytes >= MAX_BATCH_TARGET_BYTES) {
            const line = flush();
            if (line !== null) yield line;
        }
    }
    const line = flush();
    if (line !== null) yield line;
}

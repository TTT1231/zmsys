/**
 * 备份文件格式 v1（db-scheme.md §10.1）：一行一语句，仅数据不含 DDL。
 *
 *   -- zmsys-backup v1
 *   -- meta: {"format":"zmsys-backup",...}
 *   SET NAMES utf8mb4;
 *   -- table sys_role
 *   INSERT INTO `sys_role` (`code`,...) VALUES (...),(...);
 *   -- checksum: <sha256 of lines after header, before checksum>
 *   -- zmsys-backup-end
 *
 * 保真规则（V1.2 对抗性复审结论）：
 * - JSON 列保留数据库原文，禁止 JS JSON.parse→stringify 往返（大整数会静默改值）；
 * - DATETIME/DATE 保留数据库原文（dateStrings），禁止先转本地 Date 再格式化；
 * - BIGINT 保持十进制文本（bigIntAsNumber:false），DECIMAL 保持精确十进制文本；
 * - 字符串按 MySQL 反斜杠转义规则编码；NUL/LF/CR/0x1a 必须转义以维持一行一语句。
 *
 * 解析器只接受固定文法：任意 SQL、自由注释、重复表段、结束后追加内容均拒绝。
 */

import { createHash } from "node:crypto";

export const FORMAT_HEADER = "-- zmsys-backup v1";
export const FORMAT_END = "-- zmsys-backup-end";
export const SET_NAMES_LINE = "SET NAMES utf8mb4;";
export const META_PREFIX = "-- meta: ";
export const TABLE_PREFIX = "-- table ";
export const CHECKSUM_PREFIX = "-- checksum: ";

/** 解压后总字节上限（2GiB）；上传文件（压缩态）上限 512MiB 由 multipart 层执行 */
export const MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
/** 单行上限：单条大行 8MiB + INSERT 包装余量 */
export const MAX_LINE_BYTES = 8 * 1024 * 1024 + 1024 * 1024;
/** 写侧批次：最多 1000 行、目标 1MiB；单行超过 8MiB 中止导出 */
export const MAX_BATCH_ROWS = 1000;
export const MAX_BATCH_TARGET_BYTES = 1024 * 1024;
export const MAX_ROW_BYTES = 8 * 1024 * 1024;

export class BackupFormatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BackupFormatError";
    }
}

/* ------------------------------------------------------------------ */
/* meta                                                                */
/* ------------------------------------------------------------------ */

export interface BackupMetaTable {
    name: string;
    rowCount: number;
}

export interface BackupMeta {
    format: "zmsys-backup";
    version: 1;
    createdAt: string;
    groups: string[];
    serverProduct: string;
    serverVersion: string;
    latestMigration: string;
    schemaFingerprint: string;
    tables: BackupMetaTable[];
}

/** meta 是受控 JSON（写侧由本模块生成），允许 JSON.parse；业务 JSON 列不受此豁免 */
export function encodeMetaLine(meta: BackupMeta): string {
    const json = JSON.stringify(meta);
    if (json.includes("\n") || json.includes("\r")) {
        throw new BackupFormatError("meta 序列化结果包含换行，文件格式被破坏");
    }
    return `${META_PREFIX}${json}`;
}

export function parseMetaLine(line: string): BackupMeta {
    if (!line.startsWith(META_PREFIX)) {
        throw new BackupFormatError("meta 行前缀不匹配");
    }
    const raw = JSON.parse(line.slice(META_PREFIX.length)) as Partial<BackupMeta>;
    if (raw.format !== "zmsys-backup" || raw.version !== 1) {
        throw new BackupFormatError("备份格式或版本不受支持");
    }
    if (
        typeof raw.createdAt !== "string" ||
        !Array.isArray(raw.groups) ||
        raw.groups.some(group => typeof group !== "string") ||
        typeof raw.serverProduct !== "string" ||
        typeof raw.serverVersion !== "string" ||
        typeof raw.latestMigration !== "string" ||
        typeof raw.schemaFingerprint !== "string" ||
        !Array.isArray(raw.tables)
    ) {
        throw new BackupFormatError("meta 字段缺失或类型不符");
    }
    for (const table of raw.tables) {
        if (
            typeof table !== "object" ||
            table === null ||
            typeof table.name !== "string" ||
            !Number.isSafeInteger(table.rowCount) ||
            table.rowCount < 0
        ) {
            throw new BackupFormatError("meta.tables 条目非法");
        }
    }
    return raw as BackupMeta;
}

export function checksumLineOf(hash: string): string {
    return `${CHECKSUM_PREFIX}${hash}`;
}

/** checksum 覆盖范围：header 行之后、checksum 行之前的全部行（含 meta），每行尾接 LF */
export function createChecksumHash(): ReturnType<typeof createHash> {
    return createHash("sha256");
}

export function hashLine(hash: ReturnType<typeof createHash>, line: string | Buffer): void {
    hash.update(line);
    hash.update("\n");
}

/* ------------------------------------------------------------------ */
/* SQL 字符串转义                                                      */
/* ------------------------------------------------------------------ */

const ESCAPE_MAP: Record<string, string> = {
    "\u0000": "\\0",
    "\n": "\\n",
    "\r": "\\r",
    "\u001a": "\\Z",
    "\b": "\\b",
    "\t": "\\t",
    "\\": "\\\\",
    "'": "\\'",
};

export function encodeSqlString(value: string): string {
    let out = "'";
    for (const ch of value) {
        out += ESCAPE_MAP[ch] ?? ch;
    }
    return `${out}'`;
}

const UNESCAPE_MAP: Record<string, string> = {
    "0": "\u0000",
    n: "\n",
    r: "\r",
    Z: "\u001a",
    b: "\b",
    t: "\t",
    "\\": "\\",
    "'": "'",
    '"': '"',
};

/* ------------------------------------------------------------------ */
/* 列类型族                                                            */
/* ------------------------------------------------------------------ */

export type ColumnFamily = "integer" | "decimal" | "string" | "binary" | "datetime" | "date" | "json";

/** DATA_TYPE（information_schema）→ 值类型族；写读两侧共用 */
export function columnFamily(dataType: string): ColumnFamily {
    switch (dataType) {
        case "tinyint":
        case "smallint":
        case "mediumint":
        case "int":
        case "integer":
        case "bigint":
        case "year":
            return "integer";
        case "decimal":
        case "numeric":
            return "decimal";
        case "binary":
        case "varbinary":
        case "tinyblob":
        case "blob":
        case "mediumblob":
        case "longblob":
            return "binary";
        case "datetime":
        case "timestamp":
            return "datetime";
        case "date":
            return "date";
        case "json":
            return "json";
        case "char":
        case "varchar":
        case "tinytext":
        case "text":
        case "mediumtext":
        case "longtext":
        case "enum":
        case "set":
            return "string";
        default:
            throw new BackupFormatError(`不支持的列类型：${dataType}`);
    }
}

/* ------------------------------------------------------------------ */
/* 写侧：DB 值 → SQL 字面量                                            */
/* ------------------------------------------------------------------ */

/** 按类型族序列化驱动返回值（bigIntAsNumber/decimalAsNumber/jsonStrings/dateStrings 均关/开） */
export function serializeColumnValue(family: ColumnFamily, value: unknown): string {
    if (value === null || value === undefined) {
        return "NULL";
    }
    switch (family) {
        case "integer": {
            // BIGINT 由驱动以 BigInt 返回（bigIntAsNumber:false）；TINYINT/INT 等
            // 本就是 JS number（安全整数范围），两者都精确
            if (typeof value === "bigint") {
                return value.toString(10);
            }
            if (typeof value === "number" && Number.isSafeInteger(value)) {
                return value.toString(10);
            }
            throw new BackupFormatError(`整数列期望 bigint/安全整数，实际 ${typeof value}`);
        }
        case "decimal": {
            if (typeof value !== "string" && typeof value !== "bigint") {
                throw new BackupFormatError(`十进制列期望字符串值，实际 ${typeof value}`);
            }
            return value.toString();
        }
        case "binary": {
            if (!Buffer.isBuffer(value)) {
                throw new BackupFormatError(`二进制列期望 Buffer 值，实际 ${typeof value}`);
            }
            return `X'${value.toString("hex")}'`;
        }
        case "datetime":
        case "date":
        case "json":
        case "string": {
            if (typeof value !== "string") {
                throw new BackupFormatError(`${family} 列期望字符串值，实际 ${typeof value}`);
            }
            return encodeSqlString(value);
        }
    }
}

/* ------------------------------------------------------------------ */
/* 读侧：INSERT 行 tokenizer                                           */
/* ------------------------------------------------------------------ */

export type ParsedValue =
    | { kind: "null" }
    | { kind: "int"; text: string }
    | { kind: "decimal"; text: string }
    | { kind: "string"; text: string }
    | { kind: "bytes"; hex: string };

export interface ParsedInsert {
    table: string;
    columns: string[];
    rows: ParsedValue[][];
}

const INT_PATTERN = /^-?(?:0|[1-9][0-9]*)$/;
const DECIMAL_PATTERN = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;
const HEX_PATTERN = /^[0-9A-Fa-f]+$/;

const INSERT_HEAD_PATTERN = /^INSERT INTO `([A-Za-z0-9_]+)` \((`[A-Za-z0-9_]+`(?:, `[A-Za-z0-9_]+`)*)\) VALUES /;

/** 解析单行 INSERT 语句；任何文法偏移立即抛错（带列偏移便于定位） */
export function parseInsertLine(line: string): ParsedInsert {
    const head = INSERT_HEAD_PATTERN.exec(line);
    if (!head) {
        throw new BackupFormatError("INSERT 语句头不符合固定文法");
    }
    const columns = head[2].split(", ").map(part => part.slice(1, -1));
    if (new Set(columns).size !== columns.length) {
        throw new BackupFormatError("INSERT 列清单存在重复列");
    }
    let pos = head[0].length;
    const rows: ParsedValue[][] = [];
    const total = line.length;

    const skipSpaces = (): void => {
        while (pos < total && line[pos] === " ") {
            pos += 1;
        }
    };

    // 函数声明（而非 const 箭头）确保 never 返回触发控制流收窄
    function fail(message: string): never {
        throw new BackupFormatError(`INSERT 值区文法错误（偏移 ${pos}）：${message}`);
    }

    for (;;) {
        skipSpaces();
        if (pos >= total || line[pos] !== "(") {
            fail("期望行起始 '('");
        }
        pos += 1;
        const row: ParsedValue[] = [];
        for (;;) {
            skipSpaces();
            if (pos >= total) {
                fail("行未闭合");
            }
            const ch = line[pos];
            if (ch === ")") {
                pos += 1;
                break;
            }
            if (ch === "'") {
                pos += 1;
                let text = "";
                for (;;) {
                    if (pos >= total) {
                        fail("字符串未闭合");
                    }
                    const c = line[pos];
                    if (c === "'") {
                        pos += 1;
                        break;
                    }
                    if (c === "\\") {
                        const next = line[pos + 1];
                        if (next === undefined) {
                            fail("转义序列在行尾截断");
                        }
                        text += UNESCAPE_MAP[next] ?? next;
                        pos += 2;
                        continue;
                    }
                    text += c;
                    pos += 1;
                }
                row.push({ kind: "string", text });
            } else if (ch === "X" || ch === "x") {
                if (line[pos + 1] !== "'") {
                    fail("期望 X'..' 十六进制字面量");
                }
                const close = line.indexOf("'", pos + 2);
                if (close === -1) {
                    fail("十六进制字面量未闭合");
                }
                const hex = line.slice(pos + 2, close);
                if (hex.length === 0 || hex.length % 2 !== 0 || !HEX_PATTERN.test(hex)) {
                    fail("十六进制字面量非法");
                }
                row.push({ kind: "bytes", hex });
                pos = close + 1;
            } else if (line.startsWith("NULL", pos)) {
                pos += 4;
                row.push({ kind: "null" });
            } else {
                const match = /^-?[0-9][0-9.]*/.exec(line.slice(pos));
                if (!match) {
                    fail(`无法识别的值起始字符 ${JSON.stringify(ch)}`);
                }
                const text = match[0];
                if (INT_PATTERN.test(text)) {
                    row.push({ kind: "int", text });
                } else if (DECIMAL_PATTERN.test(text)) {
                    row.push({ kind: "decimal", text });
                } else {
                    fail(`数字字面量非法：${text}`);
                }
                pos += text.length;
            }
            skipSpaces();
            if (pos < total && line[pos] === ",") {
                pos += 1;
                continue;
            }
            if (pos < total && line[pos] === ")") {
                pos += 1;
                break;
            }
            fail("值后期望 ',' 或 ')'");
        }
        if (row.length !== columns.length) {
            throw new BackupFormatError(`行值数 ${row.length} 与列数 ${columns.length} 不符`);
        }
        rows.push(row);
        skipSpaces();
        if (pos < total && line[pos] === ",") {
            pos += 1;
            continue;
        }
        if (pos < total && line[pos] === ";") {
            pos += 1;
            skipSpaces();
            if (pos !== total) {
                fail("语句结束后仍有剩余字符");
            }
            return { table: head[1], columns, rows };
        }
        fail("行后期望 ',' 或 ';'");
    }
}

/** 解析出的值 → 驱动参数（参数化插入；JSON/日期以字符串传入由数据库校验） */
export function bindParam(value: ParsedValue): unknown {
    switch (value.kind) {
        case "null":
            return null;
        case "int":
            return BigInt(value.text);
        case "decimal":
        case "string":
            return value.text;
        case "bytes":
            return Buffer.from(value.hex, "hex");
    }
}

/** 值与列类型的静态匹配校验（预检 400 分支；运行期语义错误仍由数据库兜底拒绝） */
export function valueMatchesColumn(value: ParsedValue, family: ColumnFamily, nullable: boolean): true {
    if (value.kind === "null") {
        if (!nullable) {
            throw new BackupFormatError("非空列不接受 NULL 值");
        }
        return true;
    }
    switch (family) {
        case "integer":
            if (value.kind !== "int") {
                throw new BackupFormatError(`整数列不接受 ${value.kind} 值`);
            }
            return true;
        case "decimal":
            if (value.kind !== "int" && value.kind !== "decimal") {
                throw new BackupFormatError(`十进制列不接受 ${value.kind} 值`);
            }
            return true;
        case "binary":
            if (value.kind !== "bytes") {
                throw new BackupFormatError(`二进制列不接受 ${value.kind} 值`);
            }
            return true;
        case "datetime":
            if (value.kind !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(value.text)) {
                throw new BackupFormatError(`DATETIME 值格式不符：${describeValue(value)}`);
            }
            return true;
        case "date":
            if (value.kind !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.text)) {
                throw new BackupFormatError(`DATE 值格式不符：${describeValue(value)}`);
            }
            return true;
        case "json":
        case "string":
            if (value.kind !== "string") {
                throw new BackupFormatError(`${family} 列不接受 ${value.kind} 值`);
            }
            return true;
    }
}

const describeValue = (value: ParsedValue): string =>
    value.kind === "string" || value.kind === "int" || value.kind === "decimal" ? value.text.slice(0, 40) : value.kind;

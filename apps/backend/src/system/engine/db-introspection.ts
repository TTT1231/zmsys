/**
 * information_schema 自省（备份写侧与恢复引擎共用）：
 * - 表结构描述（列/PK/唯一索引/FK/CHECK），用于列清单校验、类型族映射与指纹；
 * - schemaFingerprint：备份目录全表的规范化摘要，恢复前必须一致；
 * - FK 拓扑排序：表输出/删除顺序与自引用父列发现。
 *
 * 查询统一走注入的只读执行器（SqlExecutor），不绑定具体连接——引擎保持纯模块。
 */
import { createHash } from "node:crypto";
import { columnFamily, type ColumnFamily } from "./backup-format";

/** 最小查询接口：mariadb 专用连接与测试桩都实现它 */
export interface SqlExecutor {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T>;
}

export interface ColumnSchema {
    name: string;
    ordinal: number;
    dataType: string;
    columnType: string;
    nullable: boolean;
    defaultValue: string | null;
    collation: string | null;
    family: ColumnFamily;
}

export interface UniqueIndexSchema {
    name: string;
    columns: string[];
    isPrimary: boolean;
}

export interface ForeignKeySchema {
    name: string;
    columns: string[];
    refTable: string;
    refColumns: string[];
}

export interface TableSchema {
    table: string;
    columns: ColumnSchema[];
    primaryKey: string[];
    uniqueIndexes: UniqueIndexSchema[];
    foreignKeys: ForeignKeySchema[];
}

interface ColumnRow {
    TABLE_NAME: string;
    COLUMN_NAME: string;
    ORDINAL_POSITION: number;
    COLUMN_TYPE: string;
    DATA_TYPE: string;
    IS_NULLABLE: string;
    COLUMN_DEFAULT: string | null;
    COLLATION_NAME: string | null;
}

interface StatRow {
    TABLE_NAME: string;
    INDEX_NAME: string;
    NON_UNIQUE: number;
    SEQ_IN_INDEX: number;
    COLUMN_NAME: string;
}

interface FkRow {
    TABLE_NAME: string;
    CONSTRAINT_NAME: string;
    COLUMN_NAME: string;
    REFERENCED_TABLE_NAME: string;
    REFERENCED_COLUMN_NAME: string;
    ORDINAL_POSITION: number;
}

interface CheckRow {
    TABLE_NAME: string;
    CONSTRAINT_NAME: string;
    CHECK_CLAUSE: string;
}

export interface IntrospectionContext {
    /** information_schema 排除的 schema 前缀（DataGrip 等工具的副本表） */
    database: string;
}

const BACKTICK = (name: string): string => `\`${name}\``;

const identifierList = (names: readonly string[]): string => names.map(BACKTICK).join(", ");

/** 加载一组表的结构描述；缺表即抛错（备份目录与实际库漂移） */
export async function loadTableSchemas(
    q: SqlExecutor,
    database: string,
    tables: readonly string[],
): Promise<Map<string, TableSchema>> {
    if (tables.length === 0) {
        return new Map();
    }
    const placeholders = tables.map(() => "?").join(", ");
    const columnRows = await q.query<ColumnRow[]>(
        `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE,
                COLUMN_DEFAULT, COLLATION_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})
         ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [database, ...tables],
    );
    const statRows = await q.query<StatRow[]>(
        `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
        [database, ...tables],
    );
    const fkRows = await q.query<FkRow[]>(
        `SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, ORDINAL_POSITION
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})
           AND REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
        [database, ...tables],
    );

    const schemas = new Map<string, TableSchema>();
    for (const table of tables) {
        schemas.set(table, {
            table,
            columns: [],
            primaryKey: [],
            uniqueIndexes: [],
            foreignKeys: [],
        });
    }
    for (const row of columnRows) {
        const schema = schemas.get(row.TABLE_NAME);
        if (!schema) continue;
        schema.columns.push({
            name: row.COLUMN_NAME,
            ordinal: row.ORDINAL_POSITION,
            dataType: row.DATA_TYPE,
            columnType: row.COLUMN_TYPE,
            nullable: row.IS_NULLABLE === "YES",
            defaultValue: row.COLUMN_DEFAULT,
            collation: row.COLLATION_NAME,
            family: columnFamily(row.DATA_TYPE),
        });
    }
    for (const [table, schema] of schemas) {
        if (schema.columns.length === 0) {
            throw new Error(`表 ${table} 不存在或无列（目标库与备份目录漂移）`);
        }
    }
    const indexMap = new Map<string, UniqueIndexSchema>();
    for (const row of statRows) {
        const schema = schemas.get(row.TABLE_NAME);
        if (!schema) continue;
        const key = `${row.TABLE_NAME}\u0000${row.INDEX_NAME}`;
        let index = indexMap.get(key);
        if (!index) {
            index = { name: row.INDEX_NAME, columns: [], isPrimary: row.INDEX_NAME === "PRIMARY" };
            indexMap.set(key, index);
            schema.uniqueIndexes.push(index);
        }
        index.columns.push(row.COLUMN_NAME);
    }
    const fkMap = new Map<string, ForeignKeySchema>();
    for (const row of fkRows) {
        const schema = schemas.get(row.TABLE_NAME);
        if (!schema) continue;
        const key = `${row.TABLE_NAME}\u0000${row.CONSTRAINT_NAME}`;
        let fk = fkMap.get(key);
        if (!fk) {
            fk = { name: row.CONSTRAINT_NAME, columns: [], refTable: row.REFERENCED_TABLE_NAME, refColumns: [] };
            fkMap.set(key, fk);
            schema.foreignKeys.push(fk);
        }
        fk.columns.push(row.COLUMN_NAME);
        fk.refColumns.push(row.REFERENCED_COLUMN_NAME);
    }
    for (const schema of schemas.values()) {
        const pk = schema.uniqueIndexes.find(index => index.isPrimary);
        schema.primaryKey = pk ? pk.columns : [];
    }
    return schemas;
}

/** schema 规范化摘要：列全量类型/可空/默认/排序规则、主键、唯一索引、外键、CHECK */
export async function computeSchemaFingerprint(
    q: SqlExecutor,
    database: string,
    tables: readonly string[],
): Promise<string> {
    const schemas = await loadTableSchemas(q, database, tables);
    // MySQL 8 的 CHECK_CONSTRAINTS 视图无 TABLE_NAME 列，经 TABLE_CONSTRAINTS 关联取得
    const checkRows = await q.query<CheckRow[]>(
        `SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
         FROM information_schema.CHECK_CONSTRAINTS cc
         INNER JOIN information_schema.TABLE_CONSTRAINTS tc
             ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
                AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
                AND tc.CONSTRAINT_TYPE = 'CHECK'
         WHERE cc.CONSTRAINT_SCHEMA = ?`,
        [database],
    );
    const checksByTable = new Map<string, string[]>();
    const tableSet = new Set(tables);
    for (const row of checkRows) {
        if (!tableSet.has(row.TABLE_NAME)) continue;
        let checks = checksByTable.get(row.TABLE_NAME);
        if (!checks) {
            checks = [];
            checksByTable.set(row.TABLE_NAME, checks);
        }
        checks.push(`${row.CONSTRAINT_NAME}:${row.CHECK_CLAUSE}`);
    }

    const hash = createHash("sha256");
    for (const table of [...tables].sort()) {
        const schema = schemas.get(table);
        if (!schema) {
            throw new Error(`表 ${table} 缺少结构信息`);
        }
        hash.update(`T:${table}\n`);
        for (const column of schema.columns) {
            hash.update(
                `C:${column.name}|${column.columnType}|${column.nullable ? "1" : "0"}|${column.defaultValue ?? "-"}|${column.collation ?? "-"}\n`,
            );
        }
        hash.update(`P:${schema.primaryKey.join(",")}\n`);
        for (const index of schema.uniqueIndexes
            .filter(index => !index.isPrimary)
            .sort((a, b) => a.name.localeCompare(b.name))) {
            hash.update(`U:${index.name}(${index.columns.join(",")})\n`);
        }
        for (const fk of schema.foreignKeys.sort((a, b) => a.name.localeCompare(b.name))) {
            hash.update(`F:${fk.name}(${fk.columns.join(",")})→${fk.refTable}(${fk.refColumns.join(",")})\n`);
        }
        for (const check of (checksByTable.get(table) ?? []).sort()) {
            hash.update(`K:${check}\n`);
        }
    }
    return hash.digest("hex");
}

/** 表间（非自引用）FK 拓扑序：被引用表在前；同层按表名稳定排序；环抛错 */
export function topologicalTableOrder(schemas: Map<string, TableSchema>): string[] {
    const names = [...schemas.keys()].sort();
    const deps = new Map<string, Set<string>>();
    for (const name of names) {
        const set = new Set<string>();
        for (const fk of schemas.get(name)!.foreignKeys) {
            if (fk.refTable !== name && schemas.has(fk.refTable)) {
                set.add(fk.refTable);
            }
        }
        deps.set(name, set);
    }
    const ordered: string[] = [];
    const done = new Set<string>();
    for (;;) {
        const ready = names.filter(name => !done.has(name) && [...deps.get(name)!].every(dep => done.has(dep)));
        if (ready.length === 0) {
            const remaining = names.filter(name => !done.has(name));
            if (remaining.length === 0) break;
            throw new Error(`表间外键存在环或缺失依赖：${remaining.join(", ")}`);
        }
        for (const name of ready) {
            ordered.push(name);
            done.add(name);
        }
    }
    return ordered;
}

/** 逆拓扑序（replace 删除阶段用） */
export function reverseTopologicalTableOrder(schemas: Map<string, TableSchema>): string[] {
    return topologicalTableOrder(schemas).reverse();
}

/** 自引用外键的父列（如 material_group.parent_id）；一张表只支持一个自引用父列 */
export function selfReferenceParentColumn(schema: TableSchema): string | null {
    const selfFks = schema.foreignKeys.filter(fk => fk.refTable === schema.table);
    if (selfFks.length === 0) return null;
    if (selfFks.length > 1) {
        throw new Error(`表 ${schema.table} 存在多个自引用外键，不支持`);
    }
    return selfFks[0].columns[0];
}

/** 按主键列排序的 ORDER BY 片段；无主键表按全部列排序（理论上仅理论表） */
export function primaryKeyOrderBy(schema: TableSchema): string {
    const columns = schema.primaryKey.length > 0 ? schema.primaryKey : schema.columns.map(column => column.name);
    return identifierList(columns);
}

export { BACKTICK, identifierList };

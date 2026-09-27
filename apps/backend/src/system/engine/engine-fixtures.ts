/**
 * 引擎单测夹具：以 information_schema 行形态提供最小真实结构（列/PK/唯一索引/FK），
 * 覆盖 users 闭包 + op_log + biz_sequence + 自引用 material_group。
 * 仅被 *.spec.ts 引用，不进运行时依赖图。
 */

export interface ColumnRow {
    TABLE_NAME: string;
    COLUMN_NAME: string;
    ORDINAL_POSITION: number;
    COLUMN_TYPE: string;
    DATA_TYPE: string;
    IS_NULLABLE: string;
    COLUMN_DEFAULT: string | null;
    COLLATION_NAME: string | null;
}

export interface StatRow {
    TABLE_NAME: string;
    INDEX_NAME: string;
    NON_UNIQUE: number;
    SEQ_IN_INDEX: number;
    COLUMN_NAME: string;
}

export interface FkRow {
    TABLE_NAME: string;
    CONSTRAINT_NAME: string;
    COLUMN_NAME: string;
    REFERENCED_TABLE_NAME: string;
    REFERENCED_COLUMN_NAME: string;
    ORDINAL_POSITION: number;
}

export interface CheckRow {
    TABLE_NAME: string;
    CONSTRAINT_NAME: string;
    CHECK_CLAUSE: string;
}

interface TableDef {
    table: string;
    columns: Array<[name: string, dataType: string, columnType: string, nullable: boolean, default_: string | null]>;
    primaryKey: string[];
    unique?: Array<{ name: string; columns: string[] }>;
    foreignKeys?: Array<{ name: string; columns: string[]; refTable: string; refColumns: string[] }>;
}

const utf8 = "utf8mb4_0900_ai_ci";
const ascii = "ascii_bin";

const TABLE_DEFS: TableDef[] = [
    {
        table: "sys_role",
        columns: [
            ["code", "varchar", "varchar(20)", false, null],
            ["name", "varchar", "varchar(32)", false, null],
            ["locked", "tinyint", "tinyint(1)", false, "0"],
            ["grant_version", "bigint", "bigint unsigned", false, "1"],
            ["created_at", "datetime", "datetime(3)", false, null],
            ["updated_at", "datetime", "datetime(3)", false, null],
        ],
        primaryKey: ["code"],
        unique: [{ name: "uk_sys_role_name", columns: ["name"] }],
    },
    {
        table: "sys_user",
        columns: [
            ["id", "bigint", "bigint", false, null],
            ["account", "varchar", "varchar(64)", false, null],
            ["password_hash", "varchar", "varchar(255)", false, null],
            ["name", "varchar", "varchar(64)", false, null],
            ["role_code", "varchar", "varchar(20)", false, null],
            ["status", "tinyint", "tinyint(1)", false, "1"],
            ["token_version", "bigint", "bigint unsigned", false, "1"],
            ["row_version", "bigint", "bigint unsigned", false, "1"],
            ["password_changed_at", "datetime", "datetime(3)", true, null],
            ["last_login_at", "datetime", "datetime(3)", true, null],
            ["created_at", "datetime", "datetime(3)", false, null],
            ["updated_at", "datetime", "datetime(3)", false, null],
        ],
        primaryKey: ["id"],
        unique: [{ name: "uk_sys_user_account", columns: ["account"] }],
        foreignKeys: [{ name: "fk_sys_user_role", columns: ["role_code"], refTable: "sys_role", refColumns: ["code"] }],
    },
    {
        table: "sys_grant",
        columns: [
            ["role_code", "varchar", "varchar(20)", false, null],
            ["permission_code", "varchar", "varchar(80)", false, null],
            ["grant_source", "enum", "enum('BOOTSTRAP','USER')", false, "USER"],
            ["granted_by", "bigint", "bigint", true, null],
            ["granted_at", "datetime", "datetime(3)", false, null],
        ],
        primaryKey: ["role_code", "permission_code"],
        foreignKeys: [
            { name: "fk_sys_grant_role", columns: ["role_code"], refTable: "sys_role", refColumns: ["code"] },
            { name: "fk_sys_grant_operator", columns: ["granted_by"], refTable: "sys_user", refColumns: ["id"] },
        ],
    },
    {
        table: "sys_grant_log",
        columns: [
            ["id", "bigint", "bigint", false, null],
            ["operator_id", "bigint", "bigint", false, null],
            ["role_code", "varchar", "varchar(20)", false, null],
            ["before_version", "bigint", "bigint unsigned", false, null],
            ["after_version", "bigint", "bigint unsigned", false, null],
            ["server_note", "varchar", "varchar(1000)", false, null],
            ["client_reason", "varchar", "varchar(500)", false, "''"],
            ["before_json", "json", "json", false, null],
            ["after_json", "json", "json", false, null],
            ["created_at", "datetime", "datetime(3)", false, null],
        ],
        primaryKey: ["id"],
        foreignKeys: [
            { name: "fk_sys_grant_log_operator", columns: ["operator_id"], refTable: "sys_user", refColumns: ["id"] },
        ],
    },
    {
        table: "sys_user_change_log",
        columns: [
            ["id", "bigint", "bigint", false, null],
            ["user_id", "bigint", "bigint", false, null],
            ["operator_id", "bigint", "bigint", false, null],
            [
                "event_type",
                "enum",
                "enum('CREATE','PROFILE_UPDATE','ROLE_CHANGE','STATUS_CHANGE','PASSWORD_CHANGE','PASSWORD_RESET')",
                false,
                null,
            ],
            ["before_version", "bigint", "bigint unsigned", true, null],
            ["after_version", "bigint", "bigint unsigned", false, null],
            ["reason", "varchar", "varchar(500)", false, "''"],
            ["before_json", "json", "json", true, null],
            ["after_json", "json", "json", false, null],
            ["created_at", "datetime", "datetime(3)", false, null],
        ],
        primaryKey: ["id"],
        foreignKeys: [
            { name: "fk_sys_user_change_log_user", columns: ["user_id"], refTable: "sys_user", refColumns: ["id"] },
            {
                name: "fk_sys_user_change_log_operator",
                columns: ["operator_id"],
                refTable: "sys_user",
                refColumns: ["id"],
            },
        ],
    },
    {
        table: "op_log",
        columns: [
            ["id", "bigint", "bigint", false, null],
            ["operator_id", "bigint", "bigint", false, null],
            ["operator_name_snapshot", "varchar", "varchar(64)", false, null],
            ["operator_role_snapshot", "varchar", "varchar(32)", false, null],
            ["action", "enum", "enum('ship','create_order','db_backup','db_restore')", false, null],
            ["target_type", "varchar", "varchar(32)", false, null],
            ["target_id", "bigint", "bigint", false, null],
            ["target_code", "varchar", "varchar(64)", false, null],
            ["detail_json", "json", "json", false, null],
            ["created_at", "datetime", "datetime(3)", false, null],
        ],
        primaryKey: ["id"],
        foreignKeys: [
            { name: "fk_op_log_operator", columns: ["operator_id"], refTable: "sys_user", refColumns: ["id"] },
        ],
    },
    {
        table: "biz_sequence",
        columns: [
            ["sequence_key", "varchar", "varchar(80)", false, null],
            ["next_value", "bigint", "bigint unsigned", false, null],
            ["updated_at", "datetime", "datetime(3)", false, null],
        ],
        primaryKey: ["sequence_key"],
    },
    {
        table: "material_group",
        columns: [
            ["id", "bigint", "bigint", false, null],
            ["category_id", "bigint", "bigint", false, null],
            ["parent_id", "bigint", "bigint", true, null],
            ["kind", "enum", "enum('SECTION','GROUP')", false, null],
            ["name", "varchar", "varchar(64)", false, null],
            ["group_key", "varchar", "varchar(40)", true, null],
            ["multi", "tinyint", "tinyint(1)", true, null],
            ["qty", "tinyint", "tinyint(1)", true, null],
            ["sort_order", "smallint", "smallint unsigned", false, "0"],
            ["status", "tinyint", "tinyint(1)", false, "1"],
            ["created_at", "datetime", "datetime(3)", false, null],
            ["updated_at", "datetime", "datetime(3)", false, null],
        ],
        primaryKey: ["id"],
        unique: [
            { name: "uk_material_group_name", columns: ["category_id", "name"] },
            { name: "uk_material_group_key", columns: ["category_id", "group_key"] },
        ],
        foreignKeys: [
            {
                name: "fk_material_group_parent",
                columns: ["parent_id"],
                refTable: "material_group",
                refColumns: ["id"],
            },
        ],
    },
];

const isAscii = (dataType: string, name: string): boolean =>
    name === "code" || name === "account" || dataType === "enum" || name.endsWith("_code") || name.endsWith("_key");

export const FIXTURE_COLUMN_ROWS: ColumnRow[] = TABLE_DEFS.flatMap(def =>
    def.columns.map(([name, dataType, columnType, nullable, default_], index) => ({
        TABLE_NAME: def.table,
        COLUMN_NAME: name,
        ORDINAL_POSITION: index + 1,
        COLUMN_TYPE: columnType,
        DATA_TYPE: dataType,
        IS_NULLABLE: nullable ? "YES" : "NO",
        COLUMN_DEFAULT: default_,
        COLLATION_NAME: ["varchar", "enum", "text"].includes(dataType)
            ? isAscii(dataType, name)
                ? ascii
                : utf8
            : null,
    })),
);

export const FIXTURE_STAT_ROWS: StatRow[] = TABLE_DEFS.flatMap(def => {
    const rows: StatRow[] = def.primaryKey.map((column, index) => ({
        TABLE_NAME: def.table,
        INDEX_NAME: "PRIMARY",
        NON_UNIQUE: 0,
        SEQ_IN_INDEX: index + 1,
        COLUMN_NAME: column,
    }));
    for (const unique of def.unique ?? []) {
        unique.columns.forEach((column, index) => {
            rows.push({
                TABLE_NAME: def.table,
                INDEX_NAME: unique.name,
                NON_UNIQUE: 0,
                SEQ_IN_INDEX: index + 1,
                COLUMN_NAME: column,
            });
        });
    }
    return rows;
});

export const FIXTURE_FK_ROWS: FkRow[] = TABLE_DEFS.flatMap(def =>
    (def.foreignKeys ?? []).flatMap(fk =>
        fk.columns.map((column, index) => ({
            TABLE_NAME: def.table,
            CONSTRAINT_NAME: fk.name,
            COLUMN_NAME: column,
            REFERENCED_TABLE_NAME: fk.refTable,
            REFERENCED_COLUMN_NAME: fk.refColumns[index],
            ORDINAL_POSITION: index + 1,
        })),
    ),
);

export const FIXTURE_CHECK_ROWS: CheckRow[] = [
    { TABLE_NAME: "biz_sequence", CONSTRAINT_NAME: "ck_biz_sequence_next", CHECK_CLAUSE: "(`next_value` > 0)" },
    {
        TABLE_NAME: "op_log",
        CONSTRAINT_NAME: "ck_op_log_detail",
        CHECK_CLAUSE: "(json_type(`detail_json`) = _utf8mb4'OBJECT')",
    },
];

export const FIXTURE_VERSION = "8.0.46";
export const FIXTURE_LATEST_MIGRATION = "20260942000000_system_backup_restore";

import mariadb from "mariadb";

export interface MariadbPoolConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    connectionLimit: number;
}

/**
 * 统一的 mariadb 连接池工厂（PrismaService 与 prisma/seed.ts 共用）。
 * db-scheme.md §1.1 要求数据库保存 UTC：
 * - 驱动 timezone: 'Z'：DATETIME 一律按 UTC 解释/序列化；
 * - sessionVariables.time_zone='+00:00'：服务器端 NOW()/CURRENT_TIMESTAMP
 *   默认值（created_at 等）也落在 UTC——实测服务器 SYSTEM 时区并非 UTC，
 *   任何未固定会话时区的连接都会写入墙上时间脏数据。
 *
 * 隔离级别也在连接层统一固定（db-scheme.md §2）：
 * - initSql 设 READ-COMMITTED：幂等占位普通读先于业务行锁，REPEATABLE READ 的事务级
 *   快照会让行锁后的聚合读（v_bom_stock）取旧快照；实测 @prisma/adapter-mariadb
 *   静默忽略 $transaction 的 isolationLevel 选项，sessionVariables 的参数化 SET
 *   对该变量也静默无效，只有 initSql 的字面 SQL 生效。
 */
export const createMariadbPool = (config: MariadbPoolConfig): mariadb.Pool =>
    mariadb.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.name,
        connectionLimit: config.connectionLimit,
        timezone: "Z",
        sessionVariables: { time_zone: "+00:00" },
        initSql: "SET SESSION transaction_isolation = 'READ-COMMITTED'",
    });

/**
 * 备份/恢复专用一次性连接（不入池，用后销毁）。在基础纪律（UTC + 会话时区）之上固定：
 * - bigIntAsNumber:false / decimalAsNumber:false：BIGINT/DECIMAL 保持 bigint/字符串；
 * - jsonStrings:true / dateStrings:true：JSON 与 DATE/DATETIME 保持数据库原文。
 * 业务 JSON 列因此不经 JS 解析（大整数保真），日期不经本地 Date 往返（V1.2 探针结论）。
 * sql_mode 去掉 NO_BACKSLASH_ESCAPES 以兼容反斜杠转义字面量（参数化路径不依赖，
 * 仅为与 mysql 客户端 scratch 验证口径一致）。独立 CLI 入口同样必须先初始化进程 UTC。
 */
export async function createBackupConnection(
    config: Omit<MariadbPoolConfig, "connectionLimit">,
): Promise<mariadb.Connection> {
    // jsonStrings 运行时受支持（lib/config/connection-options.js）但 3.4.5 d.ts 未声明，
    // 以断言补齐 typings 缺口；foundRows:false 让 affectedRows 反映真实变更行数
    // （biz_sequence 的 GREATEST 无变化应计 0，否则幂等 merge 会被误计为插入）
    const connection = await mariadb.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.name,
        timezone: "Z",
        sessionVariables: { time_zone: "+00:00" },
        bigIntAsNumber: false,
        decimalAsNumber: false,
        jsonStrings: true,
        dateStrings: true,
        foundRows: false,
    } as mariadb.ConnectionConfig);
    await connection.query("SET SESSION sql_mode = (SELECT REPLACE(@@sql_mode, 'NO_BACKSLASH_ESCAPES', ''))");
    return connection;
}

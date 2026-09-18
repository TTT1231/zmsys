import mariadb from 'mariadb';

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
        timezone: 'Z',
        sessionVariables: { time_zone: '+00:00' },
        initSql: "SET SESSION transaction_isolation = 'READ-COMMITTED'",
    });

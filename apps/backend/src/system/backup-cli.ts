/**
 * 应用级备份 CLI 薄入口（db-scheme.md §10.5）：`node dist/system/backup-cli.js`
 * 在 backend 镜像的临时命令容器（或本地）内执行，不启动 HTTP、不运行默认 CMD。
 * 与网页「备份」同一引擎（zmsys-backup v1 格式，仅数据不含 DDL）。
 *
 * - stdout 专用于备份字节（gzip/平文），任何状态/结果行走 stderr——外层管道
 *   （本地子进程或 SSH）直连文件即得纯净产物；
 * - 备份为只读一致性快照，不要求停写、不取恢复锁（与网页备份并存运行一致）；
 * - 不写 op_log（运维通道，同 restore-cli 的口径：凭证/审计由服务层负责）；
 * - 停写、连接凭据取自部署环境（compose 注入的 DB_*），本地走根 .env；
 * - 参数白名单校验：--groups（逗号分隔，缺省全量）、--no-gzip、--print-target。
 */
import "../process-tz";
import { pipeline } from "node:stream/promises";
import { createBackupConnection } from "../prisma/create-pool";
import { loadDbEnv } from "../configuration/raw-env";
import { ALL_GROUP_KEYS } from "./backup.catalog";
import { createBackupStream } from "./engine/backup-writer";
import { MariaDbExecutor } from "./engine/mariadb-executor";

const ARGS = process.argv.slice(2);

const argValue = (name: string): string | undefined => {
    const index = ARGS.indexOf(`--${name}`);
    if (index === -1) return undefined;
    const value = ARGS[index + 1];
    if (value === undefined || value.startsWith("--")) return undefined;
    return value;
};

const hasFlag = (name: string): boolean => ARGS.includes(`--${name}`);

const parseGroups = (): string[] => {
    const raw = argValue("groups");
    if (raw === undefined) return [...ALL_GROUP_KEYS];
    const groups = raw
        .split(",")
        .map(part => part.trim())
        .filter(part => part !== "");
    if (groups.length === 0) {
        throw new Error("--groups 不能为空：逗号分隔的分组 key，或省略以全量备份");
    }
    const known = new Set(ALL_GROUP_KEYS as readonly string[]);
    for (const group of groups) {
        if (!known.has(group)) {
            throw new Error(`未知分组：${group}（合法值 ${[...known].join(",")}）`);
        }
    }
    return groups;
};

const main = async (): Promise<void> => {
    const groups = parseGroups();
    const gzip = !hasFlag("no-gzip");
    const db = loadDbEnv();
    const database = db.database;

    if (hasFlag("print-target")) {
        process.stdout.write(`${JSON.stringify({ database, groups })}\n`);
        return;
    }

    const connection = await createBackupConnection({
        host: db.host,
        port: db.port,
        user: db.user,
        password: db.password,
        name: database,
    });
    try {
        const handle = await createBackupStream({ executor: new MariaDbExecutor(connection), database, groups, gzip });
        // stdout 纯备份字节；状态走 stderr。失败时流中途终止，外壳按退出码清理半成品
        process.stderr.write(
            `${JSON.stringify({ target: database, groups, gzip, startedAt: new Date().toISOString() })}\n`,
        );
        await pipeline(handle.stream, process.stdout);
        await handle.done;
        process.stderr.write(
            `${JSON.stringify({
                result: "SUCCEEDED",
                tables: handle.meta().tables.length,
                rows: handle.meta().tables.reduce((sum, table) => sum + table.rowCount, 0),
                sqlBytes: handle.sqlBytes(),
            })}\n`,
        );
    } finally {
        await connection.end().catch(() => {
            connection.destroy();
        });
    }
};

main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});

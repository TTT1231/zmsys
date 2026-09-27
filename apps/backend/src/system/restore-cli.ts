/**
 * 恢复 CLI 薄入口（实施计划 CLI 节）：`node dist/system/restore-cli.js`
 * 在 backend 镜像的临时命令容器（或本地演练）内执行，不启动 HTTP、不运行默认 CMD。
 *
 * - 先做进程 UTC 初始化（process-tz），复用同一恢复引擎/校验/恢复锁；数据库凭据
 *   取自部署环境（compose 注入的 DB_*），不依赖 dotenv；
 * - stdin 专用于备份字节（远程模式由外层 SSH 流入并写入自管临时文件），不作为 shell 执行；
 * - 参数白名单校验：--mode merge|replace、--request-key、--yes、--print-target、
 *   --reset-password <account>、--fault <point>（演练专用）；
 * - 停写前提由外层保证（backend 已停）：入口只负责恢复锁与 requestKey 去重；
 * - --reset-password 不要求重跑恢复：停写后取得恢复锁，新密码经 stdin 单行传入
 *   （不走 argv、不记录），更新 bcrypt/password_changed_at/token_version/row_version
 *   并记用户变更日志（救援场景 operator 记为目标用户本人）。
 */
import "../process-tz";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import bcrypt from "bcryptjs";
import mariadb from "mariadb";
import { createBackupConnection } from "../prisma/create-pool";
import { restoreLockName } from "./restore-lock";
import {
    executeRestore,
    RestoreAbortedError,
    RestoreUnknownError,
    type RestoreCredential,
    type RestoreMode,
} from "./engine/restore-engine";

const ARGS = process.argv.slice(2);

const argValue = (name: string): string | undefined => {
    const index = ARGS.indexOf(`--${name}`);
    if (index === -1) return undefined;
    const value = ARGS[index + 1];
    if (value === undefined || value.startsWith("--")) return undefined;
    return value;
};

const hasFlag = (name: string): boolean => ARGS.includes(`--${name}`);

/**
 * CLI 专用主键：2^62 以上的正区间，与 App Snowflake（约 1e14 量级）不相交，
 * 单调递增避免同进程多次写入冲突。
 */
let cliIdCounter = 0n;
const nextCliId = (): bigint => {
    cliIdCounter += 1n;
    return 2n ** 62n + (BigInt(Date.now()) % 2n ** 40n) * 8192n + cliIdCounter;
};

interface CliOptions {
    mode: RestoreMode;
    requestKey: string | undefined;
    yes: boolean;
    printTarget: boolean;
    resetPassword: string | undefined;
    fault: string | undefined;
}

const FAULT_POINTS = ["exit-in-transaction", "exit-before-commit", "exit-after-commit", "commit-receipt-lost"];

const parseOptions = (): CliOptions => {
    const mode = argValue("mode") ?? "merge";
    if (mode !== "merge" && mode !== "replace") {
        throw new Error("--mode 只接受 merge 或 replace");
    }
    const requestKey = argValue("request-key");
    if (requestKey !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/.test(requestKey)) {
        throw new Error("--request-key 须为 8-64 位字母数字与 ._-= 字符");
    }
    const fault = argValue("fault");
    if (fault !== undefined && !FAULT_POINTS.includes(fault)) {
        throw new Error(`--fault 仅接受：${FAULT_POINTS.join(" / ")}`);
    }
    return {
        mode,
        requestKey,
        yes: hasFlag("yes"),
        printTarget: hasFlag("print-target"),
        resetPassword: argValue("reset-password"),
        fault,
    };
};

const readStdinToFile = async (path: string): Promise<{ sha256: string; size: number }> => {
    const hash = createHash("sha256");
    let size = 0;
    await pipeline(
        Readable.from(process.stdin as never),
        async function* (source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
            for await (const chunk of source) {
                size += chunk.length;
                hash.update(chunk);
                yield chunk;
            }
        },
        createWriteStream(path),
    );
    return { sha256: hash.digest("hex"), size };
};

const newConnection = (database: string): Promise<mariadb.Connection> =>
    createBackupConnection({
        host: process.env.DB_HOST ?? "localhost",
        port: Number.parseInt(process.env.DB_PORT ?? "3306", 10) || 3306,
        user: process.env.DB_USERNAME ?? "root",
        password: process.env.DB_PASSWORD ?? "",
        name: database,
    });

const acquireLock = async (connection: mariadb.Connection, lockName: string): Promise<boolean> => {
    const rows = (await connection.query("SELECT GET_LOCK(?, 0) AS locked", [lockName])) as Array<{
        locked: number | bigint | null;
    }>;
    // prepared 路径下 GET_LOCK 标量可能返回 BigInt：统一数值化后再比较
    return Number(rows[0]?.locked) === 1;
};

const main = async (): Promise<void> => {
    const options = parseOptions();
    const database = process.env.DB_DATABASE ?? "zmdb";

    if (options.printTarget) {
        process.stdout.write(`${JSON.stringify({ database, mode: options.mode })}\n`);
        return;
    }
    if (options.fault !== undefined) {
        process.env.ZMSYS_RESTORE_FAULT = options.fault;
    }

    if (options.resetPassword !== undefined) {
        await resetPassword(options.resetPassword, database);
        return;
    }
    if (options.requestKey === undefined) {
        throw new Error("缺少 --request-key（提交身份；失败重试沿用同一 key）");
    }

    const tempDir = join(tmpdir(), "zmsys-restore-cli");
    await mkdir(tempDir, { recursive: true });
    // 随机独占命名：两个同 key 的 CLI 进程不会互相覆盖/误删对方的输入文件
    const tempPath = join(tempDir, `restore-${randomUUID().slice(0, 12)}.part`);
    let sha256: string;
    try {
        sha256 = (await readStdinToFile(tempPath)).sha256;
    } catch (error) {
        await unlink(tempPath).catch(() => undefined);
        throw error;
    }
    try {
        await runRestoreFromTemp(tempPath, sha256, database, options);
    } finally {
        await unlink(tempPath).catch(() => undefined);
    }
};

const runRestoreFromTemp = async (
    tempPath: string,
    sha256: string,
    database: string,
    options: CliOptions,
): Promise<void> => {
    const lockName = restoreLockName(database);
    const connection = await newConnection(database);
    let lockHeld = false;
    try {
        if (!(await acquireLock(connection, lockName))) {
            throw new Error("恢复锁被占用：旧恢复会话尚未结束，确认后重试");
        }
        lockHeld = true;

        // requestKey 去重：同文件同模式回放原终态，否则报冲突
        const existing = (await connection.query(
            "SELECT id, status, file_sha256, mode FROM sys_restore_job WHERE request_key = ?",
            [options.requestKey!],
        )) as Array<{ id: bigint; status: string; file_sha256: string; mode: string }>;
        if (existing.length > 0) {
            const row = existing[0];
            if (row.file_sha256 === sha256 && row.mode === options.mode) {
                process.stdout.write(
                    `${JSON.stringify({ result: "existing", jobId: row.id.toString(), status: row.status })}\n`,
                );
                return;
            }
            throw new Error("该 requestKey 已用于其他文件或模式，须更换 requestKey");
        }

        const credential: RestoreCredential = {
            jobId: nextCliId(),
            requestKey: options.requestKey!,
            fileSha256: sha256,
            mode: options.mode,
            operatorId: 0n,
            operatorName: "restore-cli",
        };
        process.stdout.write(
            `${JSON.stringify({ target: database, mode: options.mode, requestKey: options.requestKey, sha256 })}\n`,
        );
        const report = await executeRestore(
            {
                executor: {
                    query: async <T>(sql: string, params?: unknown[]) =>
                        (params === undefined || params.length === 0
                            ? await connection.query(sql)
                            : await connection.query(sql, params)) as T,
                },
                database,
                mode: options.mode,
                credential,
            },
            () => createReadStream(tempPath),
        );
        const inserted = report.tables.reduce((sum, table) => sum + table.inserted, 0);
        const skipped = report.tables.reduce((sum, table) => sum + table.skipped, 0);
        const sequenceRaised = report.tables.reduce((sum, table) => sum + table.sequenceRaised, 0);
        process.stdout.write(
            `${JSON.stringify({
                result: "SUCCEEDED",
                mode: report.mode,
                tables: report.tables.length,
                inserted,
                skipped,
                sequenceRaised,
                tokenVersionsRaised: report.tokenVersionsRaised,
                apiIdempotencyPurged: report.apiIdempotencyPurged,
            })}\n`,
        );
        if (report.mode === "replace") {
            process.stdout.write(
                "replace 完成：所有用户会话已失效，须重新登录；若更换过 JWT_SECRET，先重建 backend 容器再启动。\n",
            );
        }
    } catch (error) {
        if (error instanceof RestoreUnknownError) {
            process.stderr.write(
                `提交结果未知（保留现场核实，禁止自动重跑；凭原 requestKey 重查凭证）：${String(error)}\n`,
            );
            process.exitCode = 3;
            return;
        }
        if (error instanceof RestoreAbortedError) {
            process.stderr.write(`恢复失败（已回滚）：${error.message}\n`);
            process.exitCode = 4;
            return;
        }
        throw error;
    } finally {
        if (lockHeld) {
            await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
        }
        await connection.end().catch(() => undefined);
    }
};

/** 救援改密：停写后取得同一恢复锁；新密码经 stdin 单行传入（不走 argv、不记录） */
const resetPassword = async (account: string, database: string): Promise<void> => {
    if (!/^[A-Za-z0-9_]{3,64}$/.test(account)) {
        throw new Error("账号为 3–64 位字母、数字或下划线");
    }
    const readline = createInterface({ input: process.stdin });
    const iterator = readline[Symbol.asyncIterator]();
    const first = await iterator.next();
    readline.close();
    const password = typeof first.value === "string" ? first.value : "";
    // 复用口令规则（change-password DTO）：6-128 位
    if (password.length < 6 || password.length > 128) {
        throw new Error("新密码长度须为 6-128 位");
    }

    const lockName = restoreLockName(database);
    const connection = await newConnection(database);
    let lockHeld = false;
    try {
        if (!(await acquireLock(connection, lockName))) {
            throw new Error("恢复锁被占用：旧恢复会话尚未结束");
        }
        lockHeld = true;
        // 密码更新与变更日志同事务：日志失败回滚，不留下无审计的改密；
        // FOR UPDATE 在 autocommit 下锁立即释放，必须先开事务再锁行
        await connection.query("START TRANSACTION");
        try {
            const before = (await connection.query(
                "SELECT id, account, name, role_code, status, token_version, row_version FROM sys_user WHERE account = ? FOR UPDATE",
                [account],
            )) as Array<Record<string, unknown>>;
            if (before.length === 0) {
                throw new Error(`账号不存在：${account}`);
            }
            const user = before[0]!;
            const snapshot = {
                account: user.account,
                name: user.name,
                role: user.role_code,
                status: user.status === 1,
            };
            const passwordHash = await bcrypt.hash(password, 10);
            const utcNow = new Date().toISOString().slice(0, 23).replace("T", " ");
            await connection.query(
                `UPDATE sys_user
                 SET password_hash = ?, password_changed_at = ?, token_version = token_version + 1, row_version = row_version + 1
                 WHERE account = ?`,
                [passwordHash, utcNow, account],
            );
            const afterVersion = Number(user.row_version) + 1;
            await connection.query(
                `INSERT INTO sys_user_change_log
                     (id, user_id, operator_id, event_type, before_version, after_version, reason, before_json, after_json, created_at)
                 VALUES (?, ?, ?, 'PASSWORD_RESET', ?, ?, '恢复 CLI 救援改密', CAST(? AS JSON), CAST(? AS JSON), ?)`,
                [
                    nextCliId(),
                    user.id,
                    user.id,
                    Number(user.row_version),
                    afterVersion,
                    JSON.stringify(snapshot),
                    JSON.stringify(snapshot),
                    utcNow,
                ],
            );
            await connection.query("COMMIT");
        } catch (error) {
            await connection.query("ROLLBACK").catch(() => undefined);
            throw error;
        }
        process.stdout.write(`${JSON.stringify({ result: "PASSWORD_RESET", account })}\n`);
        process.stdout.write("救援改密完成：该账号旧 JWT 已失效，请用新密码重新登录。\n");
    } finally {
        if (lockHeld) {
            await connection.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => undefined);
        }
        await connection.end().catch(() => undefined);
    }
};

main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});

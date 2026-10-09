/**
 * 恢复演练（db-scheme.md §10.5，双轨 + 故障注入，仅对 *_test 库）：
 *
 * replace 轨：源库造自引用父子/三层（子 id < 父 id）→ 备份 → reset+seed → 目标库造
 * 幂等记录与待删行 → replace → 断言自引用插回/幂等清空/业务字段还原/token_version
 * 抬升/凭证 SUCCEEDED/取号不撞。
 *
 * merge 轨：基线（reset+seed 后重新备份）→ 删 2 行 op_log 补插 / 调低 biz_sequence
 * GREATEST 抬升 / 改名分歧整体回滚。
 *
 * 故障注入（restore-cli 子进程 + ZMSYS_RESTORE_FAULT）：
 * ① 成功后同 key 同文件重提 → 回放既有终态；
 * ② commit-receipt-lost → 子进程 exit=3（UNKNOWN 语义）→ 持锁核实成功凭证存在；
 * ③ exit-after-commit → 凭证可查（提交后/审计前崩溃）；
 * ④ exit-in-transaction → 启动门禁等待旧会话结束 → 确认无成功凭证 → 同 key 重跑成功。
 *
 * 前置：pnpm test:db:reset 已使 zmdb_test 处于迁移+seed 状态（脚本会自行再 reset 一次）。
 */
import { config } from "dotenv";
import "../apps/backend/src/process-tz.js";
import { deriveTestDatabase, loadDbEnv } from "../apps/backend/src/configuration/raw-env.js";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import mariadb from "mariadb";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
const backendDir = join(repoRoot, "apps", "backend");
config({ path: join(repoRoot, ".env") });

const db = loadDbEnv();
const HOST = db.host;
const DATABASE = deriveTestDatabase(db.database);
if (!DATABASE.endsWith("_test")) {
    throw new Error(`演练仅允许 *_test 库，当前 ${DATABASE}`);
}
if (!["localhost", "127.0.0.1"].includes(HOST)) {
    throw new Error(`演练仅允许 localhost，当前 ${HOST}`);
}

const assert = (condition: unknown, message: string): void => {
    if (!condition) {
        throw new Error(`断言失败：${message}`);
    }
};

const newConnection = (): Promise<mariadb.Connection> =>
    mariadb.createConnection({
        host: HOST,
        port: db.port,
        user: db.user,
        password: db.password,
        database: DATABASE,
        timezone: "Z",
        sessionVariables: { time_zone: "+00:00" },
        bigIntAsNumber: false,
        decimalAsNumber: false,
        jsonStrings: true,
        dateStrings: true,
    } as never);

const resetDb = (): void => {
    console.log("  · reset+seed 测试库");
    const result = spawnSync("pnpm", ["test:db:reset"], { cwd: repoRoot, stdio: "ignore", shell: true });
    if (result.status !== 0) {
        throw new Error(`test:db:reset 失败（exit=${result.status}）`);
    }
};

const queryOne = async <T>(sql: string, params?: unknown[]): Promise<T | undefined> => {
    const connection = await newConnection();
    try {
        const rows = (params === undefined ? await connection.query(sql) : await connection.query(sql, params)) as T[];
        return rows[0];
    } finally {
        await connection.end();
    }
};

const execute = async (sql: string, params?: unknown[]): Promise<unknown> => {
    const connection = await newConnection();
    try {
        return params === undefined ? await connection.query(sql) : await connection.query(sql, params);
    } finally {
        await connection.end();
    }
};

/** 备份到临时文件（进程内引擎，全量分组） */
const makeBackup = async (filePath: string): Promise<void> => {
    const { createBackupStream } = await import("../apps/backend/src/system/engine/backup-writer.js");
    const { ALL_GROUP_KEYS } = await import("../apps/backend/src/system/backup.catalog.js");
    const { createBackupConnection } = await import("../apps/backend/src/prisma/create-pool.js");
    const connection = await createBackupConnection({
        host: HOST,
        port: db.port,
        user: db.user,
        password: db.password,
        name: DATABASE,
    });
    try {
        const executor = {
            query: async <T>(sql: string, params?: unknown[]) =>
                (params === undefined || params.length === 0
                    ? await connection.query(sql)
                    : await connection.query(sql, params)) as T,
            queryStream: <T>(sql: string): AsyncIterable<T> => streamOf(connection, sql) as AsyncIterable<T>,
        };
        const handle = await createBackupStream({ executor, database: DATABASE, groups: ALL_GROUP_KEYS, gzip: false });
        await pipeline(handle.stream, createWriteStream(filePath));
        await handle.done;
    } finally {
        await connection.end();
    }
};

async function* streamOf(connection: mariadb.Connection, sql: string): AsyncGenerator<Record<string, unknown>> {
    const stream = connection.queryStream(sql) as unknown as {
        on(event: string, listener: (...args: never[]) => void): void;
        destroy?(): void;
    };
    const pending: Record<string, unknown>[] = [];
    let ended = false;
    let failure: unknown;
    let wake: (() => void) | undefined;
    stream.on("data", (row: never) => {
        pending.push(row as Record<string, unknown>);
        wake?.();
    });
    stream.on("end", () => {
        ended = true;
        wake?.();
    });
    stream.on("error", (error: unknown) => {
        failure = error;
        wake?.();
    });
    try {
        for (;;) {
            if (pending.length > 0) {
                yield pending.shift()!;
                continue;
            }
            if (failure !== undefined) throw failure;
            if (ended) return;
            await new Promise<void>(resolve => {
                wake = resolve;
            });
            wake = undefined;
        }
    } finally {
        stream.destroy?.();
    }
}

/** restore-cli 子进程（stdin = 备份文件字节；fault 注入；返回 exit code 与 stdout） */
const runCli = async (
    args: string[],
    filePath: string,
    fault?: string,
): Promise<{ code: number | null; stdout: string }> => {
    const env: NodeJS.ProcessEnv = { ...process.env, DB_DATABASE: DATABASE };
    if (fault !== undefined) {
        env.ZMSYS_RESTORE_FAULT = fault;
    }
    const child = spawn(
        process.execPath,
        [
            join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
            join(backendDir, "src", "system", "restore-cli.ts"),
            ...args,
        ],
        { stdio: ["pipe", "pipe", "pipe"], env },
    );
    const chunks: Buffer[] = [];
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.stderr.on("data", chunk => chunks.push(chunk));
    const exited = new Promise<number | null>(resolveExit => child.on("exit", code => resolveExit(code)));
    const { createReadStream } = await import("node:fs");
    await pipeline(createReadStream(filePath), child.stdin).catch(() => undefined);
    const code = await exited;
    return { code, stdout: Buffer.concat(chunks).toString("utf8") };
};

const tempFile = (name: string): string => join(tmpdir(), `zmsys-drill-${name}.sql`);

/** 持锁核实（扮演服务端 UNKNOWN 核实循环：锁在手后查凭证） */
const verifyWithLock = async (
    requestKey: string,
): Promise<{ locked: boolean; row: { status: string } | undefined }> => {
    const connection = await newConnection();
    try {
        const { restoreLockName } = await import("../apps/backend/src/system/restore-lock.js");
        const lockName = restoreLockName(DATABASE);
        const lockRows = (await connection.query("SELECT GET_LOCK(?, 0) AS locked", [lockName])) as Array<{
            locked: number | bigint | null;
        }>;
        const locked = Number(lockRows[0]?.locked) === 1;
        const rows = (await connection.query("SELECT status FROM sys_restore_job WHERE request_key = ?", [
            requestKey,
        ])) as Array<{ status: string }>;
        if (locked) {
            await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
        }
        return { locked, row: rows[0] };
    } finally {
        await connection.end();
    }
};

const main = async (): Promise<void> => {
    console.log("== replace 轨 ==");
    resetDb();
    // ① 源库造自引用三层（孙 id < 祖 id）：material_group parent 链 + bom 品类引用
    const grandId = 9_000_000_000_000_001n;
    const childId = 9_000_000_000_000_002n;
    const grandChildId = 9_000_000_000_000_003n;
    await execute(
        `INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, qty, sort_order, status, created_at, updated_at)
         VALUES (?, 1001, NULL, 'SECTION', '演练祖分区', NULL, NULL, NULL, 0, 1, '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000'),
                (?, 1001, ?, 'GROUP', '演练子分组', 'drill-child', 0, 0, 1, 1, '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000'),
                (?, 1001, ?, 'GROUP', '演练孙分组', 'drill-grandchild', 0, 0, 2, 1, '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000')`,
        [grandId, childId, grandId, grandChildId, childId],
    );
    await execute(
        `INSERT INTO biz_sequence (sequence_key, next_value, updated_at) VALUES ('order:global', 42, '2026-01-01 00:00:00.000')
         ON DUPLICATE KEY UPDATE next_value = 42`,
    );
    const replaceBackupPath = tempFile("replace");
    await makeBackup(replaceBackupPath);

    // ② reset+seed 后目标库另造：幂等记录 + 待删行（孙分组的兄弟，将被 replace 清掉）
    resetDb();
    await execute(
        `INSERT INTO api_idempotency (id, actor_id, operation_key, idempotency_key, request_hash, state, created_at, updated_at, expires_at)
         VALUES (9100000000000001, 1, 'drill', 'drill-key', X'00', 'PROCESSING', '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000', '2030-01-01 00:00:00.000')`,
    );
    await execute(
        `INSERT INTO material_group (id, category_id, parent_id, kind, name, sort_order, status, created_at, updated_at)
         VALUES (9500000000000001, 1001, NULL, 'SECTION', '待删除分区', 9, 1, '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000')`,
    );
    await execute("UPDATE sys_user SET name = '改名待还原', token_version = 5 WHERE account = 'guojun'");

    const replaceKey = `drill-${randomUUID().slice(0, 26)}`;
    const replaceRun = await runCli(["--mode", "replace", "--request-key", replaceKey], replaceBackupPath);
    assert(replaceRun.code === 0, `replace 应成功（exit=${replaceRun.code}）\n${replaceRun.stdout}`);
    assert(replaceRun.stdout.includes('"result":"SUCCEEDED"'), "replace 凭证应为 SUCCEEDED");

    // ③ 断言：自引用三层真正插回；幂等清空；业务字段还原；token_version 抬升；待删行消失
    const grand = await queryOne<{ n: number | bigint }>("SELECT COUNT(*) AS n FROM material_group WHERE id = ?", [
        grandId,
    ]);
    const grandChild = await queryOne<{ n: number | bigint }>(
        "SELECT COUNT(*) AS n FROM material_group WHERE id = ? AND parent_id = ?",
        [grandChildId, childId],
    );
    assert(Number(grand?.n) === 1 && Number(grandChild?.n) === 1, "自引用三层未插回");
    const doomed = await queryOne<{ n: number | bigint }>(
        "SELECT COUNT(*) AS n FROM material_group WHERE id = 9500000000000001",
    );
    assert(Number(doomed?.n) === 0, "replace 未清掉两次备份之间新增的行");
    const idem = await queryOne<{ n: number | bigint }>("SELECT COUNT(*) AS n FROM api_idempotency");
    assert(Number(idem?.n) === 0, "api_idempotency 未清空");
    const user = await queryOne<{ name: string; token_version: unknown }>(
        "SELECT name, token_version FROM sys_user WHERE account = 'guojun'",
    );
    assert(user?.name === "郭均", "业务字段未还原");
    assert(
        BigInt(user!.token_version as bigint | number | string) === 6n,
        `token_version 应为 max(5, 备份 1)+1=6，实际 ${user!.token_version}`,
    );
    const sequence = await queryOne<{ n: number | bigint }>(
        "SELECT COUNT(*) AS n FROM biz_sequence WHERE sequence_key = 'order:global' AND next_value = 42",
    );
    assert(Number(sequence?.n) === 1, "序列未还原（后续取号将撞号）");
    const credential = await queryOne<{ status: string; mode: string }>(
        "SELECT status, mode FROM sys_restore_job WHERE request_key = ?",
        [replaceKey],
    );
    assert(credential?.status === "SUCCEEDED" && credential?.mode === "replace", "凭证行缺失或状态不符");
    console.log("  ✓ replace 轨全绿（自引用/清理/还原/token_version/序列/凭证）");

    console.log("== merge 轨 ==");
    resetDb();
    // 基线：先造 op_log 行与序列行（seed 均无），再从该基线重新备份
    await execute(
        `INSERT INTO op_log (id, operator_id, operator_name_snapshot, operator_role_snapshot, action, target_type, target_id, target_code, detail_json, created_at)
         VALUES (9200000000000001, 1, '郭均', 'super', 'create_order', 'order', 1, 'SO-0001', '{"drill": 1}', '2026-01-01 00:00:00.000'),
                (9200000000000002, 1, '郭均', 'super', 'create_order', 'order', 2, 'SO-0002', '{"drill": 2}', '2026-01-01 00:00:00.000'),
                (9200000000000003, 1, '郭均', 'super', 'db_backup', 'backup', 0, 'drill', '{"drill": 3}', '2026-01-01 00:00:00.000')`,
    );
    await execute(
        `INSERT INTO biz_sequence (sequence_key, next_value, updated_at) VALUES ('drill:seq', 77, '2026-01-01 00:00:00.000')`,
    );
    const mergeBackupPath = tempFile("merge");
    await makeBackup(mergeBackupPath);

    // 场景 A：删 2 行 op_log → merge 补插
    await execute("DELETE FROM op_log ORDER BY id ASC LIMIT 2");
    const beforeA = Number((await queryOne<{ n: number | bigint }>("SELECT COUNT(*) AS n FROM op_log"))?.n);
    assert(beforeA === 1, `删除后应剩 1 行，实际 ${beforeA}`);
    const mergeA = await runCli(
        ["--mode", "merge", "--request-key", `drill-${randomUUID().slice(0, 26)}`],
        mergeBackupPath,
    );
    assert(mergeA.code === 0, `merge A 应成功\n${mergeA.stdout}`);
    const afterA = Number((await queryOne<{ n: number | bigint }>("SELECT COUNT(*) AS n FROM op_log"))?.n);
    assert(afterA === 3, `op_log 应补插回 3 行（当前 ${afterA}）`);
    console.log("  ✓ merge 补插（删 2 行 op_log → 回插）");

    // 场景 B：目标库调低 biz_sequence → merge 基线（77）GREATEST 抬升
    await execute("UPDATE biz_sequence SET next_value = 1 WHERE sequence_key = 'drill:seq'");
    const mergeB = await runCli(
        ["--mode", "merge", "--request-key", `drill-${randomUUID().slice(0, 26)}`],
        mergeBackupPath,
    );
    assert(mergeB.code === 0, `merge B 应成功\n${mergeB.stdout}`);
    assert(mergeB.stdout.includes('"sequenceRaised":1'), `biz_sequence 应走 GREATEST 抬升：${mergeB.stdout}`);
    const sequenceB = await queryOne<{ next_value: unknown }>(
        "SELECT next_value FROM biz_sequence WHERE sequence_key = 'drill:seq'",
    );
    assert(
        BigInt(sequenceB!.next_value as bigint | number | string) === 77n,
        `GREATEST 后应为 77，实际 ${sequenceB!.next_value}`,
    );
    console.log("  ✓ merge GREATEST（1 → 77）");

    // 场景 C：目标行改名 → 与备份分歧 → 整体回滚
    await execute("UPDATE sys_user SET name = '分歧名' WHERE account = 'guojun'");
    const mergeC = await runCli(
        ["--mode", "merge", "--request-key", `drill-${randomUUID().slice(0, 26)}`],
        mergeBackupPath,
    );
    assert(mergeC.code === 4, `分歧应 exit=4（已回滚），实际 ${mergeC.code}\n${mergeC.stdout}`);
    const nameC = await queryOne<{ name: string }>("SELECT name FROM sys_user WHERE account = 'guojun'");
    assert(nameC?.name === "分歧名", "分歧回滚后目标值应保留");
    console.log("  ✓ merge 分歧整体回滚");

    console.log("== 故障注入 ==");
    // 分歧场景改过 guojun 名称：复位（updated_at 差异属豁免列）后再做注入
    await execute("UPDATE sys_user SET name = '郭均' WHERE account = 'guojun'");
    // ① 成功后同 key 同文件重提 → 回放既有终态
    const keyA = `drill-${randomUUID().slice(0, 26)}`;
    const first = await runCli(["--mode", "merge", "--request-key", keyA], mergeBackupPath);
    assert(first.code === 0 && first.stdout.includes('"result":"SUCCEEDED"'), `基线 merge 应成功\n${first.stdout}`);
    const replay = await runCli(["--mode", "merge", "--request-key", keyA], mergeBackupPath);
    assert(replay.code === 0 && replay.stdout.includes('"result":"existing"'), `重提应回放既有终态\n${replay.stdout}`);
    console.log("  ✓ ① 同 key 重提回放既有终态");

    // ② COMMIT 回执丢失（exit=3，UNKNOWN 语义）→ 持锁核实成功
    const keyB = `drill-${randomUUID().slice(0, 26)}`;
    const lost = await runCli(["--mode", "merge", "--request-key", keyB], mergeBackupPath, "commit-receipt-lost");
    assert(lost.code === 3, `commit-receipt-lost 应 exit=3（UNKNOWN），实际 ${lost.code}\n${lost.stdout}`);
    const verifiedB = await verifyWithLock(keyB);
    assert(verifiedB.locked, "核实连接应能取得恢复锁（旧会话已结束）");
    assert(
        verifiedB.row?.status === "SUCCEEDED",
        `核实应为 SUCCEEDED（不报 FAILED/不重跑），实际 ${verifiedB.row?.status}`,
    );
    console.log("  ✓ ② 回执丢失 → UNKNOWN → 核实成功");

    // ③ 提交后/审计前杀进程（exit-after-commit）→ 凭证可查
    const keyC = `drill-${randomUUID().slice(0, 26)}`;
    const killed = await runCli(["--mode", "merge", "--request-key", keyC], mergeBackupPath, "exit-after-commit");
    assert(killed.code === 70, `exit-after-commit 应 exit=70，实际 ${killed.code}`);
    const rowC = await queryOne<{ status: string }>("SELECT status FROM sys_restore_job WHERE request_key = ?", [keyC]);
    assert(rowC?.status === "SUCCEEDED", `重启后成功凭证应可查，实际 ${rowC?.status}`);
    console.log("  ✓ ③ 提交后崩溃 → 凭证可查");

    // ④ 提交前断线（exit-in-transaction，持锁持事务死亡）→ 门禁等待旧会话结束 → 无凭证 → 同 key 重跑成功
    const keyD = `drill-${randomUUID().slice(0, 26)}`;
    const died = await runCli(["--mode", "merge", "--request-key", keyD], mergeBackupPath, "exit-in-transaction");
    assert(died.code === 70, `exit-in-transaction 应 exit=70，实际 ${died.code}`);
    const verifiedD = await verifyWithLock(keyD);
    assert(verifiedD.locked, "旧会话结束后应能取得锁（启动门禁语义）");
    assert(verifiedD.row === undefined, "确认无成功凭证才允许重试");
    const rerun = await runCli(["--mode", "merge", "--request-key", keyD], mergeBackupPath);
    assert(rerun.code === 0 && rerun.stdout.includes('"result":"SUCCEEDED"'), `同 key 重跑应成功\n${rerun.stdout}`);
    console.log("  ✓ ④ 回滚中重启 → 等待旧会话 → 确认未提交 → 同 key 重跑成功");

    // 清理演练产物
    await rm(replaceBackupPath, { force: true });
    await rm(mergeBackupPath, { force: true });
    console.log("\n演练全部通过：replace 轨 / merge 轨 / 四项故障注入 ✓");
};

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});

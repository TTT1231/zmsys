/**
 * 应用内备份/恢复 · 真实冒烟验收（实施计划 §验证 手动/演练项的自动化）。
 *
 * 前置（本脚本不代做）：
 *   1. zmdb_test 已恢复生产备份（去 DEFINER）并应用全部迁移（含 20260942000000）；
 *   2. 超管口令已用救援 CLI 重置（pnpm restore-database --reset-password guojun）；
 *   3. backend 已构建（dist）。
 *
 * 冒烟覆盖（真实 HTTP，生产体量数据）：
 *   登录/目录 → 全量 gzip 备份（校验头尾/checksum/行数=生产）→ 预检（meta+canReplace）
 *   → 同基线 merge 全 skipped → 删 2 行 op_log 后 merge 补插 → replace（幂等清理 +
 *   token_version 抬升 + 旧 JWT 401 + 原 key 重查 + 维护解除）→ 行数一致性核对
 *   → CLI 同 key 重提回放。
 */
import { config } from "dotenv";
import "../apps/backend/src/process-tz.js";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import mysql from "mariadb";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
const backendDir = join(repoRoot, "apps", "backend");
config({ path: join(repoRoot, ".env") });

const DATABASE = process.env.SMOKE_DB ?? "zmdb_test";
if (!DATABASE.endsWith("_test")) {
    throw new Error(`冒烟仅允许 *_test 库，当前 ${DATABASE}`);
}
const HOST = process.env.DB_HOST ?? "localhost";
const PORT = process.env.DB_PORT ?? "3306";
const DB_USER = process.env.DB_USERNAME ?? "root";
const DB_PASSWORD = process.env.DB_PASSWORD ?? "";
const BACKEND_PORT = process.env.SMOKE_BACKEND_PORT ?? "5050";
const base = `http://127.0.0.1:${BACKEND_PORT}/api`;
const PASSWORD = process.env.SMOKE_SUPER_PASSWORD ?? "smoke-test-2026";

const TERMINAL = new Set(["SUCCEEDED", "SUCCEEDED_AUDIT_FAILED", "FAILED"]);
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

interface Job {
    jobId: string;
    requestKey: string;
    status: string;
    report: {
        tables?: Array<{ name: string; inserted: number; skipped: number }>;
        tokenVersionsRaised?: number;
        apiIdempotencyPurged?: number;
    } | null;
    errorText: string;
}

const sql = async <T>(statement: string): Promise<T> => {
    const connection = await mysql.createConnection({
        host: HOST,
        port: Number.parseInt(PORT, 10),
        user: DB_USER,
        password: DB_PASSWORD,
        database: DATABASE,
        timezone: "Z",
        sessionVariables: { time_zone: "+00:00" },
    });
    try {
        return (await connection.query(statement)) as T;
    } finally {
        await connection.end();
    }
};

const multipart = (
    fields: Record<string, string>,
    file: { name: string; data: Buffer },
): { headers: Record<string, string>; body: Buffer } => {
    const boundary = `----zmsys${randomUUID().replace(/-/g, "")}`;
    const head = Object.entries(fields)
        .map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
        .join("");
    const fileHead = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const body = Buffer.concat([
        Buffer.from(head + fileHead, "utf8"),
        file.data,
        Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
    ]);
    return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body };
};

async function main(): Promise<void> {
    console.log(`[冒烟] 库 ${DATABASE}@${HOST}，后端产物 dist，端口 ${BACKEND_PORT}`);

    // ① 起真实后端进程（dist/main.js，NODE_ENV=development 使维护清理按真实节奏注册）
    const child = spawn(process.execPath, [join(backendDir, "dist", "main.js")], {
        cwd: backendDir,
        env: {
            ...process.env,
            DB_DATABASE: DATABASE,
            PORT: BACKEND_PORT,
            HOST: "127.0.0.1",
            NODE_ENV: "development",
            TZ: "UTC",
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    const logs: string[] = [];
    child.stdout.on("data", chunk => logs.push(chunk.toString()));
    child.stderr.on("data", chunk => logs.push(chunk.toString()));
    const exited = new Promise<number | null>(resolve => child.on("exit", code => resolve(code)));
    try {
        const deadline = Date.now() + 60_000;
        for (;;) {
            try {
                const res = await fetch(`${base}/health/live`);
                if (res.status === 200) break;
            } catch {
                /* 未就绪 */
            }
            if (Date.now() > deadline) throw new Error("后端启动超时");
            if (logs.join("").includes("维护态")) throw new Error("启动门禁未通过（恢复锁被占）");
            await sleep(300);
        }
        console.log("  ✓ 后端就绪（启动门禁通过，业务写开放）");

        // ② 登录 + 目录
        const loginRes = await fetch(`${base}/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ account: "guojun", password: PASSWORD }),
        });
        if (loginRes.status !== 200) throw new Error(`登录失败：${await loginRes.text()}`);
        const token = ((await loginRes.json()) as { data: { accessToken: string } }).data.accessToken;
        const auth = { authorization: `Bearer ${token}` };
        const catalogRes = await fetch(`${base}/system/backup/catalog`, { headers: auth });
        const catalog = ((await catalogRes.json()) as { data: { groups: unknown[] } }).data;
        if (catalog.groups.length !== 8) throw new Error(`目录应为 8 组，实际 ${catalog.groups.length}`);
        console.log("  ✓ 登录/目录（8 组）");

        // ③ 全量 gzip 备份：校验头尾/checksum/行数=生产
        const backupRes = await fetch(`${base}/system/backup/run`, {
            method: "POST",
            headers: { ...auth, "content-type": "application/json" },
            body: JSON.stringify({
                groups: ["users", "sequences", "customers", "bom", "orders", "inbound", "outbound", "system"],
                gzip: true,
            }),
        });
        if (backupRes.status !== 200) throw new Error(`备份失败：${await backupRes.text()}`);
        const fileName = /filename="([^"]+)"/.exec(backupRes.headers.get("content-disposition") ?? "")?.[1] ?? "";
        const gzBody = Buffer.from(await backupRes.arrayBuffer());
        const plain = gunzipSync(gzBody);
        const lines = plain.toString("utf8").split("\n");
        const metaLine = lines[1]!;
        const meta = JSON.parse(metaLine.replace("-- meta: ", "")) as {
            tables: Array<{ name: string; rowCount: number }>;
        };
        if (lines[0] !== "-- zmsys-backup v1" || lines.at(-2) !== "-- zmsys-backup-end")
            throw new Error("备份头尾不符");
        const hash = createHash("sha256");
        for (const line of lines.slice(1)) {
            if (line.startsWith("-- checksum: ")) break;
            hash.update(line);
            hash.update("\n");
        }
        const checksumLine = lines.find(line => line.startsWith("-- checksum: "))!;
        if (checksumLine !== `-- checksum: ${hash.digest("hex")}`) throw new Error("checksum 不符");
        const backupPath = join(tmpdir(), `zmsys-smoke-${randomUUID().slice(0, 8)}.sql.gz`);
        await writeFile(backupPath, gzBody);
        const prodCounts = await sql<Array<Record<string, number | bigint>>>(
            "SELECT (SELECT COUNT(*) FROM sys_user) u,(SELECT COUNT(*) FROM custom_table) c,(SELECT COUNT(*) FROM sales_order_table) o,(SELECT COUNT(*) FROM bom_table) b,(SELECT COUNT(*) FROM inbound_ledger) i,(SELECT COUNT(*) FROM outbound_shipment) s,(SELECT COUNT(*) FROM op_log) l",
        );
        const row = prodCounts[0]!;
        const inMeta = (table: string): number => meta.tables.find(item => item.name === table)?.rowCount ?? -1;
        const expectEqual = (table: string, actual: number | bigint, label: string): void => {
            if (Number(actual) !== inMeta(table))
                throw new Error(`${label} 行数不符：生产 ${actual} / 备份 ${inMeta(table)}`);
        };
        expectEqual("sys_user", row.u!, "sys_user");
        expectEqual("custom_table", row.c!, "custom_table");
        expectEqual("sales_order_table", row.o!, "sales_order_table");
        expectEqual("inbound_ledger", row.i!, "inbound_ledger");
        expectEqual("op_log", row.l!, "op_log");
        console.log(
            `  ✓ 备份（${fileName}，${plain.length} 字节 SQL / ${meta.tables.reduce((sum, table) => sum + table.rowCount, 0)} 行，checksum 与行数=生产）`,
        );

        const plainPath = backupPath.replace(/\.gz$/, "");
        await writeFile(plainPath, plain);

        // ④ 预检（gzip 直传）
        const previewPart = multipart({}, { name: "b.sql.gz", data: gzBody });
        const preview = await fetch(`${base}/system/restore/preview`, {
            method: "POST",
            headers: { ...auth, ...previewPart.headers },
            body: previewPart.body,
        });
        const previewText = await preview.text();
        if (preview.status !== 200) throw new Error(`预检失败 ${preview.status}：${previewText}`);
        const previewData = (JSON.parse(previewText) as { data: { canReplace: boolean; tables: unknown[] } }).data;
        if (previewData.canReplace !== true) throw new Error(`预检 canReplace=${previewData.canReplace}`);
        console.log(`  ✓ 预检（canReplace=true，${previewData.tables.length} 表）`);

        const submit = async (
            content: Buffer,
            mode: "merge" | "replace",
            requestKey: string,
        ): Promise<{ status: number; body: { data?: Job & { job?: Job }; message?: string } }> => {
            const { headers, body } = multipart(
                { mode, ack: mode === "merge" ? "RESTORE" : "REPLACE", requestKey },
                { name: "b.sql", data: content },
            );
            const res = await fetch(`${base}/system/restore/run`, {
                method: "POST",
                headers: { ...auth, ...headers },
                body,
            });
            return { status: res.status, body: (await res.json()) as never };
        };
        const waitJob = async (requestKey: string, useToken = token): Promise<Job> => {
            const deadline = Date.now() + 120_000;
            for (;;) {
                const res = await fetch(`${base}/system/restore/jobs/key/${requestKey}`, {
                    headers: { authorization: `Bearer ${useToken}` },
                });
                if (res.status === 401) {
                    throw new Error("轮询 token 失效（merge 不应抬升 token_version）");
                }
                if (res.status !== 200) throw new Error(`任务查询 ${res.status}：${await res.text()}`);
                const job = ((await res.json()) as { data: Job }).data;
                if (TERMINAL.has(job.status)) return job;
                if (Date.now() > deadline) throw new Error(`任务超时：${JSON.stringify(job)}`);
                await sleep(500);
            }
        };

        // ⑤ 同基线 merge：全 skipped（豁免列之外零插入）
        const key1 = `smoke-${randomUUID().slice(0, 26)}`;
        const merge1 = await submit(plain, "merge", key1);
        if (merge1.status !== 202) throw new Error(`merge 提交失败：${JSON.stringify(merge1.body)}`);
        const job1 = await waitJob(key1);
        const inserted1 = (job1.report?.tables ?? []).reduce((sum, table) => sum + table.inserted, 0);
        if (job1.status !== "SUCCEEDED" || inserted1 !== 0) {
            throw new Error(`同基线 merge 应全 skipped：${job1.status} / inserted=${inserted1}`);
        }
        console.log("  ✓ 同基线 merge 全 skipped（零插入）");

        // ⑥ 删 2 行 op_log → merge 补插 2
        await sql("DELETE FROM op_log ORDER BY id ASC LIMIT 2");
        const key2 = `smoke-${randomUUID().slice(0, 26)}`;
        const merge2 = await submit(plain, "merge", key2);
        if (merge2.status !== 202) throw new Error(`补插 merge 提交失败：${JSON.stringify(merge2.body)}`);
        const job2 = await waitJob(key2);
        const opLogInserted = job2.report?.tables?.find(table => table.name === "op_log")?.inserted ?? 0;
        if (job2.status !== "SUCCEEDED" || opLogInserted !== 2) {
            throw new Error(`补插 merge 应插入 2 行 op_log：${job2.status} / ${opLogInserted}`);
        }
        console.log("  ✓ 删 2 行 op_log → merge 补插 2");

        // ⑦ replace：幂等清理 + token_version 抬升 + 旧 JWT 401 + 原 key 重查
        await sql(
            "INSERT INTO api_idempotency (id, actor_id, operation_key, idempotency_key, request_hash, state, created_at, updated_at, expires_at) VALUES (9300000000000001, 1, 'smoke', 'smoke-key', X'00', 'PROCESSING', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), '2030-01-01 00:00:00.000')",
        );
        const key3 = `smoke-${randomUUID().slice(0, 26)}`;
        const replaceSubmit = await submit(plain, "replace", key3);
        if (replaceSubmit.status !== 202) throw new Error(`replace 提交失败：${JSON.stringify(replaceSubmit.body)}`);
        let replaceJob: Job | null = null;
        const replaceDeadline = Date.now() + 180_000;
        let currentToken = token;
        for (;;) {
            const res = await fetch(`${base}/system/restore/jobs/key/${key3}`, {
                headers: { authorization: `Bearer ${currentToken}` },
            });
            if (res.status === 401) {
                const relogin = await fetch(`${base}/auth/login`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ account: "guojun", password: PASSWORD }),
                });
                if (relogin.status === 503) {
                    await sleep(200); // 维护窗口内登录被拒：重试（客户端契约）
                    continue;
                }
                currentToken = ((await relogin.json()) as { data: { accessToken: string } }).data.accessToken;
                continue;
            }
            if (res.status !== 200) throw new Error(`replace 查询 ${res.status}`);
            const job = ((await res.json()) as { data: Job }).data;
            if (TERMINAL.has(job.status)) {
                replaceJob = job;
                break;
            }
            if (Date.now() > replaceDeadline) throw new Error("replace 超时");
            await sleep(500);
        }
        if (replaceJob!.status !== "SUCCEEDED") throw new Error(`replace 失败：${replaceJob!.errorText}`);
        if ((replaceJob!.report?.apiIdempotencyPurged ?? 0) < 1) throw new Error("api_idempotency 未清理");
        const usersRaised = replaceJob!.report?.tokenVersionsRaised ?? 0;
        const userCount = Number((await sql<Array<{ n: number | bigint }>>("SELECT COUNT(*) n FROM sys_user"))[0]!.n);
        if (usersRaised !== userCount) throw new Error(`token_version 抬升 ${usersRaised} ≠ 用户数 ${userCount}`);
        const staleCheck = await fetch(`${base}/system/backup/catalog`, {
            headers: { authorization: `Bearer ${token}` },
        });
        if (staleCheck.status !== 401) throw new Error(`旧 JWT 应 401，实际 ${staleCheck.status}`);
        const afterKey = await fetch(`${base}/system/restore/jobs/key/${key3}`, {
            headers: { authorization: `Bearer ${currentToken}` },
        });
        if (afterKey.status !== 200 || ((await afterKey.json()) as { data: Job }).data.status !== "SUCCEEDED") {
            throw new Error("重登录后凭原 key 重查失败");
        }
        console.log(
            `  ✓ replace（幂等清理 ${replaceJob!.report?.apiIdempotencyPurged} 行，token_version 抬升 ${usersRaised}，旧 JWT 401，原 key 重查）`,
        );

        // ⑧ 行数一致性：replace 后与备份 meta 全表一致（op_log 例外：恢复数据之外
        // 还会补写本次 db_restore 审计行）
        for (const table of meta.tables) {
            const count = Number(
                (await sql<Array<{ n: number | bigint }>>(`SELECT COUNT(*) n FROM \`${table.name}\``))[0]!.n,
            );
            const expected = table.name === "op_log" ? table.rowCount + 1 : table.rowCount;
            if (count !== expected) throw new Error(`replace 后 ${table.name} 行数 ${count} ≠ 预期 ${expected}`);
        }
        console.log(`  ✓ replace 后 ${meta.tables.length} 表行数与备份逐一一致（op_log 含 +1 行恢复审计）`);

        // ⑨ CLI 同 key 重提回放既有终态（真实 CLI 子进程）
        const cli = await new Promise<{ code: number | null; output: string }>(resolveCli => {
            const run = spawn(
                process.execPath,
                [
                    join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
                    join(backendDir, "src", "system", "restore-cli.ts"),
                    "--mode",
                    "replace",
                    "--request-key",
                    key3,
                ],
                {
                    env: {
                        ...process.env,
                        DB_DATABASE: DATABASE,
                        DB_HOST: HOST,
                        DB_PORT: PORT,
                        DB_USERNAME: DB_USER,
                        DB_PASSWORD,
                    },
                    stdio: ["pipe", "pipe", "pipe"],
                },
            );
            const chunks: Buffer[] = [];
            run.stdout.on("data", chunk => chunks.push(chunk));
            run.stderr.on("data", chunk => chunks.push(chunk));
            run.on("exit", code => resolveCli({ code, output: Buffer.concat(chunks).toString("utf8") }));
            // 与 HTTP 提交相同的字节（平文 .sql）：同 key 幂等回放要求摘要一致
            run.stdin.end(plain);
        });
        if (cli.code !== 0 || !cli.output.includes('"result":"existing"')) {
            throw new Error(`CLI 同 key 重提应回放：exit=${cli.code}\n${cli.output}`);
        }
        console.log("  ✓ CLI 同 key 重提回放既有终态（existing）");

        await rm(backupPath, { force: true });
        await rm(plainPath, { force: true });
        console.log("\n冒烟全部通过 ✓（真实生产体量数据 + 真实 HTTP + 真实 CLI）");
    } finally {
        child.kill();
        const code = await exited;
        if (existsSync(join(backendDir, "dist"))) void code;
    }
}

main().catch(error => {
    console.error(`\n冒烟失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});

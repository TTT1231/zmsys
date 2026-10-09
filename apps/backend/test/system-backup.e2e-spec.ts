/**
 * 应用内备份/恢复 e2e：真实 HTTP 管线 + 真实测试库（*_test）。
 * 覆盖：权限边界、备份格式与 checksum、merge 幂等/豁免列/分歧回滚/唯一键冲突/CHECK 违反、
 * 预检拒绝矩阵、requestKey 去重、replace（api_idempotency 清理 + token_version 抬升 +
 * 旧 JWT 失效）、维护态 503 与白名单、NOT_FOUND 查询语义、op_log 审计。
 * 运行前置：pnpm test:db:reset（test:e2e 已串联）。
 */
import "./db-guard";
import { createHash, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import { PrismaService } from "../src/prisma/prisma.service";
import { Prisma } from "../src/generated/prisma/client";
import { MaintenanceState } from "../src/domain/maintenance-state";
import {
    CHECKSUM_PREFIX,
    encodeSqlString,
    FORMAT_END,
    FORMAT_HEADER,
    parseInsertLine,
    type ParsedValue,
} from "../src/system/engine/backup-format";

interface JobBody {
    jobId: string;
    requestKey: string;
    status: "RUNNING" | "UNKNOWN" | "SUCCEEDED" | "SUCCEEDED_AUDIT_FAILED" | "FAILED";
    mode: "merge" | "replace";
    report: {
        tables?: Array<{ name: string; inserted: number; skipped: number }>;
        tokenVersionsRaised?: number;
        apiIdempotencyPurged?: number;
    } | null;
    errorText: string;
}

const TERMINAL: readonly JobBody["status"][] = ["SUCCEEDED", "SUCCEEDED_AUDIT_FAILED", "FAILED"];
const FULL_GROUPS = ["users", "sequences", "customers", "bom", "orders", "inbound", "outbound", "system"];

/** ParsedValue → SQL 字面量（INSERT 行重写的逆序列化） */
const renderValue = (value: ParsedValue): string => {
    switch (value.kind) {
        case "null":
            return "NULL";
        case "int":
        case "decimal":
            return value.text;
        case "bytes":
            return `X'${value.hex}'`;
        case "string":
            return encodeSqlString(value.text);
    }
};

/** 解析结果 → 单行 INSERT 语句（改写行内容用） */
const renderInsert = (parsed: { table: string; columns: string[]; rows: ParsedValue[][] }): string =>
    `INSERT INTO \`${parsed.table}\` (${parsed.columns.map(column => `\`${column}\``).join(", ")}) VALUES ${parsed.rows
        .map(row => `(${row.map(renderValue).join(",")})`)
        .join(",")};`;

interface BackupDoc {
    lines: string[];
    meta: { groups: string[]; tables: Array<{ name: string; rowCount: number }> };
}

const parseBackupDoc = (content: Buffer): BackupDoc => {
    const lines = content.toString("utf8").split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    const meta = JSON.parse(lines[1]!.replace("-- meta: ", "")) as BackupDoc["meta"];
    return { lines, meta };
};

/** 修改行内容后重建文件（重算 checksum：覆盖 header 后至 checksum 行前的全部行） */
const rebuildBackup = (doc: BackupDoc): Buffer => {
    const hash = createHash("sha256");
    for (const line of doc.lines.slice(1)) {
        if (line.startsWith(CHECKSUM_PREFIX)) break;
        hash.update(line);
        hash.update("\n");
    }
    const checksumIndex = doc.lines.findIndex(line => line.startsWith(CHECKSUM_PREFIX));
    expect(checksumIndex).toBeGreaterThan(0);
    const lines = [...doc.lines];
    lines[checksumIndex] = `${CHECKSUM_PREFIX}${hash.digest("hex")}`;
    return Buffer.from(`${lines.join("\n")}\n`, "utf8");
};

/** 对指定表的 INSERT 行做改写（返回是否改到至少一行） */
const rewriteTableLines = (
    doc: BackupDoc,
    table: string,
    mutator: (rows: ParsedValue[][], columns: string[]) => void,
): boolean => {
    let inSection = false;
    let touched = false;
    for (let i = 0; i < doc.lines.length; i += 1) {
        const line = doc.lines[i]!;
        if (line.startsWith("-- table ")) {
            inSection = line === `-- table ${table}`;
            continue;
        }
        if (inSection && line.startsWith("INSERT INTO ")) {
            const parsed = parseInsertLine(line);
            if (parsed.table !== table) continue;
            mutator(parsed.rows, parsed.columns);
            doc.lines[i] = renderInsert(parsed);
            touched = true;
        }
    }
    return touched;
};

describe("应用内备份/恢复 (e2e)", () => {
    let app: NestFastifyApplication;
    let prisma: PrismaService;
    let maintenance: MaintenanceState;
    let superToken: string;

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        prisma = app.get(PrismaService);
        maintenance = app.get(MaintenanceState);
        superToken = await login("guojun", "123456");
    });

    afterAll(async () => {
        await app.close();
    });

    async function login(account: string, password: string): Promise<string> {
        const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { account, password } });
        expect(res.statusCode).toBe(200);
        return res.json().data.accessToken;
    }

    /** 维护期登录 503 属正常（恢复收尾窗口）：按客户端契约带重试 */
    async function loginWithRetry(account: string, password: string, timeoutMs = 20_000): Promise<string> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { account, password } });
            if (res.statusCode === 200) {
                return res.json().data.accessToken;
            }
            if (res.statusCode !== 503 || Date.now() > deadline) {
                expect(res.statusCode).toBe(200);
                throw new Error("unreachable");
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    function multipart(fields: Record<string, string>, file: { name: string; data: Buffer }) {
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
        return {
            headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
            payload: body,
        };
    }

    async function downloadBackup(groups: string[], gzip: boolean, token = superToken): Promise<Buffer> {
        const res = await app.inject({
            method: "POST",
            url: "/api/system/backup/run",
            headers: { authorization: `Bearer ${token}` },
            payload: { groups, gzip },
        });
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-disposition"]).toContain("attachment");
        return res.rawPayload;
    }

    async function submitRestore(
        content: Buffer,
        mode: "merge" | "replace",
        requestKey: string,
        ack = mode === "merge" ? "RESTORE" : "REPLACE",
        token = superToken,
    ): Promise<{ status: number; data: { jobId: string; status: JobBody["status"]; job?: JobBody } }> {
        const { headers, payload } = multipart({ mode, ack, requestKey }, { name: "backup.sql", data: content });
        const res = await app.inject({
            method: "POST",
            url: "/api/system/restore/run",
            headers: { authorization: `Bearer ${token}`, ...headers },
            payload,
        });
        return { status: res.statusCode, data: res.json().data };
    }

    async function queryJobByKey(
        requestKey: string,
        token = superToken,
    ): Promise<{ status: number; data: JobBody | null }> {
        const res = await app.inject({
            method: "GET",
            url: `/api/system/restore/jobs/key/${requestKey}`,
            headers: { authorization: `Bearer ${token}` },
        });
        return { status: res.statusCode, data: res.statusCode === 200 ? (res.json().data as JobBody) : null };
    }

    async function waitTerminal(requestKey: string, token = superToken): Promise<JobBody> {
        const deadline = Date.now() + 60_000;
        for (;;) {
            const { status, data } = await queryJobByKey(requestKey, token);
            expect(status).toBe(200);
            if (TERMINAL.includes(data!.status)) {
                // 终态可见到维护解除之间有毫秒级收尾窗口：等维护解除再返回，
                // 避免 Bundle 后续请求落入 503
                while (maintenance.isActive()) {
                    await new Promise(resolve => setTimeout(resolve, 25));
                }
                return data!;
            }
            if (Date.now() > deadline) {
                throw new Error(`恢复任务超时未到终态：${JSON.stringify(data)}`);
            }
            await new Promise(resolve => setTimeout(resolve, 150));
        }
    }

    const newKey = (): string => `e2e-${randomUUID().slice(0, 26)}`;

    /* ------------------------- 权限与目录 ------------------------- */

    it("非超管访问系统端点 403", async () => {
        const token = await login("test", "123456");
        const res = await app.inject({
            method: "GET",
            url: "/api/system/backup/catalog",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(403);
        const denied = await submitRestore(Buffer.from("x"), "merge", newKey(), "RESTORE", token);
        expect(denied.status).toBe(403);
    });

    it("普通角色即使持有系统菜单码，也不能读取备份目录或恢复任务", async () => {
        const codes = ["menu:system-backup", "menu:system-restore"];
        await prisma.sysGrant.createMany({
            data: codes.map(permissionCode => ({
                roleCode: "staff",
                permissionCode,
                grantSource: "USER" as const,
                grantedBy: 1n,
                grantedAt: new Date(),
            })),
        });
        try {
            const token = await login("test", "123456");
            for (const [method, url] of [
                ["GET", "/api/system/backup/catalog"],
                ["POST", "/api/system/restore/preview"],
                ["GET", `/api/system/restore/jobs/key/${newKey()}`],
                ["GET", "/api/system/restore/jobs/1"],
            ] as const) {
                const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` } });
                expect(res.statusCode).toBe(403);
            }
        } finally {
            await prisma.sysGrant.deleteMany({ where: { roleCode: "staff", permissionCode: { in: codes } } });
        }
    });

    it("catalog 返回目录全集且互依成对出现", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/api/system/backup/catalog",
            headers: { authorization: `Bearer ${superToken}` },
        });
        expect(res.statusCode).toBe(200);
        const groups = res.json().data.groups as Array<{ key: string; dependsOn: string[] }>;
        expect(groups.map(group => group.key).sort()).toEqual([...FULL_GROUPS].sort());
        expect(groups.find(group => group.key === "inbound")!.dependsOn).toContain("outbound");
        expect(groups.find(group => group.key === "outbound")!.dependsOn).toContain("inbound");
    });

    /* ------------------------- 备份 ------------------------- */

    it("备份下载：头尾/checksum/meta 齐备，gzip 魔数正确，db_backup 审计先行", async () => {
        const content = await downloadBackup(FULL_GROUPS, false);
        const doc = parseBackupDoc(content);
        expect(doc.lines[0]).toBe(FORMAT_HEADER);
        expect(doc.lines.at(-1)).toBe(FORMAT_END);
        expect(doc.lines.find(line => line.startsWith(CHECKSUM_PREFIX))).toMatch(/^-- checksum: [0-9a-f]{64}$/);
        expect(doc.meta.groups).toHaveLength(8);
        const tableNames = doc.meta.tables.map(table => table.name);
        expect(tableNames).toContain("sys_user");
        expect(tableNames).toContain("op_log");
        expect(tableNames).not.toContain("sys_permission");
        expect(tableNames).not.toContain("api_idempotency");
        expect(tableNames).not.toContain("sys_restore_job");
        // 表段顺序满足 FK 拓扑（sys_role 在 sys_user 前）
        expect(doc.lines.indexOf("-- table sys_role")).toBeLessThan(doc.lines.indexOf("-- table sys_user"));

        const gz = await downloadBackup(["sequences"], true);
        expect(gz[0]).toBe(0x1f);
        expect(gz[1]).toBe(0x8b);

        const audit = await prisma.opLog.count({ where: { action: "db_backup" } });
        expect(audit).toBeGreaterThan(0);
    });

    it("部分备份按闭包展开（sequences 单组仅含 biz_sequence）", async () => {
        const content = await downloadBackup(["sequences"], false);
        const doc = parseBackupDoc(content);
        expect(doc.meta.groups).toEqual(["sequences"]);
        expect(doc.meta.tables.map(table => table.name)).toEqual(["biz_sequence"]);
    });

    it("备份 gzip 往返：下载 gz 文件可直接用于恢复预检", async () => {
        const gz = await downloadBackup(FULL_GROUPS, true);
        const { headers, payload } = multipart({}, { name: "b.sql.gz", data: gz });
        const res = await app.inject({
            method: "POST",
            url: "/api/system/restore/preview",
            headers: { authorization: `Bearer ${superToken}`, ...headers },
            payload,
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.canReplace).toBe(true);
    });

    /* ------------------------- preview 与预检拒绝 ------------------------- */

    it("preview：完整备份 canReplace=true；部分备份 canReplace=false", async () => {
        const full = await downloadBackup(FULL_GROUPS, false);
        const partial = await downloadBackup(["sequences"], false);
        for (const [content, expected] of [
            [full, true],
            [partial, false],
        ] as const) {
            const { headers, payload } = multipart({}, { name: "b.sql", data: content });
            const res = await app.inject({
                method: "POST",
                url: "/api/system/restore/preview",
                headers: { authorization: `Bearer ${superToken}`, ...headers },
                payload,
            });
            expect(res.statusCode).toBe(200);
            expect(res.json().data.canReplace).toBe(expected);
        }
    });

    it("预检失败矩阵：畸形/截断/坏 checksum/部分备份 replace/迁移名不符/错 ack → 400", async () => {
        const content = await downloadBackup(FULL_GROUPS, false);
        const doc = parseBackupDoc(content);

        // 截断（去掉结束标记之后内容 + 尾段）
        const truncated = Buffer.from(doc.lines.slice(0, 5).join("\n") + "\n", "utf8");
        // 坏 checksum
        const badChecksumDoc = parseBackupDoc(content);
        const checksumIndex = badChecksumDoc.lines.findIndex(line => line.startsWith(CHECKSUM_PREFIX));
        badChecksumDoc.lines[checksumIndex] = `${CHECKSUM_PREFIX}${"0".repeat(64)}`;
        const badChecksum = Buffer.from(badChecksumDoc.lines.join("\n") + "\n", "utf8");
        // 迁移名不符
        const migrationDoc = parseBackupDoc(content);
        migrationDoc.lines[1] = migrationDoc.lines[1]!.replace(
            /"latestMigration":"[^"]+"/,
            '"latestMigration":"20250101000000_old"',
        );
        const badMigration = rebuildBackup(migrationDoc);

        const partial = await downloadBackup(["sequences"], false);
        for (const [label, file, mode, ack] of [
            ["畸形", Buffer.from("not a backup"), "merge", "RESTORE"],
            ["截断", truncated, "merge", "RESTORE"],
            ["坏 checksum", badChecksum, "merge", "RESTORE"],
            ["迁移名不符", badMigration, "merge", "RESTORE"],
            ["部分备份 replace", partial, "replace", "REPLACE"],
            ["错 ack", content, "merge", "REPLACE"],
        ] as const) {
            const result = await submitRestore(file, mode as "merge" | "replace", newKey(), ack);
            expect(result.status, label).toBe(400);
            const preview = await app.inject({
                method: "POST",
                url: "/api/system/restore/preview",
                headers: {
                    authorization: `Bearer ${superToken}`,
                    ...multipart({}, { name: "x", data: file }).headers,
                },
                payload: multipart({}, { name: "x", data: file }).payload,
            });
            expect(preview.statusCode, `${label} preview`).toBe(400);
        }
    });

    it("超限：单行超过上限 → 413", async () => {
        const doc = parseBackupDoc(await downloadBackup(FULL_GROUPS, false));
        const touched = rewriteTableLines(doc, "op_log", (rows, columns) => {
            const detailIndex = columns.indexOf("detail_json");
            rows[0]![detailIndex] = { kind: "string", text: "x".repeat(9 * 1024 * 1024) };
        });
        expect(touched).toBe(true);
        const file = rebuildBackup(doc);
        const result = await submitRestore(file, "merge", newKey());
        expect(result.status).toBe(413);
    });

    /* ------------------------- merge ------------------------- */

    it("同一基线 merge：全 skipped；重登录后再 merge 不因 last_login_at 失败", async () => {
        const content = await downloadBackup(FULL_GROUPS, false);

        const key1 = newKey();
        const first = await submitRestore(content, "merge", key1);
        expect(first.status).toBe(202);
        const job1 = await waitTerminal(key1);
        expect(job1.status).toBe("SUCCEEDED");
        const inserted1 = (job1.report?.tables ?? []).reduce((sum, table) => sum + table.inserted, 0);
        expect(inserted1).toBe(0);

        // 重登录会更新 last_login_at（豁免列）：同一文件再次 merge 不得失败
        superToken = await login("guojun", "123456");
        const key2 = newKey();
        const second = await submitRestore(content, "merge", key2);
        expect(second.status).toBe(202);
        const job2 = await waitTerminal(key2);
        expect(job2.status).toBe("SUCCEEDED");
        expect((job2.report?.tables ?? []).reduce((sum, table) => sum + table.inserted, 0)).toBe(0);
        expect(job2.jobId).not.toBe(job1.jobId);

        const audit = await prisma.opLog.count({ where: { action: "db_restore" } });
        expect(audit).toBeGreaterThanOrEqual(2);
    });

    it("删 2 行 op_log → merge 补插 2", async () => {
        const content = await downloadBackup(FULL_GROUPS, false);
        const before = await prisma.opLog.count();
        expect(before).toBeGreaterThanOrEqual(2);
        const victims = await prisma.opLog.findMany({ orderBy: { id: "asc" }, take: 2 });
        await prisma.opLog.deleteMany({ where: { id: { in: victims.map(row => row.id) } } });
        expect(await prisma.opLog.count()).toBe(before - 2);

        const key = newKey();
        const result = await submitRestore(content, "merge", key);
        expect(result.status).toBe(202);
        const job = await waitTerminal(key);
        expect(job.status).toBe("SUCCEEDED");
        const opLogTable = (job.report?.tables ?? []).find(table => table.name === "op_log")!;
        expect(opLogTable.inserted).toBeGreaterThanOrEqual(2);
        expect(await prisma.opLog.count()).toBeGreaterThanOrEqual(before);
    });

    it("单头分歧 → 202 → FAILED + 整体回滚（无流水插入）", async () => {
        const content = await downloadBackup(FULL_GROUPS, false);
        const doc = parseBackupDoc(content);
        const touched = rewriteTableLines(doc, "sys_user", (rows, columns) => {
            const nameIndex = columns.indexOf("name");
            rows[0]![nameIndex] = { kind: "string", text: "改名冲突" };
        });
        expect(touched).toBe(true);
        const diverged = rebuildBackup(doc);

        const beforeCounts = await tableCounts();
        const key = newKey();
        const result = await submitRestore(diverged, "merge", key);
        expect(result.status).toBe(202);
        const job = await waitTerminal(key);
        expect(job.status).toBe("FAILED");
        expect(job.errorText).toContain("内容不一致");
        // 回滚：行数不变
        expect(await tableCounts()).toEqual(beforeCounts);
        // 凭证：SUCCEEDED/FAILED 各一行，requestKey 唯一
        const rows = await prisma.sysRestoreJob.count({ where: { requestKey: key } });
        expect(rows).toBe(1);
    });

    it("异 id 撞唯一账号 → FAILED + 回滚", async () => {
        const content = await downloadBackup(FULL_GROUPS, false);
        const doc = parseBackupDoc(content);
        rewriteTableLines(doc, "sys_user", (rows, columns) => {
            const idIndex = columns.indexOf("id");
            rows[0]![idIndex] = { kind: "int", text: "987654321012345" };
        });
        const file = rebuildBackup(doc);

        const beforeCounts = await tableCounts();
        const key = newKey();
        const result = await submitRestore(file, "merge", key);
        expect(result.status).toBe(202);
        const job = await waitTerminal(key);
        expect(job.status).toBe("FAILED");
        expect(job.errorText).toContain("uk_sys_user_account");
        expect(await tableCounts()).toEqual(beforeCounts);
    });

    it("执行期 CHECK 违反（op_log.detail_json 非对象）→ 202 → FAILED + 回滚", async () => {
        const content = await downloadBackup(FULL_GROUPS, false);
        const doc = parseBackupDoc(content);
        const touched = rewriteTableLines(doc, "op_log", (rows, columns) => {
            const detailIndex = columns.indexOf("detail_json");
            rows[0]![detailIndex] = { kind: "string", text: "[1]" };
        });
        expect(touched).toBe(true);
        const file = rebuildBackup(doc);

        const beforeCounts = await tableCounts();
        const key = newKey();
        const result = await submitRestore(file, "merge", key);
        expect(result.status).toBe(202);
        const job = await waitTerminal(key);
        expect(job.status).toBe("FAILED");
        expect(await tableCounts()).toEqual(beforeCounts);
    });

    /* ------------------------- requestKey 去重 ------------------------- */

    it("同 requestKey 同文件/模式重提 → 200 原终态（行数不变）；异文件 → 409", async () => {
        const content = await downloadBackup(FULL_GROUPS, false);
        const key = newKey();
        const first = await submitRestore(content, "merge", key);
        expect(first.status).toBe(202);
        await waitTerminal(key);
        const rowsAfterFirst = await prisma.sysRestoreJob.count();

        const replay = await submitRestore(content, "merge", key);
        expect(replay.status).toBe(200);
        expect(replay.data.status).toBe("SUCCEEDED");
        expect(await prisma.sysRestoreJob.count()).toBe(rowsAfterFirst);

        const otherFile = await downloadBackup(FULL_GROUPS, false);
        const conflict = await submitRestore(otherFile, "merge", key);
        expect(conflict.status).toBe(409);
        const conflictMode = await submitRestore(content, "replace", key);
        expect(conflictMode.status).toBe(409);
        expect(await prisma.sysRestoreJob.count()).toBe(rowsAfterFirst);
    });

    it("NOT_FOUND 查询语义：未知 key 返回 404 且文案说明非终态", async () => {
        const res = await app.inject({
            method: "GET",
            url: `/api/system/restore/jobs/key/${newKey()}`,
            headers: { authorization: `Bearer ${superToken}` },
        });
        expect(res.statusCode).toBe(404);
        expect(res.json().message).toContain("不代表终态");
    });

    /* ------------------------- replace ------------------------- */

    it("replace：api_idempotency 清空、token_version 抬升、旧 JWT 失效、重登录按原 key 可查", async () => {
        // 造幂等占位行（FK 指向 guojun）
        await prisma.apiIdempotency.create({
            data: {
                id: 900000000000001n,
                actorId: 1n,
                operationKey: "e2e:restore",
                idempotencyKey: "e2e-key-1",
                requestHash: Buffer.alloc(32),
                createdAt: new Date(),
                updatedAt: new Date(),
                expiresAt: new Date(Date.now() + 60_000),
            },
        });
        expect(await prisma.apiIdempotency.count()).toBeGreaterThan(0);

        const content = await downloadBackup(FULL_GROUPS, false);
        const key = newKey();
        const preReplaceToken = superToken;
        const result = await submitRestore(content, "replace", key);
        expect(result.status).toBe(202);

        // 轮询至终态：replace 抬升 token_version 后轮询 token 失效 → 重登录后凭原 key 继续
        let job: JobBody | null = null;
        const deadline = Date.now() + 60_000;
        for (;;) {
            const res = await app.inject({
                method: "GET",
                url: `/api/system/restore/jobs/key/${key}`,
                headers: { authorization: `Bearer ${superToken}` },
            });
            if (res.statusCode === 401) {
                superToken = await loginWithRetry("guojun", "123456");
                continue;
            }
            expect(res.statusCode).toBe(200);
            const body = res.json().data as JobBody;
            if (TERMINAL.includes(body.status)) {
                job = body;
                break;
            }
            if (Date.now() > deadline) {
                throw new Error(`replace 超时未到终态：${JSON.stringify(body)}`);
            }
            await new Promise(resolve => setTimeout(resolve, 150));
        }
        expect(job!.status).toBe("SUCCEEDED");
        expect(job!.report?.apiIdempotencyPurged ?? 0).toBeGreaterThanOrEqual(1);
        expect(await prisma.apiIdempotency.count()).toBe(0);
        expect(job!.report?.tokenVersionsRaised ?? 0).toBeGreaterThanOrEqual(1);

        // 旧 JWT 失效（token_version 已抬升）
        const stale = await app.inject({
            method: "GET",
            url: "/api/system/backup/catalog",
            headers: { authorization: `Bearer ${preReplaceToken}` },
        });
        expect(stale.statusCode).toBe(401);

        // 重登录后按原 key 查询 → 终态
        superToken = await login("guojun", "123456");
        const again = await queryJobByKey(key);
        expect(again.status).toBe(200);
        expect(again.data!.status).toBe("SUCCEEDED");

        // replace 后维护态必须已解除
        expect(maintenance.isActive()).toBe(false);
    });

    /* ------------------------- 维护态 ------------------------- */

    it("维护态：业务写/新任务 503，白名单放行，解除后恢复", async () => {
        maintenance.activate();
        try {
            const blocked = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { account: "guojun", password: "123456" },
            });
            expect(blocked.statusCode).toBe(503);

            const backup = await app.inject({
                method: "POST",
                url: "/api/system/backup/run",
                headers: { authorization: `Bearer ${superToken}` },
                payload: { groups: ["sequences"], gzip: false },
            });
            expect(backup.statusCode).toBe(503);

            const newTask = await submitRestore(Buffer.from("x"), "merge", newKey());
            expect(newTask.status).toBe(503);

            // 白名单：profile / jobs 查询 / catalog 放行
            const profile = await app.inject({
                method: "GET",
                url: "/api/auth/profile",
                headers: { authorization: `Bearer ${superToken}` },
            });
            expect(profile.statusCode).toBe(200);
            const catalog = await app.inject({
                method: "GET",
                url: "/api/system/backup/catalog",
                headers: { authorization: `Bearer ${superToken}` },
            });
            expect(catalog.statusCode).toBe(200);
            const jobs = await queryJobByKey("whatever-key");
            expect(jobs.status).toBe(404); // 路由放行（非 503），查无记录 404
            const live = await app.inject({ method: "GET", url: "/api/health/live" });
            expect(live.statusCode).toBe(200);

            // 业务读也拦（维护只读白名单外）
            const orders = await app.inject({
                method: "GET",
                url: "/api/orders",
                headers: { authorization: `Bearer ${superToken}` },
            });
            expect(orders.statusCode).toBe(503);
        } finally {
            maintenance.deactivate();
        }
        const recovered = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: "guojun", password: "123456" },
        });
        expect(recovered.statusCode).toBe(200);
    });

    /* ------------------------- gzip 恢复 ------------------------- */

    it("gzip 备份可直接 merge（解压路径）", async () => {
        const gz = await downloadBackup(FULL_GROUPS, true);
        const key = newKey();
        const result = await submitRestore(gz, "merge", key);
        expect(result.status).toBe(202);
        const job = await waitTerminal(key);
        expect(job.status).toBe("SUCCEEDED");
    });

    it("空表段与自引用表往返：material_group 父子行顺序在备份中保持", async () => {
        const content = await downloadBackup(FULL_GROUPS, false);
        const doc = parseBackupDoc(content);
        const section = doc.lines.findIndex(line => line === "-- table material_group");
        expect(section).toBeGreaterThan(-1);
        // 解析该段全部行，验证父 id 先于子引用出现
        const seen = new Set<string>();
        const columns: string[] = [];
        for (let i = section + 1; i < doc.lines.length; i += 1) {
            const line = doc.lines[i]!;
            if (line.startsWith("-- table ") || line.startsWith(CHECKSUM_PREFIX)) break;
            const parsed = parseInsertLine(line);
            if (columns.length === 0) columns.push(...parsed.columns);
            const idIndex = columns.indexOf("id");
            const parentIndex = columns.indexOf("parent_id");
            for (const row of parsed.rows) {
                const parent = row[parentIndex]!;
                if (parent.kind !== "null") {
                    const parentText = parent.kind === "int" ? BigInt(parent.text).toString() : null;
                    if (parentText !== null && !seen.has(parentText)) {
                        throw new Error(`自引用父行 ${parentText} 未先出现`);
                    }
                }
                seen.add(BigInt((row[idIndex] as { text: string }).text).toString());
            }
        }
    });

    async function tableCounts(): Promise<Record<string, number>> {
        const counts: Record<string, number> = {};
        for (const table of ["sys_user", "op_log", "sales_order_table", "biz_sequence", "sys_role"]) {
            const rows = await prisma.$queryRaw<Array<{ n: bigint }>>(
                // 表名来自固定白名单字面量数组，无注入面
                Prisma.sql`SELECT COUNT(*) AS n FROM \`${Prisma.raw(table)}\``,
            );
            counts[table] = Number(rows[0]?.n ?? 0);
        }
        return counts;
    }
});

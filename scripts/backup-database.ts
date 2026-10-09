/**
 * 生产数据库备份（涉及数据库变更的部署前应先执行；是否需要见 deploy.ts 说明）。
 *
 * 流程：
 *   1. 仅建立一次 ssh 连接（服务器对 ssh 连接频率有限制，多条命令须合并到单连接内），
 *      远端脚本一次完成：mysqldump（--single-transaction 一致性快照，stdout 走 gzip 流）
 *      与源库基准采集（对象清单 + 精确行数，分段写入 stderr，本地按标记切分）；
 *   2. 校验传输完整性：gzip 可完整解压 + mysqldump 尾注 "-- Dump completed" 存在；
 *   3. 生成同名 .meta.json（源库行数基准 + sha256），供日后离线核对；
 *   4. 校验可还原性与一致性：还原到本地 MySQL 临时校验库（用后即删），
 *      与源库基准逐一比对对象清单（表/视图）和精确行数（COUNT(*)）。
 *
 * 源库密码不落本地：mysql/mysqldump 均在容器内读取自身环境变量 MYSQL_ROOT_PASSWORD。
 * 服务器地址不入仓：DEPLOY_SSH_HOST 必填，写在仓库根 .env（模板见 .env.example）。
 * 行数基准与 dump 在同一次远端执行中采集；备份窗口内生产库若有写入，
 * 行数比对可能误报，重跑即可。
 *
 * 前置：本机可免密 ssh 登录 DEPLOY_SSH_HOST；本地 MySQL 可连（复用根 .env 的 DB_*，
 * 还原校验仅允许 localhost）；本机 PATH 有 mysql 客户端（还原校验用）。
 *
 * 用法：pnpm backup-database
 */
import { config } from "dotenv";
import { loadDbEnv } from "../apps/backend/src/configuration/raw-env.js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import mariadb from "mariadb";

// 路径以脚本位置锚定（仓库根 scripts/），任意 cwd 下执行均一致
const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");

// env 统一在仓库根 .env（与 dev/test 共用；备份目标变量见 .env.example 模板）
config({ path: join(repoRoot, ".env") });

// 服务器地址属敏感信息，不入仓：只从 .env 读取，缺失即失败（不设默认值兜底）
const SSH_HOST = process.env.DEPLOY_SSH_HOST;
if (!SSH_HOST) {
    throw new Error("缺少 DEPLOY_SSH_HOST（如 root@<服务器IP>）：请写入仓库根 .env（不入库），模板见 .env.example");
}
const DB_CONTAINER = process.env.DEPLOY_DB_CONTAINER ?? "zmsys-db-1";
const DB_NAME = process.env.DEPLOY_DB_NAME ?? "zmdb";
// 校验库固定名字（下方有护栏断言），绝不指向开发库/测试库
const VERIFY_DB = "zmdb_backup_verify";

// 远端脚本里的标识符仅允许白名单字符，杜绝注入面（DB_NAME/VERIFY_DB 无需再引号包裹）
for (const [label, value, pattern] of [
    ["DEPLOY_SSH_HOST", SSH_HOST, /^[A-Za-z0-9@._-]+$/],
    ["DEPLOY_DB_CONTAINER", DB_CONTAINER, /^[A-Za-z0-9_.-]+$/],
    ["DEPLOY_DB_NAME", DB_NAME, /^[A-Za-z0-9_]+$/],
] as const) {
    if (!pattern.test(value)) {
        throw new Error(`${label} 含非法字符：${value}`);
    }
}
if (!/^[A-Za-z0-9_]+$/.test(VERIFY_DB)) {
    throw new Error(`校验库名含非法字符：${VERIFY_DB}`);
}

const { host: VERIFY_HOST, port: VERIFY_PORT, user: VERIFY_USER, password: VERIFY_PASSWORD } = loadDbEnv();
if (!["localhost", "127.0.0.1"].includes(VERIFY_HOST)) {
    throw new Error(`还原校验仅允许 localhost，当前 DB_HOST=${VERIFY_HOST}`);
}

const backupsDir = join(repoRoot, "scripts", "backups");

/**
 * 远端命令一律以 `ssh <host> bash -s` 从 stdin 送入：
 * 绕开「本地 shell → ssh → docker exec sh -c」三层引号转义，脚本内容就是普通 bash。
 * stdout/stderr 均捕获，由调用方按段标记切分（连接频率受限，远端多任务须共用一次连接）。
 */
const ssh = (script: string, label: string): { stdout: Buffer; stderr: string } => {
    const res = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", SSH_HOST, "bash", "-s"], {
        // input 必须先转 Buffer：字符串 input 与 encoding:'buffer' 组合会抛 ERR_UNKNOWN_ENCODING
        input: Buffer.from(script, "utf8"),
        encoding: "buffer",
        maxBuffer: 512 * 1024 * 1024,
        timeout: 300000,
    });
    if (res.error) {
        throw new Error(`${label}：无法启动 ssh（${res.error.message}）`);
    }
    if (res.status !== 0) {
        throw new Error(`${label}：远端执行失败（exit=${res.status}）\n${res.stderr.toString()}`);
    }
    return { stdout: res.stdout, stderr: res.stderr.toString("utf8") };
};

const parseObjects = (output: string): Map<string, string> => {
    const objects = new Map<string, string>();
    for (const line of output.split("\n")) {
        // 跳过空行与 ssh 客户端等混入的非数据行
        if (!line.includes("\t")) continue;
        const [name, type] = line.trim().split("\t");
        if (!name || !type) {
            throw new Error(`无法解析对象行：${JSON.stringify(line)}`);
        }
        objects.set(name, type);
    }
    return objects;
};

const parseCounts = (output: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const line of output.split("\n")) {
        if (!line.includes("\t")) continue;
        const [name, count] = line.trim().split("\t");
        const value = Number.parseInt(count ?? "", 10);
        if (!name || !Number.isSafeInteger(value)) {
            throw new Error(`无法解析行数行：${JSON.stringify(line)}`);
        }
        counts.set(name, value);
    }
    return counts;
};

const objectsSql = (database: string): string =>
    `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema='${database}' ORDER BY table_name`;

const pad = (value: number): string => String(value).padStart(2, "0");

const main = async (): Promise<void> => {
    console.log(`[1/4] 单连接执行：${SSH_HOST} → 容器 ${DB_CONTAINER} → 数据库 ${DB_NAME}（导出 + 采集基准）`);

    // mysql 的密码警告等 stderr 就地丢弃，分段标记之间只剩纯净数据；2>/dev/null 不吞退出码
    const remoteScript = `set -euo pipefail
C=${DB_CONTAINER}

echo @@OBJECTS@@ >&2
docker exec $C sh -c "mysql -uroot -p\\"\\$MYSQL_ROOT_PASSWORD\\" -N -B -e \\"${objectsSql(DB_NAME)}\\"" >&2 2>/dev/null

echo @@COUNTS@@ >&2
tables=$(docker exec $C sh -c "mysql -uroot -p\\"\\$MYSQL_ROOT_PASSWORD\\" -N -B -e \\"SELECT table_name FROM information_schema.tables WHERE table_schema='${DB_NAME}' ORDER BY table_name\\"" 2>/dev/null)
counts_sql=""
sep=""
for t in $tables; do
  counts_sql="$counts_sql$sep SELECT '$t', COUNT(*) FROM ${DB_NAME}.$t"
  sep=" UNION ALL"
done
docker exec $C sh -c "mysql -uroot -p\\"\\$MYSQL_ROOT_PASSWORD\\" -N -B -e \\"$counts_sql\\"" >&2 2>/dev/null
echo @@DUMP@@ >&2

docker exec $C sh -c "mysqldump -uroot -p\\"\\$MYSQL_ROOT_PASSWORD\\" --single-transaction --routines --triggers --events --set-gtid-purged=OFF --default-character-set=utf8mb4 --hex-blob ${DB_NAME}" | gzip`;

    const { stdout: gzipBuffer, stderr } = ssh(remoteScript, "mysqldump 导出");

    if (gzipBuffer.length === 0 || gzipBuffer[0] !== 0x1f || gzipBuffer[1] !== 0x8b) {
        throw new Error("stdout 不是有效的 gzip 流（远端 dump 未执行或输出被污染）");
    }
    const sourceObjects = parseObjects(stderr.split("@@COUNTS@@")[0]?.split("@@OBJECTS@@")[1] ?? "");
    const sourceCounts = parseCounts(stderr.split("@@COUNTS@@")[1]?.split("@@DUMP@@")[0] ?? "");
    if (sourceObjects.size === 0) {
        throw new Error("源库基准采集为空，stderr 分段可能被污染，原始内容：\n" + stderr);
    }

    console.log("[2/4] 校验传输完整性");
    const sql = gunzipSync(gzipBuffer).toString("utf8");
    if (!sql.includes("-- Dump completed")) {
        throw new Error("dump 缺少 mysqldump 完成尾注，导出可能被中断，请重跑");
    }

    const now = new Date();
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    mkdirSync(backupsDir, { recursive: true });
    const dumpPath = join(backupsDir, `${DB_NAME}-${stamp}.sql.gz`);
    const metaPath = join(backupsDir, `${DB_NAME}-${stamp}.meta.json`);
    const sha256 = createHash("sha256").update(gzipBuffer).digest("hex");
    writeFileSync(dumpPath, gzipBuffer);
    writeFileSync(
        metaPath,
        `${JSON.stringify(
            {
                host: SSH_HOST,
                container: DB_CONTAINER,
                database: DB_NAME,
                dumpedAt: now.toISOString(),
                gzipBytes: gzipBuffer.length,
                sqlBytes: Buffer.byteLength(sql),
                sha256,
                objects: Object.fromEntries(sourceObjects),
                rowCounts: Object.fromEntries(sourceCounts),
            },
            null,
            4,
        )}\n`,
    );
    console.log(`      已写入 ${dumpPath}`);

    console.log(`[3/4] 还原到本地校验库 ${VERIFY_DB}`);
    // DEFINER 子句指向源库才有的 root@% 账号，本地不存在会还原失败；去掉后以当前用户身份创建
    const restoreSql = sql.replace(/\/\*!\d+ DEFINER=`[^`]*`@`[^`]*`( SQL SECURITY (?:DEFINER|INVOKER))?\s*\*\//g, "");

    const checkClient = spawnSync("mysql", ["--version"], { encoding: "utf8" });
    if (checkClient.status !== 0) {
        throw new Error("本机 PATH 中未找到 mysql 客户端，无法做还原校验");
    }

    const connection = await mariadb.createConnection({
        host: VERIFY_HOST,
        port: VERIFY_PORT,
        user: VERIFY_USER,
        password: VERIFY_PASSWORD,
    });
    try {
        // 校验库名为固定字面量（上方已断言），用完即删，不影响 zmdb / zmdb_test
        await connection.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
        await connection.query(`CREATE DATABASE ${VERIFY_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);

        const restore = spawnSync(
            "mysql",
            [
                "-h",
                VERIFY_HOST,
                "-P",
                String(VERIFY_PORT),
                "-u",
                VERIFY_USER,
                `-p${VERIFY_PASSWORD}`,
                "--default-character-set=utf8mb4",
                VERIFY_DB,
            ],
            { input: restoreSql, encoding: "utf8", timeout: 300000 },
        );
        if (restore.status !== 0) {
            throw new Error(`dump 还原失败（exit=${restore.status}）：\n${restore.stderr}`);
        }

        console.log("[4/4] 比对还原结果与源库基准");
        // rowsAsArray 按列序取值：驱动对 information_schema 返回的键名是服务器原始大小写，按键名取易踩坑
        const restoredRows = (await connection.query({
            sql: objectsSql(VERIFY_DB),
            rowsAsArray: true,
        })) as string[][];
        const restoredObjects = parseObjects(restoredRows.map(([name, type]) => `${name}\t${type}`).join("\n"));
        const restoredCounts = new Map<string, number>();
        for (const name of restoredObjects.keys()) {
            const rows = (await connection.query({
                sql: `SELECT COUNT(*) FROM ${VERIFY_DB}.${name}`,
                rowsAsArray: true,
            })) as unknown[][];
            restoredCounts.set(name, Number(rows[0][0]));
        }

        const problems: string[] = [];
        for (const [name, type] of sourceObjects) {
            if (!restoredObjects.has(name)) {
                problems.push(`对象缺失：${name}（${type}）`);
            } else if (restoredObjects.get(name) !== type) {
                problems.push(`对象类型不一致：${name} 源=${type} 还原=${restoredObjects.get(name)}`);
            }
        }
        for (const name of restoredObjects.keys()) {
            if (!sourceObjects.has(name)) {
                problems.push(`还原库多出对象：${name}`);
            }
        }
        for (const [name, count] of sourceCounts) {
            const restored = restoredCounts.get(name);
            if (restored !== count) {
                problems.push(`行数不一致：${name} 源=${count} 还原=${restored ?? "缺失"}`);
            }
        }

        const tableCount = [...sourceObjects.values()].filter(type => type === "BASE TABLE").length;
        const viewCount = sourceObjects.size - tableCount;
        const totalRows = [...sourceCounts.values()].reduce((sum, n) => sum + n, 0);
        const lines: string[] = [];
        for (const [name, type] of sourceObjects) {
            const mark = problems.some(problem => problem.includes(`：${name}`)) ? "✗" : "✓";
            lines.push(
                `      ${mark} ${name}（${type === "BASE TABLE" ? "表" : "视图"}）源=${sourceCounts.get(name) ?? "-"} 还原=${restoredCounts.get(name) ?? "-"}`,
            );
        }
        console.log(lines.join("\n"));

        if (problems.length > 0) {
            throw new Error(`校验未通过（${problems.length} 项）：\n${problems.join("\n")}`);
        }

        console.log(
            [
                "",
                "备份完成，校验全部通过：",
                `  对象 ${sourceObjects.size} 个（${tableCount} 表 + ${viewCount} 视图），行数合计 ${totalRows}，逐表一致`,
                `  gzip 完整 ✓  dump 尾注 ✓  本地还原 ✓  对象清单 ✓  行数 ✓`,
                `  文件：${dumpPath}`,
                `  大小：${(gzipBuffer.length / 1024).toFixed(1)} KB（gzip）/ ${(Buffer.byteLength(sql) / 1024).toFixed(1)} KB（sql）`,
                `  sha256：${sha256}`,
                `  基准：${metaPath}`,
            ].join("\n"),
        );
    } finally {
        await connection.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
        await connection.end();
    }
};

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

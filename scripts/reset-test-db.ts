/**
 * 重置 e2e 专用测试库：DROP → CREATE → 全量迁移 → seed。
 * 安全护栏：库名必须以 _test 结尾，且仅允许 localhost / CI service。
 */
import { config } from "dotenv";
import "../apps/backend/src/process-tz.js";
import { deriveTestDatabase, loadDbEnv } from "../apps/backend/src/configuration/raw-env.js";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mariadb from "mariadb";

// 路径以脚本位置锚定（仓库根 scripts/），任意 cwd 下执行均一致
const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
const backendDir = join(repoRoot, "apps", "backend");

// env 统一在仓库根 .env；包内 .env 兜底（容器/独立部署）
config({ path: [join(repoRoot, ".env"), join(backendDir, ".env")] });

// 固定命令字符串、无任何外部输入插值，execSync 无注入面；pnpm 需经 shell 解析（Windows .cmd）

// 测试库名由开发库名派生（加 _test 后缀）；已带后缀则尊重显式配置
const db = loadDbEnv();
const DB = deriveTestDatabase(db.database);
const HOST = db.host;

if (!DB.endsWith("_test")) {
    throw new Error(`拒绝重置非测试库：${DB}`);
}
if (!["localhost", "127.0.0.1"].includes(HOST)) {
    throw new Error(`测试库重置仅允许 localhost 或 CI service，当前 host=${HOST}`);
}

// prisma:deploy / prisma:seed 是 backend 包脚本，须固定在其 cwd 下执行
const run = (command: string): void => {
    execSync(command, { cwd: backendDir, stdio: "inherit", env: { ...process.env, DB_DATABASE: DB } });
};

const main = async (): Promise<void> => {
    const connection = await mariadb.createConnection({
        host: HOST,
        port: db.port,
        user: db.user,
        password: db.password,
    });
    // DB 名已通过 _test 断言，此处标识符拼接安全
    await connection.query(`DROP DATABASE IF EXISTS ${DB}`);
    await connection.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await connection.end();

    run("pnpm prisma:deploy");
    run("pnpm prisma:seed");
    console.log(`测试库 ${DB} 已重置（迁移 + seed 完成）`);
};

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

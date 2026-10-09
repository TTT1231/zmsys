/**
 * 生产部署（docker 部署文件统一在 scripts/deploy/ 管理）。
 *
 * 只管部署，不含数据库备份：需要先留底时单独跑 pnpm backup-database
 * （备份依赖 DEPLOY_DB_CONTAINER 指向在线容器，栈切换中途会失败，不得阻塞部署）。
 *
 * 服务器规格有限，构建全部在本地完成后上传，远端只做「装配式」构建
 * （依赖层命中 docker 缓存时秒级）。流程：
 *   1. 本地经 turbo 构建 frontend（vite）与 backend（nest，prebuild 自动 prisma
 *      generate）产物：输入（代码/依赖/根 .env）未变时复用本机构建缓存，产物与
 *      app-build-id 一并复用——版本检测只在内容真正变化时提示，不再因重复部署误报
 *   2. 组装 staging：workspace 骨架（manifest+lockfile）+ backend 运行件（dist/prisma）
 *      + frontend dist + scripts/deploy 配置（compose/Dockerfile/nginx）
 *   3. 连接①：上传解压到 DEPLOY_REMOTE_DIR，保障远端 .env（凭据沿用旧
 *      admin-manage 部署目录；DEPLOY_CORS_ORIGINS 缺失则由服务器地址派生并补写）
 *   4. 连接②：列出本次将应用的新迁移 → 一次性迁移（旧 admin-manage 栈在则停栈并把
 *      admin-manage_mysql-data 数据 cp -a 到 zmsys-mysql-data，旧卷保留可回滚）→
 *      docker compose build && up -d → 健康检查（/api/health/live）
 *
 * ssh 连接频率受限：全程仅 2 次连接（上传/执行各 1 次），间隔 10s；
 * 各步骤幂等，撞限流报错后稍等重跑 pnpm deploy:prod 即可续跑。
 *
 * 数据安全：MySQL 数据在 zmsys-mysql-data 卷，重建容器/镜像不影响；
 * 会清空数据的操作（down -v、volume rm/prune、改卷名）本脚本一律不执行。
 *
 * 前置：仓库根 .env 配好 DEPLOY_SSH_HOST（真实地址不入库）；
 * --stage-only 只做本地构建+组装（不连服务器，调试用）。
 *
 * 用法：pnpm deploy:prod [--stage-only]
 */
import { config } from "dotenv";
import { execSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 路径以脚本位置锚定（仓库根 scripts/deploy/），任意 cwd 下执行均一致
const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const deployDir = join(repoRoot, "scripts", "deploy");

config({ path: join(repoRoot, ".env") });

const SSH_HOST = process.env.DEPLOY_SSH_HOST;
if (!SSH_HOST) {
    throw new Error("缺少 DEPLOY_SSH_HOST（如 root@<服务器IP>）：请写入仓库根 .env（不入库），模板见 .env.example");
}
const REMOTE_DIR = process.env.DEPLOY_REMOTE_DIR ?? "/opt/zmsys/deploy";
const DB_NAME = process.env.DEPLOY_DB_NAME ?? "zmdb";
// CORS 白名单缺省由服务器地址派生（同域反代场景即 http://<服务器IP>）
const CORS_ORIGINS = process.env.DEPLOY_CORS_ORIGINS ?? `http://${SSH_HOST.split("@")[1] ?? ""}`;
const STAGE_ONLY = process.argv.includes("--stage-only");

// 远端命令里的标识符仅允许白名单字符，杜绝注入面
for (const [label, value, pattern] of [
    ["DEPLOY_SSH_HOST", SSH_HOST, /^[A-Za-z0-9@._-]+$/],
    ["DEPLOY_REMOTE_DIR", REMOTE_DIR, /^\/[A-Za-z0-9/._-]+$/],
    ["DEPLOY_DB_NAME", DB_NAME, /^[A-Za-z0-9_]+$/],
    ["DEPLOY_CORS_ORIGINS", CORS_ORIGINS, /^https?:\/\/[A-Za-z0-9._:-]+$/],
] as const) {
    if (!pattern.test(value)) {
        throw new Error(`${label} 含非法字符或格式不合法：${value}`);
    }
}

const stagingDir = join(deployDir, ".staging");
const tarPath = join(deployDir, ".staging.tar.gz");

/** 本地跑 pnpm 包脚本（Windows .cmd 需经 shell 解析，故用 execSync）；env 覆盖进程继承值 */
const run = (command: string, cwd: string, env: NodeJS.ProcessEnv = {}): void => {
    execSync(command, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
};

/** staging 布局 = compose 构建上下文：deploy 配置在根，workspace 骨架按仓库相对路径 */
const assembleStaging = (): void => {
    rmSync(stagingDir, { recursive: true, force: true });
    const copy = (from: string, to: string): void => {
        const target = join(stagingDir, to);
        mkdirSync(resolve(target, ".."), { recursive: true });
        cpSync(join(repoRoot, from), target, { recursive: true });
    };

    // deploy 配置（compose 上下文根）；per-Dockerfile 的 .dockerignore 让
    // frontend/backend 各自只传需要的 context（staging 互不进对方上下文）
    for (const file of [
        "docker-compose.yml",
        "Dockerfile.backend",
        "Dockerfile.backend.dockerignore",
        "Dockerfile.frontend",
        "Dockerfile.frontend.dockerignore",
        "nginx.conf",
    ]) {
        copy(join("scripts", "deploy", file), file);
    }

    // workspace 骨架：根三件套 + 全部子包 manifest（--frozen-lockfile 的 importer 校验要求）
    copy("package.json", "package.json");
    copy("pnpm-lock.yaml", "pnpm-lock.yaml");
    copy("pnpm-workspace.yaml", "pnpm-workspace.yaml");
    copy(join("packages", "request", "package.json"), join("packages", "request", "package.json"));
    copy(join("packages", "utils", "package.json"), join("packages", "utils", "package.json"));
    copy(join("internal", "tsconfig", "package.json"), join("internal", "tsconfig", "package.json"));
    copy(join("apps", "frontend", "package.json"), join("apps", "frontend", "package.json"));

    // backend 运行件：manifest + prisma 配置/schema/迁移 + 编译产物（dist/generated 内含 prisma client）
    copy(join("apps", "backend", "package.json"), join("apps", "backend", "package.json"));
    copy(join("apps", "backend", "prisma7.config.ts"), join("apps", "backend", "prisma7.config.ts"));
    // prisma7.config.ts import 的零依赖 env 解析模块：postinstall 的 prisma generate
    // 经 Prisma CLI loader 加载 config，容器内必须随行（src 其余部分不进运行镜像）
    copy(
        join("apps", "backend", "src", "configuration", "raw-env.ts"),
        join("apps", "backend", "src", "configuration", "raw-env.ts"),
    );
    copy(join("apps", "backend", "prisma"), join("apps", "backend", "prisma"));
    copy(join("apps", "backend", "dist"), join("apps", "backend", "dist"));

    // frontend 静态产物
    copy(join("apps", "frontend", "dist"), join("apps", "frontend", "dist"));
};

/** 远端已应用迁移名清单（用于提示本次将应用的新迁移） */
const localMigrations = (): string[] =>
    readdirSync(join(repoRoot, "apps", "backend", "prisma", "migrations"), { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();

/** 前端产物自检：必须是 production 构建。曾因根 .env 的 NODE_ENV=development 污染
    vite build（envDir 指向仓库根），DEV 守卫把更新检查等逻辑整段死代码消除、
    bundle 含 jsxDEV 与源码绝对路径；build-id 缺失说明注入插件未生效 */
const assertFrontendProdBuild = (): void => {
    const distDir = join(repoRoot, "apps", "frontend", "dist");
    const indexHtml = readFileSync(join(distDir, "index.html"), "utf8");
    if (!/<meta name="app-build-id" content="[^"]+"/.test(indexHtml)) {
        throw new Error("dist/index.html 缺少 app-build-id 构建标识（inject-app-build-id 插件未生效），已中止部署");
    }
    for (const file of readdirSync(join(distDir, "assets"))) {
        if (!file.endsWith(".js")) continue;
        if (readFileSync(join(distDir, "assets", file), "utf8").includes("jsxDEV")) {
            throw new Error(
                `dist/assets/${file} 含 jsxDEV：前端以 development 模式构建（检查根 .env 的 NODE_ENV），已中止部署`,
            );
        }
    }
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
    console.log("[1/4] 本地构建 frontend + backend 产物");
    // turbo 自带拓扑与缓存：未变的包直接复用本机缓存产物（含 app-build-id）。
    // 显式按 production 构建：根 .env 的 NODE_ENV=development（本机开发约定）会经
    // 进程继承与 envDir 双路污染 vite（jsxDEV 注入），须在此覆盖
    run("pnpm exec turbo run build", repoRoot, { NODE_ENV: "production" });
    assertFrontendProdBuild();

    console.log("[2/4] 组装 staging（workspace 骨架 + 产物 + deploy 配置）");
    assembleStaging();
    rmSync(tarPath, { force: true });
    // tar 参数一律相对路径（cwd=deployDir）：MSYS tar 会把 C: 盘符路径误解析为远程主机
    const tar = spawnSync("tar", ["-czf", ".staging.tar.gz", "-C", ".staging", "."], {
        cwd: deployDir,
        encoding: "utf8",
    });
    if (tar.status !== 0) {
        throw new Error(`tar 打包失败（exit=${tar.status}）：${tar.stderr}`);
    }
    const tarBuffer = readFileSync(tarPath);
    const expectedMigrations = localMigrations();
    console.log(
        `      打包完成：${(tarBuffer.length / 1024).toFixed(1)} KB，待应用迁移基线 ${expectedMigrations.length} 个`,
    );

    if (STAGE_ONLY) {
        console.log(`--stage-only：不连服务器。staging 已就绪：${stagingDir}`);
        return;
    }

    console.log(`[3/4] 上传并解压到 ${SSH_HOST}:${REMOTE_DIR}`);
    // 远端命令为固定字符串（值均经白名单校验），不经本地 shell；stdin 留给 tar 流
    const uploadCommand = `set -e
mkdir -p ${REMOTE_DIR}
if [ ! -f ${REMOTE_DIR}/.env ] && [ -f /opt/zmsys/admin-manage/.env ]; then cp /opt/zmsys/admin-manage/.env ${REMOTE_DIR}/.env; fi
if [ ! -f ${REMOTE_DIR}/.env ]; then echo "缺少 ${REMOTE_DIR}/.env（ZM_DB_ROOT_PASSWORD/ZM_DB_PASSWORD/JWT_SECRET）且旧目录无可继承" >&2; exit 1; fi
grep -q '^DEPLOY_CORS_ORIGINS=' ${REMOTE_DIR}/.env || echo 'DEPLOY_CORS_ORIGINS=${CORS_ORIGINS}' >> ${REMOTE_DIR}/.env
# 库名单源：compose 的 DB_DATABASE/MYSQL_DATABASE 读本文件，与本地迁移检测必须同源；
# 已存在但与本地不一致（改库名是大事）直接报错，宁 fail 不静默分叉
if grep -q '^DEPLOY_DB_NAME=' ${REMOTE_DIR}/.env; then
  REMOTE_DB=$(grep '^DEPLOY_DB_NAME=' ${REMOTE_DIR}/.env | tail -n 1 | cut -d= -f2)
  if [ "$REMOTE_DB" != '${DB_NAME}' ]; then
    echo "远端 .env 的 DEPLOY_DB_NAME=$REMOTE_DB 与本地 ${DB_NAME} 不一致，改库名须人工介入（既有数据卷不随变量改名）" >&2
    exit 1
  fi
else
  echo 'DEPLOY_DB_NAME=${DB_NAME}' >> ${REMOTE_DIR}/.env
fi
tar -xzf - -C ${REMOTE_DIR} && echo UPLOAD_OK`;
    const upload = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", SSH_HOST, uploadCommand], {
        input: tarBuffer,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 300000,
    });
    if (upload.status !== 0 || !upload.stdout.includes("UPLOAD_OK")) {
        throw new Error(`上传失败（exit=${upload.status}）：${upload.stderr || upload.stdout}`);
    }
    console.log("      上传完成");

    console.log("      等待 10s（规避 ssh 连接频率限制）...");
    await sleep(10000);

    console.log("[4/4] 远端执行：迁移检测 → 装配构建 → 起栈 → 健康检查");
    // 经 stdin 送入（bash -s），绕开三层引号转义；构建/起栈输出直出终端
    const remoteScript = `set -euo pipefail
cd ${REMOTE_DIR}

# 将应用的新迁移提示（停栈前查询；栈未运行则跳过，migrate deploy 自身也会输出）
DBC=$(docker ps --format '{{.Names}}' | grep -E '^(admin-manage|zmsys)-db-1$' | head -n 1 || true)
if [ -n "$DBC" ]; then
  APPLIED=$(docker exec "$DBC" sh -c "mysql -uroot -p\\"\\$MYSQL_ROOT_PASSWORD\\" -N -B -e \\"SELECT migration_name FROM ${DB_NAME}._prisma_migrations\\"" 2>/dev/null | sort || true)
  for m in ${expectedMigrations.join(" ")}; do
    echo "$APPLIED" | grep -qx "$m" || echo "本次将应用迁移：$m"
  done
fi

# 一次性切换：旧 admin-manage 栈在则停栈（不带 -v，旧卷保留）并整卷拷贝数据
if [ -n "$(docker compose -p admin-manage ps -q 2>/dev/null)" ]; then
  echo "检测到旧 admin-manage 栈，执行一次性切换（停栈 + 数据卷拷贝，旧卷保留可回滚）"
  docker compose -p admin-manage down
  docker volume create zmsys-mysql-data >/dev/null
  docker run --rm -v admin-manage_mysql-data:/from:ro -v zmsys-mysql-data:/to mysql:8.0 sh -c "cp -a /from/. /to/"
  echo "数据卷已拷贝：admin-manage_mysql-data → zmsys-mysql-data"
fi

docker compose build
docker compose up -d

echo "等待健康检查（backend 需先等 db healthy 并跑完迁移）..."
ok=0
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1/api/health/live >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ "$ok" = "1" ]; then
  echo "部署完成：/api/health/live OK"
else
  echo "健康检查失败，backend 最近日志：" >&2
  docker compose logs --tail=80 backend >&2 || true
  exit 1
fi`;
    const execute = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", SSH_HOST, "bash", "-s"], {
        input: Buffer.from(remoteScript, "utf8"),
        stdio: ["pipe", "inherit", "inherit"],
        // 首次依赖层缓存未命中时，大包下载可能超过 10 分钟；留足时间完成构建与健康检查。
        timeout: 3600000,
    });
    if (execute.status !== 0) {
        throw new Error(`远端执行失败（exit=${execute.status}），可稍等后重跑 pnpm deploy:prod 续跑（各步骤幂等）`);
    }

    const sha256 = createHash("sha256").update(tarBuffer).digest("hex");
    console.log(
        [
            "",
            "部署完成：",
            `  栈：zmsys（frontend/backend/db），数据卷 zmsys-mysql-data`,
            `  上传包 sha256：${sha256}`,
            `  提示：切换成功后，请把根 .env 的 DEPLOY_DB_CONTAINER 更新为 zmsys-db-1（backup-database 用）`,
        ].join("\n"),
    );
};

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

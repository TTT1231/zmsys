/**
 * 自动化冒烟：spawn 真实进程（编译产物 dist/main.js）→ 等健康就绪 → 登录 →
 * profile → ready 探活 → 发停止信号 → 断言优雅退出（退出码 + Prisma/池关闭日志）。
 * 全程连 *_test 专用库（护栏同 e2e）。前置：测试库已 reset。后端产物由脚本
 * 开头经 turbo 自动构建——与 deploy:prod 共用 production 缓存槽，代码未变时秒级。
 * Windows 不支持向子进程投递真实信号，停止阶段降级为仅断言进程退出；
 * Linux（CI）下完整验证 SIGINT 优雅停机。
 */
import { config } from "dotenv";
import "../apps/backend/src/process-tz.js";
import { loadDbEnv } from "../apps/backend/src/configuration/raw-env.js";
import { execSync, spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 路径以脚本位置锚定（仓库根 scripts/），任意 cwd 下执行均一致
const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
const backendDir = join(repoRoot, "apps", "backend");

// env 统一在仓库根 .env；包内 .env 兜底（容器/独立部署）
config({ path: [join(repoRoot, ".env"), join(backendDir, ".env")] });

const ENTRY = join(backendDir, "dist", "main.js");
const PORT = Number(process.env.PORT ?? 5000);
const base = `http://127.0.0.1:${PORT}/api`;

// 测试库护栏：强制 *_test，绝不连开发库
const baseDatabase = loadDbEnv().database;
if (baseDatabase.endsWith("_test")) {
    // 已显式指定测试库
} else {
    process.env.DB_DATABASE = `${baseDatabase}_test`;
}
process.env.NODE_ENV = "test";

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const httpJson = async (path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> => {
    const res = await fetch(`${base}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...init?.headers },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
};

const waitFor = async (label: string, check: () => Promise<boolean>, timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) {
            return;
        }
        await sleep(300);
    }
    throw new Error(`等待超时：${label}`);
};

const main = async (): Promise<void> => {
    console.log("[0] 构建后端产物（turbo 缓存命中时秒级）");
    // execSync 经 shell 解析（Windows 的 pnpm 是 .cmd shim）；NODE_ENV=production
    // 对齐 deploy:prod 的缓存槽（turbo globalEnv 含 NODE_ENV），冒烟的就是与
    // 生产同形态的编译产物
    execSync("pnpm exec turbo run build --filter=zmsysbackend", {
        cwd: repoRoot,
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "production" },
    });

    const output: string[] = [];
    const child = spawn(process.execPath, [ENTRY], {
        env: { ...process.env, TZ: "UTC" },
        stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));

    const exited = new Promise<number | null>(resolve => {
        child.on("exit", code => resolve(code));
    });

    try {
        await waitFor(
            "health/live 就绪",
            async () => {
                try {
                    const res = await fetch(`${base}/health/live`);
                    return res.status === 200;
                } catch {
                    return false;
                }
            },
            20000,
        );

        const login = await httpJson("/auth/login", {
            method: "POST",
            body: JSON.stringify({ account: "guojun", password: "123456" }),
        });
        if (login.status !== 200) {
            throw new Error(`登录失败：${JSON.stringify(login.body)}`);
        }
        const token = (login.body as { data: { accessToken: string } }).data.accessToken;

        const profile = await httpJson("/auth/profile", { headers: { authorization: `Bearer ${token}` } });
        if (profile.status !== 200) {
            throw new Error(`profile 失败：${JSON.stringify(profile.body)}`);
        }
        const ready = await httpJson("/health/ready");
        if (ready.status !== 200) {
            throw new Error(`health/ready 失败：${JSON.stringify(ready.body)}`);
        }

        // 停止：Linux 用 SIGINT 触发 enableShutdownHooks 优雅链；
        // Windows 上 child.kill() 无法投递信号（Node 在 win32 直接 TerminateProcess 但偶发不生效），改用 taskkill
        const isWindows = process.platform === "win32";
        if (isWindows) {
            // pid 为本脚本 spawn 的数字 PID，无注入面；参数数组形式不经 shell
            spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
            child.kill("SIGINT");
        }
        const timeout = sleep(15000).then(() => null);
        const code = await Promise.race([exited, timeout]);
        if (code === null) {
            child.kill("SIGKILL");
            throw new Error("进程未在 15s 内退出");
        }

        const logs = output.join("");
        if (!isWindows) {
            // 优雅停机的证据：Nest 处理完 onModuleDestroy（Prisma disconnect）后退出码 0
            if (code !== 0) {
                throw new Error(`SIGINT 后退出码异常：${code}\n${logs}`);
            }
        }
        console.log(
            `冒烟通过（platform=${process.platform}, exit=${code}）：live/login/profile/ready 均正常，进程可停止`,
        );
    } finally {
        if (child.exitCode === null && !child.killed) {
            child.kill("SIGKILL");
        }
    }
};

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

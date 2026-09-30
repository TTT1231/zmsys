/* 进程栈管理：后端（编译产物）+ 静态反代服务 + 系统 Chrome（playwright-core）。
 * 全部由 harness 进程内 spawn → 健康检查 → finally 彻底清理（Windows taskkill /T /F 杀进程树，
 * 含孤儿），并做端口残留校验。 */
import { spawn } from "node:child_process";
import net from "node:net";
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, "..", "..");
export const BACKEND_ENTRY = path.join(REPO, "apps", "backend", "dist", "main.js");
export const FRONTEND_DIST = path.join(REPO, "apps", "frontend", "dist");
export const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function killTree(pid) {
    if (!pid) return;
    try {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
        /* 进程可能已退出 */
    }
}
// Windows 上 node 的 child.kill() 只杀主进程，taskkill /T /F 才能连子进程树一起回收
import { spawnSync } from "node:child_process";

export function isPortOpen(port, host = "127.0.0.1") {
    return new Promise(resolve => {
        const socket = net.connect({ port, host });
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", () => resolve(false));
        const t = setTimeout(() => {
            socket.destroy();
            resolve(false);
        }, 1500);
        socket.once("close", () => clearTimeout(t));
    });
}

async function waitHttpOk(url, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = "";
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url);
            if (res.ok) return true;
            lastErr = `HTTP ${res.status}`;
        } catch (err) {
            lastErr = err.message;
        }
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`${label} 健康检查超时（${timeoutMs}ms）：${lastErr}`);
}

class Proc {
    constructor(name, child, log = []) {
        this.name = name;
        this.child = child;
        this.log = log;
    }
    get pid() {
        return this.child?.pid;
    }
    kill() {
        if (!this.child || this.child.exitCode !== null) return;
        killTree(this.child.pid);
        try {
            this.child.kill();
        } catch {
            /* 已退出 */
        }
    }
}

export class Stack {
    constructor() {
        this.backend = null;
        this.static = null;
        this.browser = null;
        this.staticPort = 0;
        this.logs = { backend: [], static: [] };
    }

    /** 启动后端（DB_DATABASE=zmdb_test，cwd=仓库根以读 .env） */
    async startBackend() {
        if (await isPortOpen(5000)) {
            throw new Error("端口 5000 已被占用：疑似其它后端实例在跑。为避免误连（尤其生产库），拒绝启动。");
        }
        const child = spawn(process.execPath, [BACKEND_ENTRY], {
            cwd: REPO,
            env: { ...process.env, DB_DATABASE: "zmdb_test" },
            stdio: ["ignore", "pipe", "pipe"],
        });
        this.backend = new Proc("backend", child, this.logs.backend);
        child.stdout.on("data", d => this.logs.backend.push(d.toString()));
        child.stderr.on("data", d => this.logs.backend.push(d.toString()));
        child.on("exit", (code, signal) => {
            this.logs.backend.push(`[exit code=${code} signal=${signal}]`);
        });
        await waitHttpOk("http://127.0.0.1:5000/api/health/ready", 90_000, "backend");
        return this.backend;
    }

    /** 启动静态 + /api 反代服务（随机端口，从 stdout 解析） */
    async startStatic() {
        const child = spawn(
            process.execPath,
            [path.join(here, "server.mjs"), "--port", "0", "--root", FRONTEND_DIST, "--api", "http://127.0.0.1:5000"],
            {
                cwd: here,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );
        this.static = new Proc("static", child, this.logs.static);
        child.stdout.on("data", d => this.logs.static.push(d.toString()));
        child.stderr.on("data", d => this.logs.static.push(d.toString()));
        const port = await new Promise((resolve, reject) => {
            const deadline = setTimeout(() => reject(new Error("静态服务启动超时")), 20_000);
            const onData = chunk => {
                const m = chunk.toString().match(/ready on http:\/\/127\.0\.0\.1:(\d+)/);
                if (m) {
                    clearTimeout(deadline);
                    resolve(Number(m[1]));
                }
            };
            child.stdout.on("data", onData);
            child.on("exit", code => reject(new Error(`静态服务提前退出 code=${code}`)));
        });
        this.staticPort = port;
        await waitHttpOk(`http://127.0.0.1:${port}/`, 10_000, "static");
        return this.static;
    }

    get baseUrl() {
        return `http://127.0.0.1:${this.staticPort}`;
    }

    /** 启动系统 Chrome（有头，独立临时 profile，不触碰用户浏览器实例） */
    async startBrowser() {
        this.browser = await chromium.launch({
            executablePath: CHROME_PATH,
            headless: false,
            args: [
                "--window-size=1320,900",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
            ],
        });
        return this.browser;
    }

    /** 清理一切（含孤儿进程树），返回清理报告 */
    async cleanup() {
        const report = { killed: [], leftovers: [] };
        try {
            if (this.browser) {
                try {
                    await this.browser.close();
                    report.killed.push("chrome(closed)");
                } catch (err) {
                    report.leftovers.push(`browser.close: ${err.message}`);
                }
                this.browser = null;
            }
            for (const proc of [this.static, this.backend]) {
                if (proc) {
                    const pid = proc.pid;
                    proc.kill();
                    report.killed.push(`${proc.name}(pid=${pid})`);
                }
            }
            this.static = null;
            this.backend = null;
            // 收敛确认：后端与静态端口应释放
            await new Promise(r => setTimeout(r, 1500));
            if (await isPortOpen(5000)) report.leftovers.push("端口 5000 仍有监听（后端残留）");
            if (this.staticPort && (await isPortOpen(this.staticPort)))
                report.leftovers.push(`端口 ${this.staticPort} 仍有监听（静态服务残留）`);
        } catch (err) {
            report.leftovers.push(`cleanup error: ${err.message}`);
        }
        return report;
    }
}

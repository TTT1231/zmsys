/**
 * 应用级备份 CLI 外壳（db-scheme.md §10.5）：与网页「备份」同一引擎、同一格式
 * （zmsys-backup v1，仅数据不含 DDL），产物可直接经网页「恢复」或
 * pnpm restore-database 恢复。运维级 mysqldump 全量备份见 backup-database。
 *
 * 用法：
 *   pnpm backup-app [--local] [--groups users,orders] [--out <目录>] [--no-gzip]
 *   # 默认远程（生产库）；--local 仅允许 localhost（开发库）
 *
 * 远程 = 一次 SSH → 现有 backend 镜像的临时命令容器（与运行中的 backend 并存，
 * 备份为只读一致性快照，不要求停写、不停服务）：
 *   docker compose run --rm -T --no-deps backend node dist/system/backup-cli.js ...
 * 先 --print-target 比对目标库名（防备错库）再执行；stdout 纯备份字节直接落盘，
 * 状态/结果由薄入口走 stderr。失败（含传输中断）删除半成品文件。
 * 只读操作，不设交互确认；文件名由引擎口径生成（全量 full / 单组组名 / partial-N）。
 */
import { config } from "dotenv";
import "../apps/backend/src/process-tz.js";
import { loadDbEnv } from "../apps/backend/src/configuration/raw-env.js";
import { backupFileName } from "../apps/backend/src/system/engine/backup-writer.js";
import { ALL_GROUP_KEYS } from "../apps/backend/src/system/backup.catalog.js";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { pipeline } from "node:stream/promises";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
config({ path: join(repoRoot, ".env") });

const ARGS = process.argv.slice(2);
const argValue = (name: string): string | undefined => {
    const index = ARGS.indexOf(`--${name}`);
    if (index === -1) return undefined;
    const value = ARGS[index + 1];
    if (value === undefined || value.startsWith("--")) {
        throw new Error(`--${name} 缺少参数值：--${name} 后须紧跟值（当前其后是 ${value ?? "参数末尾"}）`);
    }
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

/** stdout 接管为数据通道的子进程（本地薄入口 / SSH 远程命令），流式落盘 */
const drainToFile = async (
    child: {
        stdout: NodeJS.ReadableStream | null;
        on(event: string, listener: (...args: never[]) => void): void;
    },
    outPath: string,
): Promise<number | null> => {
    const exited = new Promise<number | null>(resolve => child.on("exit", code => resolve(code)));
    // stdout 中断（远端出错断流）也要等子进程自身退出，以退出码为准
    await pipeline(child.stdout!, createWriteStream(outPath)).catch(() => undefined);
    return exited;
};

const main = async (): Promise<void> => {
    const isLocal = hasFlag("local");
    const gzip = !hasFlag("no-gzip");
    const groups = parseGroups();
    const outDir = argValue("out") ?? join(repoRoot, "scripts", "backups");

    const database = isLocal ? loadDbEnv().database : (process.env.DEPLOY_DB_NAME ?? "zmdb");
    const fileName = backupFileName(database, groups, gzip);
    const outPath = join(resolve(outDir), fileName);
    if (existsSync(outPath)) {
        throw new Error(`输出文件已存在，拒绝覆盖：${outPath}`);
    }
    await mkdir(resolve(outDir), { recursive: true });
    console.log(`目标：${isLocal ? "本地" : "远程"} · 库：${database} · 分组：${groups.join(",")} · 输出：${outPath}`);

    const cliArgs = [`--groups`, groups.join(",")];
    if (!gzip) {
        cliArgs.push("--no-gzip");
    }

    try {
        const code = isLocal ? await runLocal(cliArgs, outPath) : await runRemote(cliArgs, outPath);
        if (code === 4) {
            throw new Error("远端实际目标库与本地确认值不一致，已拒绝执行");
        }
        if (code !== 0) {
            throw new Error(`备份失败（exit=${code}），半成品已清理`);
        }
    } catch (error) {
        await unlink(outPath).catch(() => undefined);
        throw error;
    }
    console.log(`备份完成：${outPath}（zmsys-backup v1，可用网页「恢复」或 pnpm restore-database 恢复）`);
};

/** 本地薄入口子进程（tsx，与容器同一入口；stdout 直连输出文件） */
const runLocal = async (cliArgs: string[], outPath: string): Promise<number | null> => {
    const { host } = loadDbEnv();
    if (!["localhost", "127.0.0.1"].includes(host)) {
        throw new Error(`--local 仅允许 localhost，当前 DB_HOST=${host}（远程库请走默认远程模式）`);
    }
    const entry = join(repoRoot, "apps", "backend", "src", "system", "backup-cli.ts");
    const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const child = spawn(process.execPath, [tsxCli, entry, ...cliArgs], {
        stdio: ["ignore", "pipe", "inherit"],
        env: process.env,
    });
    return drainToFile(child, outPath);
};

/**
 * 远程入口：单次 SSH 完成「目标库校验 + 容器备份」，stdout 流式直连输出文件。
 * 命令作为 argv 传递；groups 已按白名单（目录 key，[a-z_] 字符集）校验后拼接。
 */
const runRemote = async (cliArgs: string[], outPath: string): Promise<number | null> => {
    const SSH_HOST = process.env.DEPLOY_SSH_HOST;
    if (!SSH_HOST) {
        throw new Error("缺少 DEPLOY_SSH_HOST（写入仓库根 .env，不入库；模板见 .env.example）");
    }
    const REMOTE_DIR = process.env.DEPLOY_REMOTE_DIR ?? "/opt/zmsys/deploy";
    const EXPECTED_DB = process.env.DEPLOY_DB_NAME ?? "zmdb";
    for (const [label, value, pattern] of [
        ["DEPLOY_SSH_HOST", SSH_HOST, /^[A-Za-z0-9@._-]+$/],
        ["DEPLOY_REMOTE_DIR", REMOTE_DIR, /^[A-Za-z0-9/._-]+$/],
        ["DEPLOY_DB_NAME", EXPECTED_DB, /^[A-Za-z0-9_]+$/],
    ] as const) {
        if (!pattern.test(value)) {
            throw new Error(`${label} 含非法字符：${value}`);
        }
    }
    const quotedArgs = cliArgs.map(value => `'${value}'`).join(" ");
    const remoteCommand = `set -euo pipefail
cd ${REMOTE_DIR}
TARGET=$(docker compose run --rm -T --no-deps backend node dist/system/backup-cli.js --print-target ${quotedArgs} | tail -n 1)
echo "远端目标库：$TARGET" >&2
echo "$TARGET" | grep -q '"database":"${EXPECTED_DB}"' || { echo "TARGET_MISMATCH（与本地确认值不符）" >&2; exit 4; }
docker compose run --rm -T --no-deps backend node dist/system/backup-cli.js ${quotedArgs}
`;
    const child = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", SSH_HOST, remoteCommand], {
        stdio: ["ignore", "pipe", "inherit"],
    });
    return drainToFile(child, outPath);
};

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});

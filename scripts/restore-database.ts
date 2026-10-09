/**
 * 恢复 CLI 外壳（db-scheme.md §10.5）。
 *
 * 用法：
 *   pnpm restore-database --local [--replace] [--yes] [--request-key <key>] <备份文件>
 *   pnpm restore-database [--replace] [--yes] [--request-key <key>] <备份文件>   # 默认远程
 *   pnpm restore-database --reset-password <account> [--local|远程]
 *
 * 停写前提（不绕过）：远程模式先检查 backend 已停（--no-deps 不会启动 db）；本地模式
 * 要求 DB_HOST 为 localhost 且确认本地无运行中的 backend。--yes 只跳确认。
 *
 * 远程 = 一次 SSH → 现有 backend 镜像的临时命令容器
 *   docker compose run --rm -T --no-deps backend node dist/system/restore-cli.js ...
 * stdin 专用于备份字节（或救援新密码单行），远程入口非交互；目标库不一致即拒绝。
 * 文件是数据不作为脚本执行；参数白名单校验后拼接。
 */
import { config } from "dotenv";
import "../apps/backend/src/process-tz.js";
import { loadDbEnv } from "../apps/backend/src/configuration/raw-env.js";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
config({ path: join(repoRoot, ".env") });

const ARGS = process.argv.slice(2);
/** 带值选项白名单：其后紧随的位置参数是选项值而非文件名 */
const VALUE_OPTIONS = new Set(["--request-key", "--reset-password"]);
const argValue = (name: string): string | undefined => {
    const index = ARGS.indexOf(`--${name}`);
    if (index === -1) return undefined;
    const value = ARGS[index + 1];
    if (value === undefined || value.startsWith("--")) return undefined;
    return value;
};
const hasFlag = (name: string): boolean => ARGS.includes(`--${name}`);
const positionalFile = ARGS.find((arg, index) => {
    if (arg.startsWith("--")) return false;
    const previous = ARGS[index - 1];
    return previous === undefined || !VALUE_OPTIONS.has(previous);
});

const ask = (question: string): Promise<string> =>
    new Promise(resolveAnswer => {
        const readline = createInterface({ input: process.stdin, output: process.stdout });
        readline.question(question, answer => {
            readline.close();
            resolveAnswer(answer.trim());
        });
    });

/** 隐藏输入（TTY）：逐字符读取并回显 *；非 TTY 退化为单行直读 */
const askHidden = (question: string): Promise<string> =>
    new Promise(resolveAnswer => {
        const input = process.stdin;
        if (!input.isTTY) {
            const readline = createInterface({ input });
            readline.once("line", line => {
                readline.close();
                resolveAnswer(line);
            });
            process.stderr.write(`${question}（stdin 非 TTY，输入将以单行传入）\n`);
            return;
        }
        process.stderr.write(question);
        input.setRawMode(true);
        input.setEncoding("utf8");
        input.resume();
        let answer = "";
        const onData = (chunk: string): void => {
            if (chunk === "\r" || chunk === "\n") {
                input.setRawMode(false);
                input.pause();
                input.removeListener("data", onData);
                process.stderr.write("\n");
                resolveAnswer(answer);
                return;
            }
            if (chunk === "\u0003") {
                process.stderr.write("\n已取消\n");
                process.exit(130);
            }
            if (chunk === "\u007f") {
                answer = answer.slice(0, -1);
                process.stderr.write("\b \b");
                return;
            }
            answer += chunk;
            process.stderr.write("*");
        };
        input.on("data", onData);
    });

const main = async (): Promise<void> => {
    const isLocal = hasFlag("local");
    const mode = hasFlag("replace") ? "replace" : "merge";
    const requestKey = argValue("request-key") ?? `cli-${randomUUID().slice(0, 26)}`;
    const resetPassword = argValue("reset-password");
    const yes = hasFlag("yes");
    const filePath = positionalFile;

    if (resetPassword !== undefined) {
        if (!/^[A-Za-z0-9_]{3,64}$/.test(resetPassword)) {
            throw new Error("账号为 3–64 位字母、数字或下划线");
        }
        if (isLocal) {
            await runLocalRescuePassword(resetPassword);
            return;
        }
        await runRemoteEntry({ type: "reset-password", account: resetPassword }, yes);
        return;
    }

    if (!filePath) {
        throw new Error("缺少备份文件参数：pnpm restore-database [--local] [--replace] <备份文件>");
    }
    if (!existsSync(filePath)) {
        throw new Error(`备份文件不存在：${filePath}`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/.test(requestKey)) {
        throw new Error("--request-key 须为 8-64 位：字母或数字开头，后续为字母数字与 . _ -");
    }
    console.log(`目标：${isLocal ? "本地" : "远程"} · 模式：${mode} · requestKey：${requestKey} · 文件：${filePath}`);
    // 远程模式的确认（含目标库校验信息）在 runRemoteEntry 内完成，避免双重询问
    if (isLocal && !yes) {
        const answer = await ask(`确认：已停止本地 backend 等写入进程，将对本地库执行 ${mode} 恢复？(输入 yes 继续) `);
        if (answer !== "yes") {
            console.log("已取消");
            return;
        }
    }

    if (isLocal) {
        await runLocalRestore(filePath, mode, requestKey);
    } else {
        await runRemoteEntry({ type: "restore", filePath, mode, requestKey }, yes);
    }
};

/** 与容器同一薄入口的本地子进程（tsx，stdin 供备份字节/救援密码） */
const runLocalEntry = async (args: string[], stdin: NodeJS.ReadableStream): Promise<number> => {
    const entry = join(repoRoot, "apps", "backend", "src", "system", "restore-cli.ts");
    const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const child = spawn(process.execPath, [tsxCli, entry, ...args], {
        stdio: ["pipe", "inherit", "inherit"],
        env: process.env,
    });
    const exited = new Promise<number | null>(resolve => child.on("exit", code => resolve(code)));
    await pipeline(stdin, child.stdin).catch(() => undefined);
    const code = await exited;
    if (code === null) {
        throw new Error("本地恢复入口被信号终止");
    }
    return code;
};

/** 本地恢复：与容器同一薄入口（子进程，stdin 流入备份字节），复用同一引擎/锁/去重 */
async function runLocalRestore(filePath: string, mode: string, requestKey: string): Promise<void> {
    const { host, database } = loadDbEnv();
    if (!["localhost", "127.0.0.1"].includes(host)) {
        throw new Error(`--local 仅允许 localhost，当前 DB_HOST=${host}（远程库请走默认远程模式）`);
    }
    console.log(`[local] 目标库：${database}@${host}（${mode}）`);
    const code = await runLocalEntry(["--mode", mode, "--request-key", requestKey], createReadStream(filePath));
    if (code !== 0) {
        throw new Error(`本地恢复失败（exit=${code}）`);
    }
    if (mode === "replace") {
        console.log("replace 完成：所有用户会话已失效，须重新登录。");
    }
}

/** 本地救援改密：转发到 backend 的 restore-cli 入口（stdin 单行传新密码） */
async function runLocalRescuePassword(account: string): Promise<void> {
    const password = await askHidden("新密码（6-128 位，输入不回显）：");
    if (password.length < 6 || password.length > 128) {
        throw new Error("新密码长度须为 6-128 位");
    }
    const code = await runLocalEntry(["--reset-password", account], Readable.from([`${password}\n`]));
    if (code !== 0) {
        throw new Error(`救援改密失败（exit=${code}）`);
    }
}

/** 远程入口：单次 SSH 完成「backend 已停检查 + 目标库校验 + 容器执行」，
 * 命令作为 argv 传递（stdin 不被脚本占用，全程流式喂备份字节/救援密码） */
async function runRemoteEntry(
    input:
        | { type: "restore"; filePath: string; mode: string; requestKey: string }
        | { type: "reset-password"; account: string },
    skipConfirm: boolean,
): Promise<void> {
    const SSH_HOST = process.env.DEPLOY_SSH_HOST;
    if (!SSH_HOST) {
        throw new Error("缺少 DEPLOY_SSH_HOST（写入仓库根 .env，不入库）");
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

    const cliArgs =
        input.type === "restore"
            ? ["--mode", input.mode, "--request-key", input.requestKey]
            : ["--reset-password", input.account];
    // 白名单校验后的参数单引号拼接（mode/requestKey/account 字符集均不含引号）
    const quotedArgs = cliArgs.map(value => `'${value}'`).join(" ");
    const remoteCommand = `set -euo pipefail
cd ${REMOTE_DIR}
RUNNING=$(docker compose ps --status running --services backend | grep -c '^backend$' || true)
if [ "$RUNNING" != "0" ]; then
  echo "BACKEND_RUNNING（先停 backend 再恢复）" >&2
  exit 3
fi
TARGET=$(docker compose run --rm -T --no-deps backend node dist/system/restore-cli.js --print-target --mode merge | tail -n 1)
echo "远端目标库：$TARGET" >&2
echo "$TARGET" | grep -q '"database":"${EXPECTED_DB}"' || { echo "TARGET_MISMATCH（与本地确认值不符）" >&2; exit 4; }
docker compose run --rm -T --no-deps backend node dist/system/restore-cli.js ${quotedArgs}
`;

    console.log(`[remote] ${SSH_HOST}:${REMOTE_DIR} → 目标库 ${EXPECTED_DB} · ${cliArgs.join(" ")}`);
    if (!skipConfirm) {
        const answer = await ask(
            input.type === "restore"
                ? `确认：已停止远程 backend 并暂停部署/迁移，将对 ${EXPECTED_DB} 执行 ${input.mode} 恢复？(输入 yes 继续) `
                : `确认：已停止远程 backend，将对 ${input.account} 执行救援改密？(输入 yes 继续) `,
        );
        if (answer !== "yes") {
            console.log("已取消");
            return;
        }
    }

    // stdin 专用于数据流：备份文件流式直传（不整份驻留内存）或救援密码单行
    const stdinSource: NodeJS.ReadableStream =
        input.type === "restore"
            ? createReadStream(input.filePath)
            : Readable.from([`${await askHidden("新密码（6-128 位，经 stdin 传入远端，不记录）：")}\n`]);

    const child = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", SSH_HOST, remoteCommand], {
        stdio: ["pipe", "inherit", "inherit"],
    });
    const exited = new Promise<number | null>(resolve => child.on("exit", code => resolve(code)));
    await pipeline(stdinSource, child.stdin).catch(() => undefined);
    const code = await exited;
    if (code === 3) {
        throw new Error("远端 backend 仍在运行：先停 backend（停写前提）再执行");
    }
    if (code === 4) {
        throw new Error("远端实际目标库与本地确认值不一致，已拒绝执行");
    }
    if (code !== 0 && code !== null) {
        throw new Error(`远程执行失败（exit=${code}）`);
    }
    if (code === null) {
        throw new Error("远程执行被信号终止");
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});

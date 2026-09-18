import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const oxlintCli = resolve(dirname(require.resolve("oxlint/package.json")), "bin/oxlint");

/** 子进程捕获输出时的缓冲区上限 */
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024 * 1024;
/** 会触发「需要跑两遍」的修复类 flag */
const FIX_FLAGS = new Set(["--fix", "--fix-dangerously", "--fix-suggestions"]);

function isFixInvocation(args: readonly string[]): boolean {
    return args.some(arg => FIX_FLAGS.has(arg));
}

/** 用户是否已显式指定输出格式（-f / --format） */
function hasOutputFormat(args: readonly string[]): boolean {
    return args.some(arg => arg === "-f" || arg.startsWith("-f=") || arg === "--format" || arg.startsWith("--format="));
}

export interface OxlintInvocation {
    readonly args: readonly string[];
    readonly env: NodeJS.ProcessEnv;
}

/**
 * 统一线程数入口 + CI 格式兜底。
 * - 线程数只允许通过 OXLINT_THREADS 控制；直接传 --threads 会报错，避免两套来源打架。
 * - CI 下若未指定格式，兜底为 default（GitHub Actions 里 oxlint 的 github 格式会丢输出）。
 */
export function resolveOxlintInvocation(args: readonly string[], env: NodeJS.ProcessEnv): OxlintInvocation {
    const resolvedArgs = [...args];

    if (env.CI === "true" && !hasOutputFormat(args)) resolvedArgs.push("--format=default");

    const raw = env.OXLINT_THREADS;
    if (raw === undefined || raw === "") return { args: resolvedArgs, env: { ...env } };

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
        throw new Error(`run-oxlint: OXLINT_THREADS must be a positive integer, got ${JSON.stringify(raw)}.`);
    }
    if (args.some(arg => arg === "--threads" || arg.startsWith("--threads="))) {
        throw new Error("run-oxlint: use OXLINT_THREADS instead of passing --threads directly.");
    }

    return {
        args: [...resolvedArgs, `--threads=${raw}`],
        env: { ...env },
    };
}

/**
 * 子进程退出后的收尾：
 * - 被信号杀死 → 用同一信号杀掉自己，保持「被外部中断」的语义；
 * - 正常退出 → 透传退出码。
 */
function completeFrom(result: { readonly signal: NodeJS.Signals | null; readonly status: number | null }): void {
    if (result.signal !== null) {
        process.kill(process.pid, result.signal);
        return;
    }
    process.exitCode = result.status ?? 1;
}

function main(): void {
    const invocation = resolveOxlintInvocation(process.argv.slice(2), process.env);

    // 非 --fix：单趟执行，stdio 直通终端，零拷贝零缓冲。
    if (!isFixInvocation(invocation.args)) {
        const result = spawnSync(process.execPath, [oxlintCli, ...invocation.args], {
            env: invocation.env,
            stdio: "inherit",
        });
        if (result.error !== undefined) throw result.error;
        completeFrom(result);
        return;
    }

    // --fix：第一遍捕获输出（不直通，避免刷屏），只有失败才需要第二遍。
    const first = spawnSync(process.execPath, [oxlintCli, ...invocation.args], {
        encoding: "utf8",
        env: invocation.env,
        maxBuffer: MAX_CAPTURED_OUTPUT_BYTES,
    });
    if (first.error !== undefined) throw first.error;
    if (first.signal !== null) {
        completeFrom(first);
        return;
    }
    if (first.status === 0) {
        process.stdout.write(first.stdout);
        process.stderr.write(first.stderr);
        process.exitCode = 0;
        return;
    }

    // 第一遍仍有非零退出：可能是 JS 插件修复互相重叠，第二遍又暴露出新的可修复诊断。
    // 再跑一遍，此时直通输出，让用户看到最终结果。
    const second = spawnSync(process.execPath, [oxlintCli, ...invocation.args], {
        env: invocation.env,
        stdio: "inherit",
    });
    if (second.error !== undefined) throw second.error;
    completeFrom(second);
}

// 仅当作为入口脚本直接执行时才运行 main（被 import 时保持无副作用）。
const entrypoint = process.argv[1];
if (entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url)) main();

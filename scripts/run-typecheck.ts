import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const tscCli = resolve(dirname(require.resolve("typescript/package.json")), "bin/tsc");

/**
 * 子进程退出后的收尾（与 run-oxlint 保持同一语义）：
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

const root = spawnSync(process.execPath, [tscCli, "--project", "."], { stdio: "inherit" });
if (root.error !== undefined) throw root.error;
completeFrom(root);

if (process.exitCode === 0) {
    // turbo 按拓扑跑各包 typecheck 并缓存结果；根包无 //#typecheck 任务，不会被
    // 纳入任务图，不存在「包装器 → turbo → 包装器」递归
    const packages = spawnSync("pnpm exec turbo run typecheck", { stdio: "inherit", shell: true });
    if (packages.error !== undefined) throw packages.error;
    completeFrom(packages);
}

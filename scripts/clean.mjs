/**
 * 深度清理 monorepo：从仓库根递归收集所有构建产物与依赖目录，按批并发删除。
 * 目标：node_modules / dist / .turbo 目录、dist.zip 文件；
 * --del-lock 追加删除根 pnpm-lock.yaml，--dry-run 仅列出不动手。
 * 不引 rimraf 等第三方依赖：无需逐目标 spawn 进程，node_modules 缺失时也能执行。
 */
import fs from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 路径以脚本位置锚定（仓库根 scripts/），任意 cwd 下执行均一致
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

// 按“名字”而非“路径”匹配：任意层级的同名目录/文件都会被删
const DELETE_DIR_NAMES = new Set(["node_modules", "dist", ".turbo"]);
const DELETE_FILE_NAMES = new Set(["dist.zip"]);
// .git 历史对象库含同名条目，.idea/.vscode 是编辑器配置，均绝不能碰
const SKIP_DIR_NAMES = new Set([".git", ".idea", ".vscode"]);
const MAX_DEPTH = 10; // 递归深度上限，防异常目录环导致死循环
const BATCH_SIZE = 10; // 并发删除批大小

const dryRun = process.argv.includes("--dry-run");
const delLock = process.argv.includes("--del-lock");

// 阶段一：同步 DFS 收集目标（readdir withFileTypes 一次拿到类型，不跟随符号链接）
const collect = (dir, depth, targets) => {
    if (depth >= MAX_DEPTH) return;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
        console.warn(`跳过不可读目录 ${path.relative(repoRoot, dir)}：${error.message}`);
        return;
    }
    for (const entry of entries) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        // 命中即收集且不再下钻（node_modules 内还有嵌套 node_modules，整体移除即可）
        if (DELETE_DIR_NAMES.has(entry.name) || DELETE_FILE_NAMES.has(entry.name)) {
            targets.push(full);
            continue;
        }
        // 只下钻真实目录；符号链接不跟随，避免经 pnpm 依赖图逃逸出仓库
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
            collect(full, depth + 1, targets);
        }
    }
};

const targets = [];
collect(repoRoot, 0, targets);
if (delLock && fs.existsSync(path.join(repoRoot, "pnpm-lock.yaml"))) {
    targets.push(path.join(repoRoot, "pnpm-lock.yaml"));
}

const removed = [];
let failed = 0;

const removeOne = async target => {
    const label = path.relative(repoRoot, target);
    if (dryRun) {
        console.log(`[dry-run] 将删除 ${label}`);
        removed.push(label);
        return;
    }
    try {
        // force：目标不存在不报错；maxRetries：Windows 深层 node_modules 偶发 EBUSY/ENOTEMPTY，重试收敛
        await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        console.log(`已删除 ${label}`);
        removed.push(label);
    } catch (error) {
        failed += 1;
        console.error(`删除失败 ${label}：${error.message}`);
    }
};

const main = async () => {
    console.log(`仓库根：${repoRoot}${dryRun ? "（dry-run 演练，不实际删除）" : ""}，共发现 ${targets.length} 个目标`);
    // 阶段二：10 个一批并发删除，几十个包的 node_modules/dist 不必逐个串行等
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        await Promise.all(targets.slice(i, i + BATCH_SIZE).map(removeOne));
    }
    if (targets.length === 0) {
        console.log("未发现可清理项，仓库已是干净状态");
    } else {
        console.log(`\n完成：共清理 ${removed.length} 项${failed > 0 ? `，失败 ${failed} 项` : ""}`);
    }
    if (failed > 0) {
        process.exitCode = 1;
    }
};

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

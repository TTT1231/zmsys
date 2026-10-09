import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* 主题色护栏：拦「写死颜色」的类名，防止暗色 / 主题预设再次漏适配
   （2026-09 暗色 UI 修复的教训：徽章 / 面板写死浅色 hex，暗色下全部刺眼）。
   只拦两类（注释里不写字面示例，否则会命中本护栏自己）：
   1. 任意值 hex：颜色工具类前缀 + [#十六进制]（bg/text/border 等接法）——不随 html.dark 换色；
   2. 原始调色板档位：颜色工具类前缀 + Tailwind 原生色名档位（如 sky-700）——浅色档文字在暗底上对比度崩坏。
   放行：语义 token（bg-danger-soft、border-warning/30）、主题感知任意值
   （from-[var(--color-primary)]，锚定 # 不会误伤）、白名单里的固定装饰
   （登录页 / 错误页品牌渐变等，有意不随主题）。 */

const ARBITRARY_HEX = /(?:bg|text|border|from|via|to|ring|fill|stroke|outline|accent|caret|decoration|divide)-\[#/;

const PALETTE_CLASS =
    /\b(?:bg|text|border|from|via|to|ring)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-(?:50|[0-9]{3})\b/;

/** 有意不随主题变色的装饰文件：新增时在 PR 里说明理由，别顺手加 */
const ALLOWED_FILES = new Set([
    "apps/frontend/src/pages/error/ErrorPage.tsx",
    "apps/frontend/src/pages/login/LoginPage.tsx",
    "apps/frontend/src/pages/workbench/WorkbenchTrend.tsx",
]);

const SCAN_EXTENSIONS = new Set([".ts", ".tsx"]);

interface Violation {
    readonly file: string;
    readonly line: number;
    readonly text: string;
}

function listSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            files.push(...listSourceFiles(full));
        } else if (SCAN_EXTENSIONS.has(extname(entry))) {
            files.push(full);
        }
    }
    return files;
}

function extname(file: string): string {
    const dot = file.lastIndexOf(".");
    return dot === -1 ? "" : file.slice(dot);
}

function scanFile(file: string): Violation[] {
    const found: Violation[] = [];
    readFileSync(file, "utf8")
        .split("\n")
        .forEach((text, index) => {
            if (ARBITRARY_HEX.test(text) || PALETTE_CLASS.test(text)) {
                found.push({ file, line: index + 1, text: text.trim() });
            }
        });
    return found;
}

function main(): void {
    // 传参 = 只扫这些文件（pre-commit 传 staged files）；不传 = 全量扫前端 src
    const targets =
        process.argv.length > 2
            ? process.argv.slice(2).filter(path => !ALLOWED_FILES.has(relative(ROOT, path).split(sep).join("/")))
            : listSourceFiles(join(ROOT, "apps/frontend/src")).filter(
                  path => !ALLOWED_FILES.has(relative(ROOT, path).split(sep).join("/")),
              );

    const violations = targets.flatMap(file => scanFile(file));

    if (violations.length === 0) return;

    for (const { file, line, text } of violations) {
        console.error(`${relative(ROOT, file).split(sep).join("/")}:${line}: ${text.slice(0, 120)}`);
    }
    console.error(
        `\ntheme-guard: ${violations.length} 处写死颜色。改用语义 token（见 apps/frontend/src/index.css 的 @theme），` +
            `固定色装饰需加入脚本内 ALLOWED_FILES 白名单并说明理由。`,
    );
    process.exitCode = 1;
}

// 仅当作为入口脚本直接执行时才运行 main（被 import 时保持无副作用）。
const entrypoint = process.argv[1];
if (entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url)) main();

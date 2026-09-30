/* 输出契约校验：JSON 合法（UTF-8）、字段齐备、scenario id 恰好八个、进程清理干净 */
import { readFileSync } from "node:fs";
import net from "node:net";

const path = process.argv[2];
const raw = readFileSync(path);
const text = raw.toString("utf8");
const j = JSON.parse(text);

const REQUIRED = [
    "scenario",
    "ok",
    "requestCount",
    "transferBytes",
    "apiTimings",
    "interactionOrLoadMs",
    "longTaskCount",
    "longTaskMaxMs",
    "longTaskTotalMs",
    "layoutMs",
    "paintMs",
    "scriptMs",
    "domNodes",
    "tableRemounted",
    "notes",
];
const EXPECTED_IDS = [
    "bom-cold-start",
    "workbench-then-bom",
    "bom-refresh-stale",
    "bom-search",
    "bom-usage-filter",
    "bom-column-resize",
    "inbound-bom-picker",
    "orders-page",
];

const problems = [];
if (j.checkpoint !== "baseline") problems.push(`checkpoint=${j.checkpoint}`);
if (!j.resultsPath) problems.push("缺 resultsPath");
if (typeof j.envNotes !== "string" || j.envNotes.length < 50) problems.push("缺 envNotes");
const ids = j.scenarios.map(s => s.scenario);
if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_IDS)) problems.push(`scenario id 集合/顺序不符：${ids.join(",")}`);
for (const s of j.scenarios) {
    for (const key of REQUIRED) {
        if (!(key in s)) problems.push(`${s.scenario}: 缺字段 ${key}`);
    }
    for (const key of [
        "requestCount",
        "transferBytes",
        "interactionOrLoadMs",
        "longTaskCount",
        "longTaskMaxMs",
        "longTaskTotalMs",
        "layoutMs",
        "paintMs",
        "scriptMs",
        "domNodes",
    ]) {
        if (typeof s[key] !== "number") problems.push(`${s.scenario}: ${key} 非 number（${typeof s[key]}）`);
    }
    if (typeof s.ok !== "boolean") problems.push(`${s.scenario}: ok 非 boolean`);
    if (!Array.isArray(s.apiTimings)) problems.push(`${s.scenario}: apiTimings 非数组`);
    else {
        for (const t of s.apiTimings) {
            if (typeof t.path !== "string" || typeof t.ms !== "number" || typeof t.bytes !== "number")
                problems.push(`${s.scenario}: apiTimings 项字段缺失/类型错`);
        }
        const sorted = [...s.apiTimings].every((t, i, a) => i === 0 || a[i - 1].ms >= t.ms);
        if (!sorted) problems.push(`${s.scenario}: apiTimings 未按 ms 降序`);
        if (s.apiTimings.length > 8) problems.push(`${s.scenario}: apiTimings 超过 8 项`);
    }
    if (s.scenario === "bom-usage-filter" && typeof s.tableRemounted !== "boolean")
        problems.push(`bom-usage-filter: tableRemounted 必须为 boolean`);
    if (s.scenario !== "bom-usage-filter" && s.tableRemounted !== null)
        problems.push(`${s.scenario}: tableRemounted 应为 null`);
    if (typeof s.notes !== "string" || !s.notes) problems.push(`${s.scenario}: notes 为空`);
}
const okCount = j.scenarios.filter(s => s.ok).length;

const portOpen = port =>
    new Promise(resolve => {
        const s = net.connect({ port, host: "127.0.0.1" });
        s.once("connect", () => {
            s.destroy();
            resolve(true);
        });
        s.once("error", () => resolve(false));
    });
const p5000 = await portOpen(5000);

console.log(`JSON 合法（UTF-8 解析通过）：是`);
console.log(`checkpoint=${j.checkpoint}，场景 ${j.scenarios.length} 个（ok=${okCount}）`);
console.log(`后端端口 5000 残留监听：${p5000 ? "有（清理不干净！）" : "无"}`);
if (problems.length) {
    console.log("发现问题：");
    for (const p of problems) console.log("  -", p);
    process.exit(1);
}
console.log("契约校验：全部通过");

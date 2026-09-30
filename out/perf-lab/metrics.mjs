/* 指标采集：页面注入 PerformanceObserver（longtask 含 startTime / rAF 间隔）、
 * resource/navigation 条目（requestCount / transferBytes / apiTimings）、
 * CDP Tracing 原始事件 gzip 落盘。
 *
 * v2 口径变更（相对 archive-v1）：
 * - 不再做 layout/paint/script 自动分桶汇总：按事件名直接累加 dur 存在父子嵌套
 *   重复计数，不可靠。关键时间窗的归因用现成工具（DevTools/Perfetto）对原始
 *   trace 定向检查；仅当现成工具无法满足复核需求时才考虑补脚本。
 * - longtask 条目带 startTime（供场景按窗口过滤）。
 * - 原始 trace 写 <TRACE_DIR>/<label>.json.gz；超限不落盘并显式标记
 *   traceSaved=false（该场景的 trace 归因视为不完整，不得声称已完成归因）。 */
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..");
const TRACE_DIR = process.env.PERF_LAB_TRACE_DIR
    ? path.resolve(process.env.PERF_LAB_TRACE_DIR)
    : path.resolve(here, "v2", "traces");
const TRACE_RAW_LIMIT = 200_000_000; // 序列化后 200MB：超过则不落盘（防内存撑爆）

/** 每个新 document 最早执行的采集脚本（context.addInitScript） */
export const INIT_SCRIPT = `
window.__longtasks = [];
try {
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) window.__longtasks.push({ startTime: Math.round(e.startTime * 10) / 10, duration: Math.round(e.duration) });
  }).observe({ entryTypes: ['longtask'] });
} catch (e) { window.__longtasks = null; }
window.__raf = { intervals: [], recording: false, last: 0 };
const __rafLoop = (t) => {
  const r = window.__raf;
  if (r.last && r.recording) r.intervals.push(Math.round((t - r.last) * 100) / 100);
  r.last = t;
  requestAnimationFrame(__rafLoop);
};
requestAnimationFrame(__rafLoop);
`;

/** 场景收尾：从页面读全部计数（resource / longtask / domNodes） */
export async function collectPageCounters(page) {
    return page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] ?? null;
        const resources = performance.getEntriesByType("resource").map(e => ({
            name: e.name,
            ms: Math.round(e.duration * 10) / 10,
            transfer: e.transferSize ?? 0,
            encoded: e.encodedBodySize ?? 0,
        }));
        return {
            navTransfer: nav?.transferSize ?? 0,
            navMs: nav ? Math.round(nav.duration) : 0,
            resources,
            longtasks: Array.isArray(window.__longtasks) ? window.__longtasks : [],
            domNodes: document.querySelectorAll("*").length,
            // 场景中途 clearResourceTimings() 前由场景自存的生产资源判定（bom-refresh-stale）
            prodAssetsPreClear: window.__prodAssetsOk === undefined ? null : window.__prodAssetsOk,
        };
    });
}

/** 生产资源断言：优先用场景在 clear 前存下的判定 */
export function assertProductionAssets(counters, scenario) {
    if (counters.prodAssetsPreClear !== null && counters.prodAssetsPreClear !== undefined) {
        if (!counters.prodAssetsPreClear) throw new Error(`${scenario}: 页面未加载 dist 生产资源（clear 前判定失败）`);
        return;
    }
    const names = counters.resources.map(r => r.name);
    const hasAssets = names.some(n => /\/assets\/[^/]+\.js/.test(n));
    const hasDevServer = names.some(n => n.includes("/@vite") || n.includes("/@react-refresh") || n.includes(":5173"));
    if (!hasAssets || hasDevServer) {
        throw new Error(`${scenario}: 页面未加载 dist 生产资源（assets=${hasAssets}, devServer=${hasDevServer}）`);
    }
}

export function summarizeCounters(counters) {
    const all = [
        { name: "(document)", transfer: counters.navTransfer, ms: counters.navMs, encoded: counters.navTransfer },
        ...counters.resources,
    ];
    const transferBytes = all.reduce((sum, r) => sum + (r.transfer || 0), 0);
    const api = counters.resources
        .filter(r => r.name.includes("/api/"))
        .map(r => {
            let path = r.name;
            const i = path.indexOf("/api/");
            path = path.slice(i);
            const q = path.indexOf("?");
            return { path: q > 0 ? path.slice(0, q) : path, ms: r.ms, bytes: r.encoded };
        });
    const apiTimings = api
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 8)
        .map(({ path, ms, bytes }) => ({ path, ms, bytes }));
    const lt = counters.longtasks;
    return {
        requestCount: all.length,
        transferBytes,
        apiTimings,
        apiRequestCount: api.length,
        longTaskCount: lt.length,
        longTaskMaxMs: lt.length ? Math.max(...lt.map(x => x.duration)) : 0,
        longTaskTotalMs: lt.reduce((s, v) => s + v.duration, 0),
        domNodes: counters.domNodes,
    };
}

/* ---- CDP Tracing（devtools.timeline，原始事件落盘） ---- */

const TRACE_CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline.frame"];

export class Tracer {
    /**
     * @param {import("playwright-core").Page} page
     * @param {string} label trace 文件名主体（<checkpoint>-<scenario>）
     */
    constructor(page, label = "trace") {
        this.page = page;
        this.label = label;
        this.client = null;
        this.events = [];
        this._done = null;
        this.error = null;
    }

    async start() {
        this.client = await this.page.context().newCDPSession(this.page);
        this.client.on("Tracing.dataCollected", chunk => {
            this.events.push(...(chunk.value ?? []));
        });
        this.client.on("Tracing.tracingComplete", () => {
            this._done?.();
        });
        this.client.on("Tracing.bufferUsage", () => {});
        await this.client.send("Tracing.start", {
            transferMode: "ReportEvents",
            categories: TRACE_CATEGORIES.join(","),
        });
    }

    /** 结束采集：原始事件 gzip 落盘；未落盘时 traceSaved=false 并写明原因 */
    async stop() {
        const summary = { traceEventCount: this.events.length, tracePath: null, traceSaved: false, error: null };
        if (!this.client) {
            summary.error = "tracer not started";
            return summary;
        }
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Tracing.end 超时（20s）")), 20_000);
            this._done = () => {
                clearTimeout(timer);
                resolve();
            };
            this.client.send("Tracing.end").catch(reject);
        }).catch(err => {
            this.error = err.message;
        });
        try {
            await this.client.detach();
        } catch {
            /* 页面可能已关闭 */
        }
        if (this.error) summary.error = this.error;
        if (this.events.length === 0) {
            summary.error = [summary.error, "未采集到任何 trace 事件"].filter(Boolean).join("；");
            return summary;
        }
        try {
            const json = JSON.stringify(this.events);
            if (json.length > TRACE_RAW_LIMIT) {
                summary.error = [
                    summary.error,
                    `trace 序列化 ${Math.round(json.length / 1e6)}MB 超过 ${TRACE_RAW_LIMIT / 1e6}MB 上限，未落盘（该场景 trace 归因不完整）`,
                ]
                    .filter(Boolean)
                    .join("；");
                return summary;
            }
            mkdirSync(TRACE_DIR, { recursive: true });
            const file = path.join(TRACE_DIR, `${this.label}.json.gz`);
            writeFileSync(file, gzipSync(json));
            summary.tracePath = path.relative(REPO, file).split(path.sep).join("/");
            summary.traceSaved = true;
        } catch (err) {
            summary.error = [summary.error, `trace 落盘失败: ${err.message}`].filter(Boolean).join("；");
        }
        return summary;
    }
}

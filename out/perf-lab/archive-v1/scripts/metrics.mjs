/* 指标采集：页面注入 PerformanceObserver（longtask / rAF 间隔）、
 * resource/navigation 条目（requestCount / transferBytes / apiTimings）、
 * CDP Tracing（devtools.timeline 聚合 layout / paint / script）。 */

/** 每个新 document 最早执行的采集脚本（context.addInitScript） */
export const INIT_SCRIPT = `
window.__longtasks = [];
try {
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) window.__longtasks.push(Math.round(e.duration));
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
        longTaskMaxMs: lt.length ? Math.max(...lt) : 0,
        longTaskTotalMs: lt.reduce((s, v) => s + v, 0),
        domNodes: counters.domNodes,
    };
}

/* ---- CDP Tracing（devtools.timeline） ---- */

const TRACE_CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline.frame"];

export class Tracer {
    constructor(page) {
        this.page = page;
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

    async stop() {
        if (!this.client)
            return { layoutMs: 0, paintMs: 0, scriptMs: 0, traceEventCount: 0, error: "tracer not started" };
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
        return summarizeTrace(this.events, this.error);
    }
}

const LAYOUT_NAMES = new Set(["Layout", "UpdateLayoutTree", "RecalculateStyles", "InvalidateLayout", "ParseHTML"]);
const PAINT_NAMES = new Set([
    "Paint",
    "UpdateLayerTree",
    "PaintImage",
    "CompositeLayers",
    "Rasterize",
    "Decode Image",
    "Resize Image",
]);
const SCRIPT_NAMES = new Set([
    "FunctionCall",
    "EvaluateScript",
    "TimerFire",
    "EventDispatch",
    "GCEvent",
    "MinorGC",
    "MajorGC",
    "CompileScript",
    "V8.Execute",
    "RequestAnimationFrame",
    "FireAnimationFrame",
    "TimerInstall",
    "TimerRemove",
    "PromiseThen",
    "RunMicrotasks",
    "UserTiming",
    "XHRLoad",
    "ResourceReceiveResponse",
    "ResourceSendRequest",
]);

/** 按 devtools.timeline 事件名聚合 dur（微秒 → 毫秒） */
export function summarizeTrace(events, error = null) {
    let layoutUs = 0,
        paintUs = 0,
        scriptUs = 0,
        counted = 0;
    for (const e of events) {
        if (typeof e.dur !== "number" || e.dur <= 0) continue;
        const cat = Array.isArray(e.cat) ? e.cat.join(",") : String(e.cat ?? "");
        if (!cat.includes("devtools.timeline")) continue;
        counted++;
        if (LAYOUT_NAMES.has(e.name)) layoutUs += e.dur;
        else if (PAINT_NAMES.has(e.name)) paintUs += e.dur;
        else if (SCRIPT_NAMES.has(e.name)) scriptUs += e.dur;
    }
    const round = us => Math.round((us / 1000) * 10) / 10;
    return {
        layoutMs: round(layoutUs),
        paintMs: round(paintUs),
        scriptMs: round(scriptUs),
        traceEventCount: counted,
        ...(error ? { error } : {}),
    };
}

/* 性能场景（v2）。每个场景：独立干净 context（仅带登录 token 的 storageState，
 * 业务 localStorage 如表格列宽偏好全部为空 = 清空存储）→ CDP Tracing（原始事件
 * gzip 落盘，不做自动分桶）→ 场景动作 → 稳定 → 汇总指标。
 *
 * v2 口径变更（相对 archive-v1）：
 * - bom-search：Event Timing（durationThreshold=16）+ event.timeStamp 绑定；
 *   每键状态 ∈ {已上报, 未上报}（未上报=低于采集阈值或浏览器未报，不补零）；
 *   结果变化按「可见 BOM 编码序列 + 结果总数」判定，不做跨键猜测归因。
 * - bom-usage-filter：受控两遍（usage 三接口挂起后改写为空引用集：未使用=全部
 *   BOM→非空；正在使用=空）。时序：挂起→原表格→切筛选→断言卸载→释放→断言
 *   挂载。分段：受控 usage 等待段（切→释放，人为挂起，非真实网络耗时）与
 *   处理段（释放→表格回归，含解析/派生/调度/渲染）。
 * - 新增 consumer-then-bom（入库页→BOM 真实导航完整请求清单）、
 *   bom-cold-start-pair（正常 vs usage 延迟交错配对）、
 *   bom-layout-pair（P4 单/双分支配对，需 dist-exp 实验构建）。 */
import { INIT_SCRIPT, collectPageCounters, summarizeCounters, assertProductionAssets, Tracer } from "./metrics.mjs";

const VIEWPORT = { width: 1280, height: 800 };
const SETTLE_MS = 1200;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const medianOf = arr => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted.length % 2
        ? sorted[Math.floor(sorted.length / 2)]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};

/** 侧边栏 SPA 导航：手风琴分组（SidebarMenu openGroup 初始只展开当前页所在组，
 * 其余组折叠导致 a 链接不可见）——先按需展开目标分组。 */
async function expandGroupIfNeeded(page, groupLabel) {
    const groupBtn = page.getByRole("button", { name: groupLabel, exact: true }).first();
    const expanded = await groupBtn.getAttribute("aria-expanded").catch(() => "true");
    if (expanded !== "true") await groupBtn.click();
}

/** BOM 桌面表格数据行出现（第一列序号 + 第二列 BOM 编码按钮） */
async function waitForBomTable(page, timeout = 45_000) {
    await page.waitForSelector(`table thead th[aria-label="BOM 编码"]`, { timeout });
    await page.waitForSelector("table tbody tr td:nth-child(2) button", { timeout });
    // 数据行稳定：行数两次采样一致
    let prev = -1;
    for (let i = 0; i < 30; i++) {
        const n = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
        if (n === prev) return n;
        prev = n;
        await sleep(250);
    }
    return prev;
}

function baseResult(scenario) {
    return {
        scenario,
        ok: false,
        requestCount: 0,
        transferBytes: 0,
        apiTimings: [],
        interactionOrLoadMs: 0,
        longTaskCount: 0,
        longTaskMaxMs: 0,
        longTaskTotalMs: 0,
        tracePath: null,
        traceSaved: false,
        traceEventCount: 0,
        domNodes: 0,
        tableRemounted: null,
        notes: "",
    };
}

/** 统一跑一个场景（含指标收集）。
 * def.outer === "none" 的场景（自管多 context）跳过外层页面的计数与生产资源断言。 */
export async function runScenario(browser, base, storageState, def, opts = {}) {
    const context = await browser.newContext({ viewport: VIEWPORT, storageState });
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const tracer = new Tracer(page, `${opts.checkpoint ?? "adhoc"}-${def.id}`);
    const result = baseResult(def.id);
    try {
        await tracer.start();
        const detail = (await def.run({ browser, page, context, base, storageState, opts })) ?? {};
        if (def.outer === "none") {
            Object.assign(result, detail.overrides ?? {});
        } else {
            await sleep(SETTLE_MS);
            const counters = await collectPageCounters(page);
            await assertProductionAssets(counters, def.id);
            Object.assign(result, summarizeCounters(counters), detail.overrides ?? {});
        }
        result.notes = [detail.notes ?? "", detail.extraNotes ?? ""].filter(Boolean).join(" ");
        result.ok = true;
    } catch (err) {
        result.ok = false;
        result.notes = `场景失败：${err.message?.slice(0, 400)}`;
    } finally {
        const trace = await tracer
            .stop()
            .catch(err => ({ traceEventCount: 0, tracePath: null, traceSaved: false, error: err.message }));
        result.tracePath = trace.tracePath ?? null;
        result.traceSaved = trace.traceSaved === true;
        result.traceEventCount = trace.traceEventCount ?? 0;
        if (trace.error) result.notes = `${result.notes}${result.notes ? " " : ""}[trace] ${trace.error}`.trim();
        await context.close().catch(() => {});
    }
    return result;
}

/* ---------- 五类资源（boms/bom-categories/bom-stocks 与 orders/inbound/outbound） ---------- */
const FIVE_KEYS = [
    "/api/boms",
    "/api/bom-categories",
    "/api/bom-stocks",
    "/api/orders",
    "/api/inbound",
    "/api/outbound",
];
function fiveResourceSummary(counters) {
    const hits = FIVE_KEYS.map(key => {
        const matches = counters.resources.filter(r => {
            const i = r.name.indexOf("/api/");
            const p = r.name.slice(i).split("?")[0];
            return p === key;
        });
        return {
            path: key,
            count: matches.length,
            msList: matches.map(m => m.ms),
        };
    });
    const lines = hits.map(
        h =>
            `${h.path}×${h.count}${
                h.count
                    ? `(${h.msList
                          .map(ms => Math.round(ms))
                          .join(",")
                          .slice(0, 60)}ms)`
                    : ""
            }`,
    );
    return { hits, lines };
}

/** 完整 /api 请求清单（按路径聚合计数） */
async function apiPathCounts(page) {
    return page.evaluate(() => {
        const counts = new Map();
        for (const e of performance.getEntriesByType("resource")) {
            const i = e.name.indexOf("/api/");
            if (i < 0) continue;
            const p = e.name.slice(i).split("?")[0];
            counts.set(p, (counts.get(p) ?? 0) + 1);
        }
        return [...counts.entries()].map(([p, c]) => `${p}×${c}`);
    });
}

/* ---------- 场景定义 ---------- */

export const SCENARIOS = [
    {
        id: "bom-cold-start",
        title: "清空存储冷启动直达 BOM 页",
        async run({ page, base }) {
            const t0 = Date.now();
            await page.goto(`${base}/bom`, { waitUntil: "commit" });
            const rows = await waitForBomTable(page);
            const loadMs = Date.now() - t0;
            return {
                overrides: { interactionOrLoadMs: loadMs },
                notes: `冷启动（新 context、无业务 localStorage、无 HTTP 缓存）goto /bom 到表格数据行稳定：${loadMs}ms；数据行 ${rows} 行。`,
            };
        },
    },
    {
        id: "bom-cold-start-pair",
        title: "冷启动配对对照：正常 vs usage 三接口延迟 10s（交错各 3 轮）",
        outer: "none",
        async run({ browser, base, storageState }) {
            const rounds = [];
            for (let i = 0; i < 3; i += 1) {
                for (const mode of ["normal", "delayed"]) {
                    const context = await browser.newContext({ viewport: VIEWPORT, storageState });
                    await context.addInitScript(INIT_SCRIPT);
                    if (mode === "delayed") {
                        for (const p of ["/api/orders", "/api/inbound", "/api/outbound"]) {
                            await context.route(`**${p}`, async route => {
                                await sleep(10_000);
                                await route.continue();
                            });
                        }
                    }
                    const p2 = await context.newPage();
                    p2.setDefaultTimeout(60_000);
                    const t0 = Date.now();
                    await p2.goto(`${base}/bom`, { waitUntil: "commit" });
                    await waitForBomTable(p2);
                    rounds.push({ round: i + 1, mode, loadMs: Date.now() - t0 });
                    await context.close().catch(() => {});
                    await sleep(400);
                }
            }
            const normal = rounds.filter(r => r.mode === "normal").map(r => r.loadMs);
            const delayed = rounds.filter(r => r.mode === "delayed").map(r => r.loadMs);
            const medN = medianOf(normal);
            const medD = medianOf(delayed);
            const spreadN = Math.max(...normal) - Math.min(...normal);
            return {
                overrides: { interactionOrLoadMs: medN },
                notes:
                    `同栈同数据交错配对（normal→delayed ×3 轮，每轮全新 context 冷启动）。` +
                    `normal=[${normal.join(",")}]ms（中位 ${medN}ms，轮间极差 ${spreadN}ms）；` +
                    `delayed(usage 三接口人为延后 10s)=[${delayed.join(",")}]ms（中位 ${medD}ms）。` +
                    `中位差值 delayed−normal=${medD - medN}ms。口径：这是「整条 usage 链延后」对首显的影响（带宽/主线程并发竞争在本机 localhost 栈下的体现），不代表聚合接口改造的收益；与轮间极差同量级的差值应视为噪声。`,
            };
        },
    },
    {
        id: "workbench-then-bom",
        title: "先载工作台再导航 BOM",
        async run({ page, base }) {
            const t0 = Date.now();
            await page.goto(`${base}/workbench`, { waitUntil: "commit" });
            await page.waitForSelector('section[aria-label="交付风险提醒"]', { timeout: 45_000 });
            await page.waitForLoadState("networkidle");
            const wbLoadMs = Date.now() - t0;
            // 侧边栏 SPA 导航到 BOM（"业务导航"分组初始可能折叠）
            await expandGroupIfNeeded(page, "业务导航");
            const t1 = Date.now();
            await page.locator('a[href="/bom"]').first().click();
            const rows = await waitForBomTable(page);
            const navMs = Date.now() - t1;
            const counters = await collectPageCounters(page);
            const five = fiveResourceSummary(counters);
            const dup = five.hits.filter(h => h.count > 1).map(h => h.path);
            return {
                overrides: { interactionOrLoadMs: navMs },
                notes: `工作台冷加载 ${wbLoadMs}ms（工作台页走 /api/workbench/overview 聚合端点）；侧边栏导航到 BOM 表格稳定 ${navMs}ms，数据行 ${rows}。五类资源明细：${five.lines.join("；")}。与工作台快照 queryKey 不同（["wb",…] vs ["boms",…]），${dup.length ? `重复请求：${dup.join("、")}` : "无重复请求（工作台页不取这五类资源，P3 重复路径见 consumer-then-bom）"}。`,
            };
        },
    },
    {
        id: "consumer-then-bom",
        title: "入库页（useWbSnapshot 消费页）→ BOM 真实导航",
        async run({ page, base }) {
            await page.goto(`${base}/inbound`, { waitUntil: "commit" });
            await page.waitForSelector("table tbody tr td", { timeout: 45_000 });
            await page.waitForLoadState("networkidle");
            const inboundList = await apiPathCounts(page);
            await page.evaluate(() => performance.clearResourceTimings());
            await expandGroupIfNeeded(page, "业务导航");
            const t1 = Date.now();
            await page.locator('a[href="/bom"]').first().click();
            const rows = await waitForBomTable(page);
            const navMs = Date.now() - t1;
            const bomList = await apiPathCounts(page);
            const inboundSet = new Set(inboundList.map(s => s.split("×")[0]));
            const dup = bomList.filter(s => inboundSet.has(s.split("×")[0]));
            return {
                overrides: { interactionOrLoadMs: navMs },
                notes:
                    `入库页阶段 API 清单：${inboundList.join("，") || "无"}。` +
                    `侧边栏导航到 BOM 表格稳定 ${navMs}ms（数据行 ${rows}），BOM 阶段完整 API 清单：${bomList.join("，") || "无"}。` +
                    `两阶段都请求的接口（BOM 页重复获取，P3 实测口径）：${dup.join("，") || "无"}。`,
            };
        },
    },
    {
        id: "bom-refresh-stale",
        title: "BOM 页等 staleTime 过期后重进",
        async run({ page, base }) {
            await page.goto(`${base}/bom`, { waitUntil: "commit" });
            const rows0 = await waitForBomTable(page);
            // 等 35s：stocks 与 usage（30s）过期，boms/categories（5min）仍新鲜
            await sleep(35_000);
            await expandGroupIfNeeded(page, "工作台");
            await page.locator('a[href="/workbench"]').first().click();
            await page.waitForSelector('section[aria-label="交付风险提醒"]');
            await sleep(600);
            // 重置计数：只观测「重进 BOM」阶段（clear 前先固化生产资源判定）
            await page.evaluate(() => {
                const names = performance.getEntriesByType("resource").map(e => e.name);
                window.__prodAssetsOk =
                    names.some(n => /\/assets\/[^/]+\.js/.test(n)) &&
                    !names.some(n => n.includes("/@vite") || n.includes("/@react-refresh") || n.includes(":5173"));
                window.__longtasks = [];
                performance.clearResourceTimings();
            });
            await expandGroupIfNeeded(page, "业务导航");
            const t1 = Date.now();
            await page.locator('a[href="/bom"]').first().click();
            // 观察重进期间行为：旧数据是否立即可见、遮罩是否出现
            const early = await page.evaluate(() => {
                const table = document.querySelector("table");
                const rows = document.querySelectorAll("table tbody tr").length;
                const overlay = !!document.querySelector('[role="status"]');
                return { hasTable: !!table, rows, overlay };
            });
            const rows1 = await waitForBomTable(page);
            const reentryMs = Date.now() - t1;
            const lateOverlay = await page.evaluate(() => !!document.querySelector('[role="status"]'));
            const counters = await collectPageCounters(page);
            const five = fiveResourceSummary(counters);
            return {
                overrides: { interactionOrLoadMs: reentryMs },
                notes: `等 35s（全局 staleTime=30s 过期、BOM 域 5min 未到）后重进 /bom：导航到表格稳定 ${reentryMs}ms，行数 ${rows0}→${rows1}。重进阶段请求：${five.lines.join("；")}——boms/bom-categories 未过期不重新请求，stocks 与 usage 三接口过期重新获取。重进瞬间采样：${early.hasTable ? `表格在文档（${early.rows} 行）` : "表格暂不在文档（路由切换的懒加载 PageLoading 阶段）"}，LoadingOverlay 遮罩 early=${early.overlay}/late=${lateOverlay}（useDelayedFlag 200ms 内完成不闪现）。`,
            };
        },
    },
    {
        id: "bom-search",
        title: "BOM 页逐键搜索（Event Timing + 结果序列判定）",
        async run({ page, base }) {
            await page.goto(`${base}/bom`, { waitUntil: "commit" });
            await waitForBomTable(page);
            const code = await page.evaluate(
                () => document.querySelector("table tbody tr td:nth-child(2) button")?.textContent?.trim() ?? "",
            );
            if (!code) throw new Error("无 BOM 编码可作搜索关键词（数据未就绪）");
            const keyword = code.slice(0, 6);
            // 注入：每键 event.timeStamp、Event Timing 条目、结果快照时间线（可见编码序列+总数）
            await page.evaluate(() => {
                window.__keys = [];
                window.__et = [];
                window.__snaps = [];
                const input = document.querySelector('input[placeholder*="BOM / 品类"]');
                const tbody = document.querySelector("table tbody");
                if (!input || !tbody) throw new Error("搜索框或表格未找到");
                const readTotal = () => {
                    const m = document.body.textContent?.match(/共 (\d+) 条/);
                    return m ? Number(m[1]) : -1;
                };
                const snap = () => ({
                    ts: performance.now(),
                    codes: [...tbody.querySelectorAll("tr td:nth-child(2) button")]
                        .map(b => b.textContent?.trim() ?? "")
                        .join(","),
                    total: readTotal(),
                });
                window.__snaps.push(snap());
                input.addEventListener("keydown", e => {
                    window.__keys.push({ index: window.__keys.length, key: e.key, ts: e.timeStamp });
                });
                try {
                    new PerformanceObserver(list => {
                        for (const en of list.getEntries()) {
                            if (en.name === "keydown") {
                                window.__et.push({
                                    startTime: en.startTime,
                                    processingStart: en.processingStart,
                                    processingEnd: en.processingEnd,
                                    duration: en.duration,
                                });
                            }
                        }
                    }).observe({ type: "event", durationThreshold: 16, buffered: true });
                } catch (err) {
                    window.__etError = String(err);
                }
                const mo = new MutationObserver(() => requestAnimationFrame(() => window.__snaps.push(snap())));
                mo.observe(tbody, { childList: true, subtree: true, characterData: true });
            });
            await page.locator('input[placeholder*="BOM / 品类"]').pressSequentially(keyword, { delay: 180 });
            await sleep(SETTLE_MS);
            const data = await page.evaluate(() => ({
                keys: window.__keys,
                et: window.__et,
                snaps: window.__snaps,
                etError: window.__etError ?? null,
            }));
            // 键 × Event Timing 绑定（startTime ≈ timeStamp，容差 1.5ms）× 结果变化分类
            const used = new Set();
            const perKey = data.keys.map((k, i) => {
                const nextTs = i + 1 < data.keys.length ? data.keys[i + 1].ts : Number.POSITIVE_INFINITY;
                let entry = null;
                for (const en of data.et) {
                    if (used.has(en)) continue;
                    if (Math.abs(en.startTime - k.ts) <= 1.5) {
                        entry = en;
                        used.add(en);
                        break;
                    }
                }
                const inWindow = data.snaps.filter(s => s.ts > k.ts && s.ts <= nextTs);
                const before = [...data.snaps].filter(s => s.ts <= k.ts).pop();
                let changed = "无窗口内更新";
                if (inWindow.length > 0 && before) {
                    const after = inWindow[inWindow.length - 1];
                    changed = after.codes !== before.codes || after.total !== before.total ? "结果变" : "结果未变";
                }
                return {
                    key: k.key,
                    status: entry ? "reported" : "not-reported",
                    interactionMs: entry ? Math.round(entry.duration * 10) / 10 : null,
                    inputDelayMs: entry ? Math.round((entry.processingStart - entry.startTime) * 10) / 10 : null,
                    processingMs: entry ? Math.round((entry.processingEnd - entry.processingStart) * 10) / 10 : null,
                    changed,
                };
            });
            const reported = perKey.filter(k => k.status === "reported");
            const max = reported.length ? Math.max(...reported.map(k => k.interactionMs)) : 0;
            const med = medianOf(reported.map(k => k.interactionMs));
            const keyLine = perKey
                .map(
                    (k, i) =>
                        `k${i + 1}"${k.key}"${k.status === "reported" ? `=${k.interactionMs}ms(延迟${k.inputDelayMs}/处理${k.processingMs})` : "=未上报"}/${k.changed}`,
                )
                .join(" ");
            return {
                overrides: { interactionOrLoadMs: max },
                notes:
                    `逐键键入「${keyword}」（${code} 前 6 字符，间隔 180ms，共 ${perKey.length} 键）。` +
                    `Event Timing（durationThreshold=16；duration=输入→下一次绘制）：${keyLine}。` +
                    `已上报 ${reported.length}/${perKey.length} 键（未上报=低于采集阈值或浏览器未报，非零填充）：max=${max}ms、中位=${med}ms。` +
                    `${data.etError ? `Event Timing 观察器异常：${data.etError}。` : ""}interactionOrLoadMs=已上报键的 max。`,
            };
        },
    },
    {
        id: "bom-usage-filter",
        title: "usage 挂起时切使用筛选（受控两遍：非空/空）",
        async run({ page, context, base }) {
            const PASSES = [
                { mode: "nonempty", option: "未使用", emptyText: "没有未使用的 BOM" },
                { mode: "empty", option: "正在使用", emptyText: "没有正在使用的 BOM" },
            ];
            const outcomes = [];
            for (let pi = 0; pi < PASSES.length; pi += 1) {
                const pass = PASSES[pi];
                let release = null;
                const gate = new Promise(r => {
                    release = r;
                });
                const patterns = ["/api/orders", "/api/inbound", "/api/outbound"].map(p => `**${p}`);
                for (const r of patterns) {
                    await context.route(r, async route => {
                        const resp = await route.fetch();
                        const body = await resp.json().catch(() => ({}));
                        // 改写为空引用集：未使用=全部 BOM（非空）、正在使用=空
                        if (Array.isArray(body.data)) body.data = [];
                        await gate;
                        await route.fulfill({ response: resp, body: JSON.stringify(body) });
                    });
                }
                const p = pi === 0 ? page : await context.newPage();
                p.setDefaultTimeout(60_000);
                try {
                    await p.goto(`${base}/bom`, { waitUntil: "commit" });
                    await waitForBomTable(p); // 表格不等 usage（初始"全部状态"）
                    await p.evaluate(() => {
                        window.__savedTable = document.querySelector("table");
                    });
                    const tSwitch = Date.now();
                    const tSwitchP = await p.evaluate(() => performance.now());
                    await p.getByLabel("按使用状态筛选").selectOption(pass.option);
                    await sleep(400);
                    const before = await p.evaluate(() => ({ hasTable: !!document.querySelector("table") }));
                    if (before.hasTable) {
                        throw new Error(
                            `${pass.mode}: 切筛选后表格仍在文档——isLoading 门控未替换表格，P7 卸载链路未复现`,
                        );
                    }
                    const tRelease = Date.now();
                    release();
                    if (pass.mode === "nonempty") {
                        await p.waitForSelector("table tbody tr td:nth-child(2) button", { timeout: 15_000 });
                    } else {
                        await p.waitForFunction(
                            text =>
                                !!document.querySelector("table") &&
                                !document.querySelector("table tbody tr td:nth-child(2) button") &&
                                (document.body.textContent ?? "").includes(text),
                            pass.emptyText,
                            { timeout: 15_000 },
                        );
                    }
                    let prev = -1;
                    for (let i = 0; i < 12; i += 1) {
                        const n = await p.evaluate(() => document.querySelectorAll("table tbody tr").length);
                        if (n === prev) break;
                        prev = n;
                        await sleep(250);
                    }
                    const tBack = Date.now();
                    const after = await p.evaluate(
                        startTs => ({
                            rows: document.querySelectorAll("table tbody tr").length,
                            sameTable: window.__savedTable === document.querySelector("table"),
                            windowLongTasks: (Array.isArray(window.__longtasks) ? window.__longtasks : [])
                                .filter(lt => lt.startTime >= startTs)
                                .map(lt => lt.duration),
                        }),
                        tSwitchP,
                    );
                    outcomes.push({
                        mode: pass.mode,
                        unmountAsserted: true,
                        tableRemounted: !after.sameTable,
                        rows: after.rows,
                        holdMs: tRelease - tSwitch,
                        processingMs: tBack - tRelease,
                        windowLongTasks: after.windowLongTasks,
                    });
                } finally {
                    for (const r of patterns) await context.unroute(r).catch(() => {});
                    if (p !== page) await p.close().catch(() => {});
                }
            }
            const a = outcomes[0];
            const b = outcomes[1];
            return {
                overrides: {
                    interactionOrLoadMs: a.processingMs,
                    tableRemounted: a.tableRemounted && b.tableRemounted,
                },
                notes:
                    `受控两遍（usage 三接口挂起，响应改写为空引用集：未使用=全部 BOM、正在使用=空）。` +
                    `pass A 非空：切「未使用」后原表格卸载断言通过；释放后重挂=${a.tableRemounted}，${a.rows} 行数据；受控 usage 等待段（切→释放，人为挂起，非真实网络耗时）${a.holdMs}ms，处理段（释放→表格回归，含解析/派生/调度/渲染）${a.processingMs}ms，窗口长任务=[${a.windowLongTasks.join(",")}]ms。` +
                    `pass B 空：切「正在使用」后卸载断言通过；释放后重挂=${b.tableRemounted}，空态「${PASSES[1].emptyText}」判定成立（${b.rows} 行占位）；等待段 ${b.holdMs}ms、处理段 ${b.processingMs}ms，窗口长任务=[${b.windowLongTasks.join(",")}]ms。` +
                    `interactionOrLoadMs=pass A 处理段。`,
            };
        },
    },
    {
        id: "bom-column-resize",
        title: "拖动列宽手柄 2 秒",
        async run({ page, base }) {
            await page.goto(`${base}/bom`, { waitUntil: "commit" });
            await waitForBomTable(page);
            const handle = page.locator('[aria-label="调整物料构成列宽"]');
            await handle.waitFor({ timeout: 20_000 });
            const box = await handle.boundingBox();
            if (!box) throw new Error("列宽手柄不可见");
            await page.evaluate(() => {
                window.__raf.intervals = [];
                window.__raf.recording = true;
            });
            const cx = box.x + box.width / 2;
            const cy = box.y + box.height / 2;
            await page.mouse.move(cx, cy);
            await page.mouse.down();
            const t0 = Date.now();
            let dx = 0;
            // 约 2 秒连续拖动：每 40ms 一步、每步 +6px（含小幅往返回退更接近真实手势）
            while (Date.now() - t0 < 2000) {
                dx += 6;
                const wobble = Math.sin(dx / 30) * 3;
                await page.mouse.move(cx + dx + wobble, cy, { steps: 1 });
                await sleep(40);
            }
            await page.mouse.up();
            const dragMs = Date.now() - t0;
            await page.evaluate(() => {
                window.__raf.recording = false;
            });
            await sleep(400);
            const raf = await page.evaluate(() => window.__raf.intervals);
            const stats = frameStats(raf);
            return {
                overrides: { interactionOrLoadMs: dragMs },
                notes: `拖动「物料构成」列宽手柄 ${dragMs}ms（每 40ms 一步）。rAF 帧间隔：${stats.summary}；掉帧估算 ${stats.dropped} 帧（帧间隔>25ms 计一次掉帧，${stats.slow} 次慢帧）。`,
            };
        },
    },
    {
        id: "inbound-bom-picker",
        title: "入库页打开 BOM 选择器并选最大品类",
        async run({ page, base, opts }) {
            const topCategory = opts.topCategory;
            if (!topCategory) throw new Error("缺少品类分布数据（topCategory）");
            // 入库列表先加载（弹窗与列表共用 wb 快照缓存，BOM 选择器打开时品类立即可选）
            await page.goto(`${base}/inbound`, { waitUntil: "commit" });
            await page.waitForSelector("table tbody tr td", { timeout: 45_000 });
            await page.waitForLoadState("networkidle");
            // 打开新建入库弹窗（= 打开 BOM 选择器）
            const t0 = Date.now();
            await page.getByRole("button", { name: "检验入库" }).click();
            const dialog = page.locator('[role="dialog"]');
            await dialog.waitFor({ timeout: 20_000 });
            // 品类下拉可用（SelectMenuField trigger，aria-labelledby 指向「品类」label）
            const categoryTrigger = dialog.getByRole("button", { name: /品类/ }).first();
            await categoryTrigger.waitFor({ timeout: 20_000 });
            const openMs = Date.now() - t0;
            // 选匹配数最多的品类：radix DropdownMenu（trigger + menuitem）
            const t1 = Date.now();
            await categoryTrigger.click();
            const menuItem = page.getByRole("menuitemradio", { name: topCategory.name, exact: true });
            await menuItem.waitFor({ timeout: 15_000 });
            await menuItem.click();
            // BomPicker 选项列表渲染完成（"共 N 条 BOM 可选" + 选项按钮）
            await page.waitForFunction(
                n => {
                    const dialog2 = document.querySelector('[role="dialog"]');
                    if (!dialog2) return false;
                    const counter = [...dialog2.querySelectorAll("p")].find(p =>
                        p.textContent?.includes("条 BOM 可选"),
                    );
                    return !!counter && Number(counter.textContent.match(/共 (\d+) 条/)?.[1] ?? 0) === n;
                },
                topCategory.count,
                { timeout: 30_000 },
            );
            const pickMs = Date.now() - t1;
            const dom = await page.evaluate(() => {
                const d = document.querySelector('[role="dialog"]');
                const list = [...d.querySelectorAll("div")].find(div => div.className.includes("max-h-60"));
                return {
                    optionButtons: list ? list.querySelectorAll("button").length : -1,
                    totalButtons: d.querySelectorAll("button").length,
                };
            });
            return {
                overrides: { interactionOrLoadMs: openMs },
                notes: `入库列表加载后点「检验入库」打开新建入库弹窗（BOM 选择器）到品类下拉可用 ${openMs}ms（弹窗与列表共用 wb 快照缓存）。点品类下拉选最大品类「${topCategory.name}」（${topCategory.count} 条 BOM，全部品类分布：${opts.categoryDist}）到 BomPicker 选项渲染完成 ${pickMs}ms；选项 DOM：候选按钮 ${dom.optionButtons} 个（弹窗内按钮总数 ${dom.totalButtons}）。`,
            };
        },
    },
    {
        id: "orders-page",
        title: "订单页冷加载 + 切可发货筛选",
        async run({ page, base }) {
            const t0 = Date.now();
            await page.goto(`${base}/orders`, { waitUntil: "commit" });
            await page.waitForSelector(".table-task-tabs button", { timeout: 45_000 });
            await page.waitForSelector("table tbody tr td", { timeout: 45_000 });
            await page.waitForLoadState("networkidle");
            const loadMs = Date.now() - t0;
            const rowsAll = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
            const t1 = Date.now();
            await page.locator(".table-task-tabs button", { hasText: "可发货" }).click();
            await page.waitForSelector('.table-task-tabs button[aria-pressed="true"]:has-text("可发货")');
            // 行数变化或稳定
            let prev = -1;
            for (let i = 0; i < 24; i++) {
                const n = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
                if (n === prev) break;
                prev = n;
                await sleep(250);
            }
            const switchMs = Date.now() - t1;
            const readyCount = await page
                .locator(".table-task-tabs button", { hasText: "可发货" })
                .locator("strong")
                .textContent()
                .catch(() => "?");
            const rowsReady = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
            return {
                overrides: { interactionOrLoadMs: loadMs },
                notes: `订单页冷加载（含 wb 聚合快照）到表格稳定 ${loadMs}ms，全部行 ${rowsAll}。切「可发货」tab 到行数稳定 ${switchMs}ms，ready 计数 ${readyCount?.trim()}，行数 ${rowsReady}（interactionOrLoadMs 为冷加载耗时；切换耗时见本 notes）。`,
            };
        },
    },
    {
        id: "bom-layout-pair",
        title: "P4 配对：单分支 vs 双分支（同一 dist-exp 实验构建，开关首渲染前设置）",
        requires: "single-layout-build",
        outer: "none",
        async run({ browser, base, storageState }) {
            const runArm = async (single, armFirst) => {
                const context = await browser.newContext({ viewport: VIEWPORT, storageState });
                await context.addInitScript(`window.__singleLayout = ${single};`);
                const p = await context.newPage();
                p.setDefaultTimeout(60_000);
                const t0 = Date.now();
                await p.goto(`${base}/bom`, { waitUntil: "commit" });
                await waitForBomTable(p);
                const loadMs = Date.now() - t0;
                const domNodes10 = await p.evaluate(() => document.querySelectorAll("*").length);
                if (single) {
                    const mobile = await p.evaluate(() => !!document.querySelector(".mobile-records"));
                    if (mobile)
                        throw new Error(
                            "__singleLayout 未生效：移动分支仍挂载（需 dist-exp 构建且 addInitScript 在首渲染前设置）",
                        );
                }
                // 切每页 50 条（分页 select 含 option 10/30/50）
                const sel = p
                    .locator("select")
                    .filter({ has: p.locator('option[value="50"]') })
                    .first();
                const t1 = Date.now();
                await sel.selectOption("50");
                await p
                    .waitForFunction(() => document.querySelectorAll("table tbody tr").length >= 50, null, {
                        timeout: 20_000,
                    })
                    .catch(() => {});
                let prev = -1;
                for (let i = 0; i < 12; i += 1) {
                    const n = await p.evaluate(() => document.querySelectorAll("table tbody tr").length);
                    if (n === prev) break;
                    prev = n;
                    await sleep(200);
                }
                const update50Ms = Date.now() - t1;
                const domNodes50 = await p.evaluate(() => document.querySelectorAll("*").length);
                await context.close().catch(() => {});
                return { armFirst, loadMs, domNodes10, update50Ms, domNodes50 };
            };
            const pairs = [];
            for (let i = 0; i < 5; i += 1) {
                const singleFirst = i % 2 === 0;
                const single = await runArm(true, singleFirst ? 1 : 2);
                const dual = await runArm(false, singleFirst ? 2 : 1);
                pairs.push({
                    pair: i + 1,
                    dLoadMs: dual.loadMs - single.loadMs,
                    dUpdate50Ms: dual.update50Ms - single.update50Ms,
                    dDomNodes: dual.domNodes50 - single.domNodes50,
                    single,
                    dual,
                });
                await sleep(400);
            }
            const dLoads = pairs.map(p => p.dLoadMs);
            const dUpdates = pairs.map(p => p.dUpdate50Ms);
            const loadSpread = Math.max(...pairs.map(p => p.dual.loadMs)) - Math.min(...pairs.map(p => p.dual.loadMs));
            return {
                overrides: { interactionOrLoadMs: medianOf(dLoads) },
                notes:
                    `同一 dist-exp 构建、开关经 addInitScript 在首渲染前设置、single/dual 交替先行共 5 对。` +
                    `每对差值（dual−single）：冷挂载 dLoad=[${dLoads.join(",")}]ms（中位 ${medianOf(dLoads)}ms），pageSize50 更新 dUpdate50=[${dUpdates.join(",")}]ms（中位 ${medianOf(dUpdates)}ms），DOM 节点差（每页50）=[${pairs.map(p => p.dDomNodes).join(",")}]。` +
                    `dual 臂冷挂载轮间极差 ${loadSpread}ms（噪声量级参考：与其同量级的差值中位应视为未检出稳定收益）。` +
                    `明细 per-pair：${pairs.map(p => `#${p.pair} single(load=${p.single.loadMs},up50=${p.single.update50Ms}) dual(load=${p.dual.loadMs},up50=${p.dual.update50Ms})`).join("；")}。`,
            };
        },
    },
];

function frameStats(intervals) {
    if (!intervals || intervals.length === 0) return { summary: "无帧间隔样本", dropped: 0, slow: 0 };
    const sorted = [...intervals].sort((a, b) => a - b);
    const pct = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const slow = intervals.filter(v => v > 25).length;
    const dropped = intervals.reduce((s, v) => s + (v > 25 ? Math.max(1, Math.round(v / 16.7) - 1) : 0), 0);
    const summary = `n=${intervals.length} min=${sorted[0].toFixed(1)} p50=${pct(0.5).toFixed(1)} p95=${pct(0.95).toFixed(1)} max=${sorted[sorted.length - 1].toFixed(1)}ms（60fps 帧预算 16.7ms）`;
    return { summary, dropped, slow };
}

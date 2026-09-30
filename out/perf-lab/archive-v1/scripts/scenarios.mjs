/* 8 个性能场景。每个场景：独立干净 context（仅带登录 token 的 storageState，
 * 业务 localStorage 如表格列宽偏好全部为空 = 清空存储）→ CDP Tracing →
 * 场景动作 → 稳定 → 汇总指标。 */
import { INIT_SCRIPT, collectPageCounters, summarizeCounters, assertProductionAssets, Tracer } from "./metrics.mjs";

const VIEWPORT = { width: 1280, height: 800 };
const SETTLE_MS = 1200;

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    await page.waitForSelector(`table tbody tr td:nth-child(2) button`, { timeout });
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
        layoutMs: 0,
        paintMs: 0,
        scriptMs: 0,
        domNodes: 0,
        tableRemounted: null,
        notes: "",
    };
}

/** 统一跑一个场景（含指标收集） */
export async function runScenario(browser, base, storageState, def, opts = {}) {
    const context = await browser.newContext({ viewport: VIEWPORT, storageState });
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const tracer = new Tracer(page);
    const result = baseResult(def.id);
    try {
        await tracer.start();
        const detail = (await def.run({ page, context, base, opts })) ?? {};
        await sleep(SETTLE_MS);
        const counters = await collectPageCounters(page);
        await assertProductionAssets(counters, def.id);
        Object.assign(result, summarizeCounters(counters), detail.overrides ?? {});
        result.notes = [detail.notes ?? "", detail.extraNotes ?? ""].filter(Boolean).join(" ");
        result.ok = true;
    } catch (err) {
        result.ok = false;
        result.notes = `场景失败：${err.message?.slice(0, 400)}`;
    } finally {
        const trace = await tracer.stop().catch(err => ({ layoutMs: 0, paintMs: 0, scriptMs: 0, error: err.message }));
        if (result.ok) {
            result.layoutMs = trace.layoutMs ?? 0;
            result.paintMs = trace.paintMs ?? 0;
            result.scriptMs = trace.scriptMs ?? 0;
        }
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
                notes: `工作台冷加载 ${wbLoadMs}ms（含 wb 聚合快照 9 接口并发）；侧边栏导航到 BOM 表格稳定 ${navMs}ms，数据行 ${rows}。五类资源明细：${five.lines.join("；")}。与工作台快照 queryKey 不同（["wb",…] vs ["boms",…]），${dup.length ? `重复请求：${dup.join("、")}` : "无重复请求"}。`,
            };
        },
    },
    {
        id: "bom-refresh-stale",
        title: "BOM 页等 staleTime 过期后重进",
        async run({ page, base }) {
            await page.goto(`${base}/bom`, { waitUntil: "commit" });
            const rows0 = await waitForBomTable(page);
            // 全局 staleTime 30s（src/main.tsx:13）；BOM 列表/品类 5min（src/data/queries.ts:60 BOM_STALE_MS）
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
        title: "BOM 页逐键搜索",
        async run({ page, base }) {
            await page.goto(`${base}/bom`, { waitUntil: "commit" });
            await waitForBomTable(page);
            const code = await page.evaluate(
                () => document.querySelector("table tbody tr td:nth-child(2) button")?.textContent?.trim() ?? "",
            );
            if (!code) throw new Error("无 BOM 编码可作搜索关键词（数据未就绪）");
            const keyword = code.slice(0, 6);
            // 注入每键响应计时：keydown → tbody 首次 DOM 变更（React 对离散输入同步 flush）
            await page.evaluate(() => {
                window.__keyDelays = [];
                const input = document.querySelector('input[placeholder*="BOM / 品类"]');
                const tbody = document.querySelector("table tbody");
                if (!input || !tbody) throw new Error("搜索框或表格未找到");
                let pending = false;
                input.addEventListener("keydown", () => {
                    if (pending) return;
                    pending = true;
                    const t0 = performance.now();
                    let done = false;
                    const mo = new MutationObserver(() => {
                        if (done) return;
                        done = true;
                        pending = false;
                        mo.disconnect();
                        window.__keyDelays.push(Math.round((performance.now() - t0) * 10) / 10);
                    });
                    mo.observe(tbody, { childList: true, subtree: true, characterData: true });
                    setTimeout(() => {
                        if (!done) {
                            done = true;
                            pending = false;
                            mo.disconnect();
                            window.__keyDelays.push(null);
                        }
                    }, 800);
                });
            });
            const rowsBefore = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
            await page.locator('input[placeholder*="BOM / 品类"]').pressSequentially(keyword, { delay: 180 });
            await sleep(SETTLE_MS);
            const delays = await page.evaluate(() => window.__keyDelays);
            const rowsAfter = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
            const applied = delays.filter(d => typeof d === "number");
            if (applied.length === 0) throw new Error("逐键响应未捕获到任何 DOM 更新");
            const max = Math.max(...applied);
            const avg = Math.round((applied.reduce((s, v) => s + v, 0) / applied.length) * 10) / 10;
            return {
                overrides: { interactionOrLoadMs: max },
                notes: `逐键键入「${keyword}」（${code} 前 6 字符，每键间隔 180ms，共 ${keyword.length} 键）：捕获到 ${applied.length} 次键响应，keydown→tbody 首次变更延迟 ms=[${delays.join(",")}]（null=800ms 内无可见变更；部分键因前一键观测窗口未关闭未单独计时），max=${max}、avg=${avg}；行数 ${rowsBefore}→${rowsAfter}。interactionOrLoadMs 取每键最大响应延迟。`,
            };
        },
    },
    {
        id: "bom-usage-filter",
        title: "usage 依赖延迟 3s 下切未使用筛选",
        async run({ page, context, base }) {
            // 路由拦截：usage 依赖的三个接口人为延迟 3s
            await context.route("**/api/orders", async route => {
                await sleep(3000);
                await route.continue();
            });
            await context.route("**/api/inbound", async route => {
                await sleep(3000);
                await route.continue();
            });
            await context.route("**/api/outbound", async route => {
                await sleep(3000);
                await route.continue();
            });
            await page.goto(`${base}/bom`, { waitUntil: "commit" });
            const rows0 = await waitForBomTable(page); // 表格不等 usage（初始筛选"全部状态"）
            // 表格已显示：保存 table 元素引用，供 usage 到达后判同一性
            await page.evaluate(() => {
                window.__savedTable = document.querySelector("table");
                window.__savedRows = document.querySelectorAll("table tbody tr").length;
            });
            const t0 = Date.now();
            await page.getByLabel("按使用状态筛选").selectOption("未使用");
            // 切换后、usage 到达前的瞬时行为：unusedCodes 为空集（usageLoaded=false）
            // →「未使用」筛选下 0 行（EmptyRow），且 isLoading=true 会让整表换 PageLoading 占位
            await sleep(400);
            const beforeUsage = await page.evaluate(() => ({
                rows: document.querySelectorAll("table tbody tr").length,
                hasTable: !!document.querySelector("table"),
                sameTable: window.__savedTable === document.querySelector("table"),
                pageLoading: !!document.querySelector(".animate-pulse, [class*='PageLoading']"),
            }));
            // 等 usage 到达并应用：未使用数据行（td:nth-child(2) 有 BOM 编码按钮）出现且行数稳定
            await page.waitForSelector("table tbody tr td:nth-child(2) button", { timeout: 20_000 }).catch(() => {});
            let prev = -1;
            for (let i = 0; i < 24; i++) {
                const n = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
                if (n === prev) break;
                prev = n;
                await sleep(250);
            }
            const after = await page.evaluate(() => ({
                rows: document.querySelectorAll("table tbody tr").length,
                sameTable: window.__savedTable === document.querySelector("table"),
            }));
            const totalMs = Date.now() - t0;
            const remounted = !after.sameTable;
            return {
                overrides: { interactionOrLoadMs: totalMs, tableRemounted: remounted },
                notes: `usage 三接口（/orders /inbound /outbound）被人为延迟 3s。表格先于 usage 显示（${rows0} 行数据，依赖 boms/categories/stocks）。切「未使用」后 400ms 时：usage 未到（unusedCodes 空集）显示 ${beforeUsage.rows} 行、${beforeUsage.hasTable ? "table 仍在文档" : "table 已从文档消失（isLoading 占位替换）"}、与切换前 table 元素${beforeUsage.sameTable ? "同一实例" : "不同实例"}；usage 到达应用后 ${after.rows} 行未使用数据，table 元素${remounted ? "与切换前不同实例 → 卸载重挂（tableRemounted=true）" : "与切换前同一实例（tableRemounted=false）"}。切换到行数稳定总耗时 ${totalMs}ms（usage 请求从页面加载即发出并被延迟 3s，故此值 ≈ 3s − 表格先就绪的时间 + 渲染）。`,
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

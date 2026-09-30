/* 端到端性能轨迹 sweep 入口。
 * 用法：node out/perf-lab/run-sweep.mjs --checkpoint <label> --out <path>
 *
 * 栈：真实后端（apps/backend/dist，DB_DATABASE=zmdb_test，cwd=仓库根读 .env）
 *   + 自写静态/反代服务（apps/frontend/dist + /api → 127.0.0.1:5000）
 *   + 系统 Chrome（playwright-core，executablePath 指向本机 Chrome）。
 * 输出契约：{"checkpoint","resultsPath","scenarios":[8 个场景],"envNotes"}（UTF-8 JSON）。
 * 单场景失败标 ok:false 并继续；栈起不来才 exit 非 0；每场景最多重试 2 次。 */
import { writeFileSync, mkdirSync, renameSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Stack, REPO, CHROME_PATH, FRONTEND_DIST } from "./stack.mjs";
import { SCENARIOS, runScenario } from "./scenarios.mjs";
import { Api, seedBusinessData } from "./seed-data.mjs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const CHECKPOINT = args.get("--checkpoint");
const OUT = args.get("--out");
if (!CHECKPOINT || !OUT) {
    console.error("usage: node run-sweep.mjs --checkpoint <label> --out <path.json>");
    process.exit(2);
}

const log = msg => console.log(`[perf-lab] ${new Date().toISOString().slice(11, 19)} ${msg}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const stack = new Stack();
let exitCode = 0;

try {
    log("启动后端（DB_DATABASE=zmdb_test）…");
    await stack.startBackend();
    log("启动静态 + /api 反代服务…");
    await stack.startStatic();
    log(`静态服务 ${stack.baseUrl}（dist=${FRONTEND_DIST}）`);
    log("启动系统 Chrome…");
    await stack.startBrowser();

    // API 侧登录（等价 UI 登录结果：同一 POST /api/auth/login），构造只含 token 的 storageState
    const loginRes = await fetch("http://127.0.0.1:5000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: "guojun", password: "123456" }),
    }).then(r => r.json());
    if (!loginRes?.data?.accessToken) throw new Error(`登录失败：${JSON.stringify(loginRes).slice(0, 200)}`);
    const storageState = {
        cookies: [],
        origins: [
            {
                origin: stack.baseUrl,
                localStorage: [{ name: "zm-token", value: loginRes.data.accessToken }],
            },
        ],
    };

    // 业务数据补足（reset 后 zmdb_test 业务表为空）
    const api = new Api("http://127.0.0.1:5000", loginRes.data.accessToken);
    const seedReport = await seedBusinessData(api, m => log(`seed: ${m}`));

    // 品类分布（场景 7 选最大品类）
    const boms = await api.get("/boms");
    const dist = new Map();
    for (const bom of boms) dist.set(bom.name, (dist.get(bom.name) ?? 0) + 1);
    const topCategory = [...dist.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)[0];
    const categoryDist = [...dist.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([n, c]) => `${n}:${c}`)
        .join(",");

    // 预热：正式采样前空转一次（完整加载一次 BOM 页，丢弃）
    log("预热空转（丢弃）…");
    const warmupResult = await runScenario(
        stack.browser,
        stack.baseUrl,
        storageState,
        {
            id: "warmup",
            run: async ({ page, base }) => {
                await page.goto(`${base}/bom`, { waitUntil: "commit" });
                await page.waitForSelector('table thead th[aria-label="BOM 编码"]', { timeout: 60_000 });
                await page.waitForSelector("table tbody tr td:nth-child(2) button", { timeout: 60_000 });
            },
        },
        {},
    );
    if (!warmupResult.ok) log(`warn: 预热未完全成功（${warmupResult.notes}），继续正式采样`);
    await sleep(1000);

    const results = [];
    const only = process.env.PERF_LAB_ONLY ? process.env.PERF_LAB_ONLY.split(",").map(s => s.trim()) : null;
    for (const def of SCENARIOS) {
        if (only && !only.includes(def.id)) continue;
        const opts = def.id === "inbound-bom-picker" ? { topCategory, categoryDist } : {};
        let result = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            log(`场景 ${def.id}（第 ${attempt} 次尝试）…`);
            result = await runScenario(stack.browser, stack.baseUrl, storageState, def, opts);
            if (result.ok) break;
            log(`场景 ${def.id} 失败：${result.notes}`);
        }
        if (result.ok) {
            log(
                `场景 ${def.id} 完成：load/interaction=${result.interactionOrLoadMs}ms requests=${result.requestCount} transfer=${(result.transferBytes / 1024).toFixed(0)}KB longTask=${result.longTaskCount} dom=${result.domNodes}`,
            );
        }
        results.push(result);
        await sleep(800);
    }

    const envNotes = [
        `视口固定 1280×800（playwright viewport），有头系统 Chrome（${CHROME_PATH}），独立临时 profile。`,
        `前端为生产构建 apps/frontend/dist（每场景断言资源含 /assets/*.js 且无 vite dev client）；静态+API 反代为自写 node:http 服务（out/perf-lab/server.mjs），静态文本资源按 Accept-Encoding 提供 gzip（对齐生产 nginx），API 响应原样透传（后端未注册压缩，生产若经 nginx 压缩 API 字节会小于本次 transferBytes）。`,
        `实测 vite 8 的 vite preview 会继承 server.proxy（curl /api/health/ready 经 preview 返回 200），但 preview 进程树经 pnpm 包装不利于干净清理，故用自写服务。`,
        `后端为编译产物 apps/backend/dist/main.js（cwd=仓库根，env DB_DATABASE=zmdb_test 覆盖 .env——已实测 bogus 库名时 /api/health/ready 返回 503 证明覆盖生效），非 watch 模式。`,
        `数据：pnpm test:db:reset 后由 harness 经真实 API 补足业务数据（BOM≥60、订单≥40、客户3、配套入库/出库，幂等补足），本次 seed=${JSON.stringify(seedReport.summary)}。`,
        `认证：API 登录（同一 POST /api/auth/login）后构造仅含 zm-token 的 storageState 注入 context；业务 localStorage（表格列宽/主题偏好等）每场景均为空 = 清空存储。`,
        `staleTime 依据 src/main.tsx:13（全局 30s）与 src/data/queries.ts:60（BOM 列表/品类 5min）。`,
        `指标口径：requestCount=导航文档+资源条目数；transferBytes=performance transferSize 之和（含响应头）；apiTimings=按耗时降序前 8 个 /api 请求（ms=resource duration，bytes=encodedBodySize）；longtask=页面注入 PerformanceObserver；layoutMs/paintMs/scriptMs=CDP Tracing devtools.timeline 事件按名称聚合（Layout/UpdateLayoutTree/RecalculateStyles/ParseHTML→layout；Paint/UpdateLayerTree/CompositeLayers 等→paint；FunctionCall/EvaluateScript/TimerFire/EventDispatch/GC 等→script）；domNodes=稳定后 document.querySelectorAll("*").length。`,
        `每场景独立干净 context；正式采样前完整加载一次 BOM 页做预热（丢弃）；测量期间无其它并行负载（栈内仅被测进程）。`,
        `场景 5 的 /orders /inbound /outbound 被 context.route 人为延迟 3s（route.fulfill 未用，透传真实后端响应）；场景 6 掉帧=rAF 间隔>25ms 的估算——本机 Chrome 有头窗口 rAF 间隔实测 p50≈6ms（未与显示 vsync 对齐），故不用 16.7ms 帧预算口径，>25ms 才计慢帧。`,
        `局限：transferBytes 受自写反代 gzip 影响（静态资源与生产 nginx 压缩口径接近，API 未压缩）；longtask 阈值 50ms 为浏览器标准；CDP Tracing 的 layout/paint/script 聚合含页面全程（含登录后 token 校验与初始渲染），按事件名称归类为近似口径；场景重试上限 3 次（初次+2 重试）。`,
    ].join("\n");

    const payload = { checkpoint: CHECKPOINT, resultsPath: path.resolve(OUT), scenarios: results, envNotes };
    mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    const tmp = `${OUT}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    renameSync(tmp, OUT);
    log(`已写入 ${OUT}（${results.filter(r => r.ok).length}/${results.length} 场景成功）`);
} catch (err) {
    exitCode = 1;
    console.error(`[perf-lab] 栈级失败：${err.message}`);
    const dump = path.resolve(`${OUT}.stack-failure.log`);
    try {
        mkdirSync(path.dirname(dump), { recursive: true });
        writeFileSync(
            dump,
            `${err.stack ?? err.message}\n\n--- backend log ---\n${stack.logs.backend.join("").slice(-8000)}\n\n--- static log ---\n${stack.logs.static.join("").slice(-4000)}`,
            "utf8",
        );
        console.error(`[perf-lab] 日志转储 ${dump}`);
    } catch {
        /* 转储失败不掩盖原始错误 */
    }
    // 仍写出失败 JSON（字段尽量齐备）便于下游看到失败原因
    try {
        const payload = {
            checkpoint: CHECKPOINT,
            resultsPath: path.resolve(OUT),
            scenarios: [],
            envNotes: `栈级失败：${err.message}`,
        };
        writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
    } catch {
        /* 忽略 */
    }
} finally {
    const cleanupReport = await stack.cleanup();
    log(
        `清理：${cleanupReport.killed.join("、") || "无进程"}；残留：${cleanupReport.leftovers.length ? cleanupReport.leftovers.join("；") : "无"}`,
    );
    if (cleanupReport.leftovers.length) exitCode = exitCode || 1;
}
process.exit(exitCode);

// @vitest-environment jsdom
/* 前端主线程纯计算成本微基准（对应 out/perf-lab/original-report.md §2/§3）：
 * - p2-ready-counts  按订单数 N 等价复走 OrdersPage counts.ready 派生路径（apps/frontend/src/data/views.ts）：
 *                    每个活跃订单各调一次真实 maxShipOf，内部完整执行 readyToShip（过滤+排序+BOM 线性查找+find）。
 * - p5-search-filter 挂真实 BomPage（apps/frontend/src/pages/bom/BomPage.tsx filtered useMemo），
 *                    关键词从空变非空触发检索文本重建，用 React Profiler actualDuration(update) 计时。
 * - p6-page-summary  N 条 BOM 数据池按 10/50 一页挂载真实 BomCell（apps/frontend/src/components/bom/BomCell.tsx，
 *                    内部执行真实 bomComposition/bomSummary）。
 * - picker-mount     真实 BomPicker 传入 M 条匹配项的一次性全量挂载（apps/frontend/src/components/bom/BomPicker.tsx）。
 * 组件与计算全部 import 真实源码，仅数据层 hook 按现有 test/pages/bom/BomPage.test.tsx 的 provider/mock 写法注入内存数据。
 * 合成数据形状按 out/perf-lab/volume.json：BOM 明细 7–15 条（均值≈11，口径 avgBomItems=10.8/max 15/min 7）、
 * 订单:BOM≈1:1（1x≈40）、品类 9（含跌倒开关组合品类与 2 个目录容器子品类）、客户 20；纯内存对象，不接数据库。
 * 梯度 N ∈ {40, 400, 2000, 4000, 10000}；p2/p5 为 2 预热 + 9 计时轮、p6/picker/p6-update 为 1 次预热 + 9 计时轮，取中位数；单档预估超 30s 预算自动跳过。
 * 结果写 out/perf-lab/micro.json 并在 bench 控制台输出同样数据。本文件命名 *.bench.ts，不被普通 vitest run 拾取。 */
import { act, createElement as h, Profiler, type ProfilerOnRenderCallback } from "react";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { BomPage } from "@/pages/bom/BomPage";
import { BomCell } from "@/components/bom/BomCell";
import { BomPicker } from "@/components/bom/BomPicker";
import { EMPTY_SNAPSHOT, maxShipOf } from "@/data/views";
import { addDays, todayIso } from "@/lib/date";
import type { Bom, BomCategory, BomItemView, Order, Snapshot } from "@/api";

/* ---------- 数据层 mock：与 test/pages/bom/BomPage.test.tsx 同款，只替换 hook 返回的内存数据 ---------- */
const bomsRef = vi.hoisted(() => ({ current: undefined as Bom[] | undefined }));
const catalogRef = vi.hoisted(() => ({ current: undefined as BomCategory[] | undefined }));
const stocksRef = vi.hoisted(() => ({ current: undefined as Record<string, number> | undefined }));
const usageRef = vi.hoisted(() => ({
    current: undefined as
        | {
              orders: Array<{ bomCode: string }>;
              inboundLedger: Array<{ bomCode: string }>;
              outboundLedger: Array<{ bomCode: string }>;
          }
        | undefined,
}));
/** usage 更新控制：p6-page-update 用它模拟「usage 数据到达」触发 BomPage 父级更新 */
const usageControls = vi.hoisted(() => ({ current: undefined as ((d: unknown) => void) | undefined }));
vi.mock("@/context/useApp", () => ({ useApp: () => ({ role: "staff", can: () => false }) }));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => vi.fn() }));
vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn().mockResolvedValue(true) }));
vi.mock("@/data/queries", async () => {
    const { useState } = await import("react");
    return {
        useBoms: () => ({ data: bomsRef.current ?? [], isLoading: false, isFetching: false }),
        useBomCategories: () => ({ data: catalogRef.current ?? [], isLoading: false, isFetching: false }),
        useBomStocks: () => ({ data: stocksRef.current, isLoading: false, isFetching: false }),
        useBomUsage: () => {
            const [data, setData] = useState(() => usageRef.current);
            usageControls.current = setData as (d: unknown) => void;
            return {
                data,
                isLoading: data === undefined,
                isFetching: false,
                isError: false,
            };
        },
        useBomRefresh: () => ({ refresh: vi.fn() }),
        useCreateBom: () => ({ mutate: vi.fn(), isPending: false }),
        useDeleteBom: () => ({ mutate: vi.fn(), isPending: false }),
    };
});

/* ---------- 合成数据（形状保真 volume.json，seeded RNG 可复现） ---------- */
interface GroupDef {
    key: string;
    name: string;
    options: string[];
    qty?: boolean;
}
interface CategoryDef {
    name: string;
    prefix: string;
    /** 目录容器品类（status=false）：仅随目录下发供 childCategories 合并树，不建档 */
    container?: boolean;
    /** 组合品类（跌倒开关）：childCategories 指向目录容器品类 key（cat-<prefix>） */
    children?: string[];
    groups: GroupDef[];
}

const CATEGORY_DEFS: CategoryDef[] = [
    {
        name: "旋转XK2",
        prefix: "XK2",
        groups: [
            { key: "model", name: "型号", options: ["XK2-101", "XK2-205", "XK2-310"] },
            { key: "spec", name: "规格", options: ["标准", "加强型"] },
            { key: "direction", name: "方向", options: ["左向", "右向"] },
            { key: "base", name: "底座", options: ["二脚底座（无挡脚）", "三脚底座（带挡脚）", "焊线底座"] },
            { key: "cover", name: "盖子", options: ["盖子", "带孔盖子"] },
            { key: "button", name: "按钮", options: ["8.5mm", "12mm", "圆钮 7mm"] },
            { key: "bracket", name: "支架", options: ["6.3支架：铜镀银", "6.3支架：镀锡", "4.5支架：铜镀银"] },
            { key: "static-plate", name: "静片", options: ["6.3静片：铜镀银", "6.3静片：镀锡"], qty: true },
            { key: "contact-kind", name: "触点类型", options: ["银点", "镀金点"] },
            { key: "contact-size", name: "触点规格", options: ["0.5A", "1A", "3A"] },
        ],
    },
    {
        name: "旋转XK3",
        prefix: "XK3",
        groups: [
            { key: "model", name: "型号", options: ["XK3-110", "XK3-220"] },
            { key: "spec", name: "规格", options: ["标准", "加强型"] },
            { key: "pc-shell", name: "面壳", options: ["PC 面壳：透明", "PC 面壳：乳白"] },
            { key: "pc-base", name: "底壳", options: ["PA 底壳", "PC 底壳"] },
            { key: "pa66-lever", name: "扳机", options: ["PA66 扳机", "PA66 加长扳机"] },
            { key: "base", name: "底座", options: ["焊线底座", "插线底座"] },
            { key: "cover", name: "盖子", options: ["盖子"] },
            { key: "button", name: "按钮", options: ["12mm", "圆钮 7mm"] },
            { key: "bracket", name: "支架", options: ["6.3支架：镀锡"] },
            { key: "static-plate", name: "静片", options: ["6.3静片：镀锡"], qty: true },
            { key: "contact-size", name: "触点规格", options: ["1A", "3A"] },
        ],
    },
    {
        name: "新微动",
        prefix: "KW",
        groups: [
            { key: "base", name: "底座", options: ["二脚底座（无挡脚）", "三脚底座（带挡脚）"] },
            { key: "button", name: "按钮", options: ["8.5mm", "12mm"] },
            { key: "contact-kind", name: "触点类型", options: ["银点", "镀金点"] },
            { key: "cover", name: "盖子", options: ["盖子", "带孔盖子"] },
            { key: "bracket", name: "支架", options: ["6.3支架：铜镀银", "4.5支架：铜镀银"] },
            { key: "static-plate", name: "静片", options: ["6.3静片：铜镀银"], qty: true },
            { key: "spec", name: "规格", options: ["标准", "加强型"] },
            { key: "direction", name: "方向", options: ["左向", "右向"] },
            { key: "contact-size", name: "触点规格", options: ["0.5A", "1A"] },
            { key: "model", name: "型号", options: ["KW-500", "KW-800"] },
        ],
    },
    {
        name: "老微动",
        prefix: "KWO",
        groups: [
            { key: "base", name: "底座", options: ["二脚底座（无挡脚）"] },
            { key: "button", name: "按钮", options: ["8.5mm"] },
            { key: "contact-kind", name: "触点类型", options: ["银点"] },
            { key: "cover", name: "盖子", options: ["盖子"] },
            { key: "bracket", name: "支架", options: ["6.3支架：铜镀银"] },
            { key: "static-plate", name: "静片", options: ["6.3静片：铜镀银"], qty: true },
            { key: "spec", name: "规格", options: ["标准"] },
        ],
    },
    {
        name: "安全开关",
        prefix: "AQ",
        groups: [
            { key: "pc-shell", name: "面壳", options: ["PC 面壳：透明", "PC 面壳：乳白"] },
            { key: "contact-kind", name: "触点类型", options: ["银点", "镀金点"] },
            { key: "contact-size", name: "触点规格", options: ["0.5A", "1A", "3A"] },
            { key: "base", name: "底座", options: ["三脚底座（带挡脚）", "焊线底座"] },
            { key: "cover", name: "盖子", options: ["盖子"] },
            { key: "button", name: "按钮", options: ["圆钮 7mm"] },
            { key: "spec", name: "规格", options: ["标准", "加强型"] },
            { key: "model", name: "型号", options: ["AQ-100", "AQ-200"] },
        ],
    },
    {
        name: "跌倒开关",
        prefix: "KD",
        children: ["cat-WDA", "cat-WDB"],
        groups: [
            { key: "tipover-cover", name: "跌倒盖", options: ["跌倒开关上盖", "跌倒开关侧盖"] },
            { key: "base", name: "底座", options: ["跌倒开关底座"] },
            { key: "button", name: "按钮", options: ["复位按钮 5mm"] },
            { key: "steel-ball", name: "钢球", options: ["钢球 3mm"] },
            { key: "rocker", name: "摆臂", options: ["摆臂 A 型", "摆臂 B 型"] },
            { key: "spec", name: "规格", options: ["标准"] },
            { key: "bracket", name: "支架", options: ["6.3支架：铜镀银"] },
            { key: "static-plate", name: "静片", options: ["6.3静片：铜镀银"], qty: true },
            { key: "cover", name: "盖子", options: ["盖子"] },
            { key: "contact-kind", name: "触点类型", options: ["银点"] },
            { key: "contact-size", name: "触点规格", options: ["0.5A"] },
        ],
    },
    {
        name: "微动开关A",
        prefix: "WDA",
        container: true,
        groups: [
            { key: "micro-base", name: "微动底座", options: ["微动底座 S 型", "微动底座 L 型"] },
            { key: "micro-button", name: "微动按钮", options: ["微动按钮 3.8mm"] },
            { key: "micro-contact", name: "微动触点", options: ["微动银点", "微动镀金点"] },
            { key: "micro-lever", name: "微动摆臂", options: ["微动摆臂短", "微动摆臂长"] },
        ],
    },
    {
        name: "微动开关B",
        prefix: "WDB",
        container: true,
        groups: [
            { key: "micro-base", name: "微动底座", options: ["微动底座防水型"] },
            { key: "micro-button", name: "微动按钮", options: ["微动按钮 5.8mm"] },
            { key: "micro-shell", name: "微动盖子", options: ["微动盖子"] },
        ],
    },
    {
        name: "琴键开关",
        prefix: "QK",
        groups: [
            { key: "piano-base", name: "琴键座", options: ["琴键底座 2 位", "琴键底座 4 位"] },
            { key: "piano-cover", name: "琴键盖", options: ["琴键上盖 2 位", "琴键上盖 4 位"] },
            { key: "clamp-plate", name: "压板", options: ["压板 0.3mm", "压板 0.5mm"], qty: true },
            { key: "spec", name: "规格", options: ["标准"] },
            { key: "base", name: "底座", options: ["焊线底座"] },
            { key: "cover", name: "盖子", options: ["盖子"] },
            { key: "button", name: "按钮", options: ["12mm"] },
            { key: "contact-size", name: "触点规格", options: ["1A", "3A"] },
            { key: "contact-kind", name: "触点类型", options: ["银点"] },
        ],
    },
];

const CREATORS = ["郭均", "梁静", "周敏", "何超"];
const CUSTOMERS = Array.from({ length: 20 }, (_, i) => ({
    code: `CUS-${String(i + 1).padStart(4, "0")}`,
    name: `${["深圳市", "东莞市", "苏州市", "宁波市", "佛山市"][i % 5]}${
        ["智造联调电子", "精微电子", "恒达电器", "凯迅自动化", "联欣精密"][Math.floor(i / 5)]
    }`,
}));

function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 目录：9 品类 × 分组节点挂物料项；materialId 按 品类|组|物料 唯一注册，组合品类的归属判定走真实 id 命中 */
function buildCatalog() {
    const categories: BomCategory[] = [];
    const idOf = new Map<string, string>();
    let nextId = 3001;
    for (const def of CATEGORY_DEFS) {
        const groups = def.groups.map(group => ({
            id: `${def.prefix}-g-${group.key}`,
            parentId: null,
            kind: "group" as const,
            name: group.name,
            key: group.key,
            multi: group.options.length > 1,
            qty: group.qty ? true : null,
            items: group.options.map(option => {
                const mapKey = `${def.prefix}|${group.key}|${option}`;
                let id = idOf.get(mapKey);
                if (id === undefined) {
                    id = String(nextId);
                    nextId += 1;
                    idOf.set(mapKey, id);
                }
                return { id, name: option };
            }),
        }));
        categories.push({
            key: `cat-${def.prefix}`,
            name: def.name,
            codePrefix: def.prefix,
            ...(def.children ? { childCategories: def.children } : {}),
            ...(def.container ? { status: false } : {}),
            groups,
        });
    }
    return { categories, idOf };
}

function materialIdOf(idOf: Map<string, string>, def: CategoryDef, group: GroupDef, option: string) {
    return idOf.get(`${def.prefix}|${group.key}|${option}`);
}

/** 从组的候选物料中取一项（qty 组偶带 2–99 数量，对齐真实目录语义） */
function pickItem(def: CategoryDef, group: GroupDef, rng: () => number, idOf: Map<string, string>): BomItemView {
    const name = group.options[Math.floor(rng() * group.options.length)];
    return {
        materialId: materialIdOf(idOf, def, group, name) ?? "",
        groupKey: group.key,
        groupName: group.name,
        name,
        quantity: group.qty && rng() < 0.15 ? 2 + Math.floor(rng() * 8) : 1,
    };
}

/** BOM 明细：非组合品类从组池取样 7–15 条（multi 组按概率补第二项，把均值对齐 volume.json
 *  avgBomItems=10.8 / max 15 / min 7）；跌倒开关另并入子品类微动物料，
 *  偶带未注册历史物料（进 bomComposition 的 unknown 桶） */
function buildItems(def: CategoryDef, rng: () => number, idOf: Map<string, string>): BomItemView[] {
    const shuffled = [...def.groups];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const items: BomItemView[] = [];
    if (!def.children) {
        const base = shuffled.slice(0, Math.min(shuffled.length, 7 + Math.floor(rng() * 9)));
        for (const group of base) items.push(pickItem(def, group, rng, idOf));
        for (const group of base) {
            if (items.length >= 15) break;
            if (group.options.length > 1 && rng() < 0.5) items.push(pickItem(def, group, rng, idOf));
        }
        return items;
    }
    const bodyCount = Math.min(shuffled.length, 5 + Math.floor(rng() * 5));
    for (const group of shuffled.slice(0, bodyCount)) items.push(pickItem(def, group, rng, idOf));
    const childDefs = CATEGORY_DEFS.filter(entry => def.children?.includes(`cat-${entry.prefix}`));
    for (const child of childDefs) {
        const childGroups = [...child.groups].sort(() => rng() - 0.5).slice(0, 1 + Math.floor(rng() * 2));
        for (const group of childGroups) items.push(pickItem(child, group, rng, idOf));
    }
    for (const group of shuffled.slice(0, bodyCount)) {
        if (items.length >= 15) break;
        if (group.options.length > 1 && rng() < 0.5) items.push(pickItem(def, group, rng, idOf));
    }
    if (rng() < 0.05) {
        items.push({
            materialId: `9990${items.length}`,
            groupKey: "legacy",
            groupName: "历史物料",
            name: "旧批号物料",
            quantity: 1,
        });
    }
    return items.slice(0, 15);
}

/** BOM 池（含目录）：建档品类轮转，编码 前缀+序号；spec 按真实口径「组名：物料名 · …」拼接 */
function buildBomPool(count: number) {
    const { categories, idOf } = buildCatalog();
    const rng = mulberry32(20260930);
    const buildable = CATEGORY_DEFS.filter(def => !def.container);
    const seqOf = new Map<string, number>();
    const boms: Bom[] = [];
    for (let i = 0; i < count; i += 1) {
        const def = buildable[i % buildable.length];
        const seq = (seqOf.get(def.prefix) ?? 0) + 1;
        seqOf.set(def.prefix, seq);
        const items = buildItems(def, rng, idOf);
        const model = items.find(item => item.groupKey === "model");
        boms.push({
            code: `${def.prefix}${String(seq).padStart(3, "0")}`,
            name: def.name,
            modelCode: model?.name ?? "",
            spec: items.map(item => `${item.groupName}：${item.name}`).join(" · "),
            remark: "",
            unit: "个",
            creator: CREATORS[i % CREATORS.length],
            created: `2026-0${(i % 9) + 1}-1${i % 9}T02:00:00.000Z`,
            items,
        });
    }
    return { boms, categories };
}

/** 订单池：订单:BOM≈1:1，交付日分布 today−30..+59（排序/逾期有真实工作量），约 5% 归档、55% 未发满 */
function buildOrderPool(count: number, boms: Bom[]) {
    const rng = mulberry32(3092602);
    const today = todayIso();
    const orders: Order[] = [];
    for (let i = 0; i < count; i += 1) {
        const bom = boms[i % boms.length];
        const customer = CUSTOMERS[i % CUSTOMERS.length];
        const qty = 200 + Math.floor(rng() * 28) * 100;
        const phase = rng();
        const outbound = phase < 0.35 ? 0 : phase < 0.75 ? Math.floor(qty * (0.2 + rng() * 0.5)) : qty;
        const deliverDate = addDays(today, Math.floor(rng() * 90) - 30);
        const orderDate = addDays(deliverDate, -(5 + Math.floor(rng() * 35)));
        orders.push({
            version: 1,
            orderNo: `ZM26${String(i + 1).padStart(6, "0")}`,
            customer: customer.name,
            customerCode: customer.code,
            bomCode: bom.code,
            qty,
            outbound,
            orderDate,
            deliverDate,
            remark: "",
            lifecycleStatus: rng() < 0.05 ? "archived" : "active",
            createdBy: CREATORS[(i + 1) % CREATORS.length],
            createdAt: `${orderDate}T02:00:00Z`,
        });
    }
    return orders;
}

function buildStock(boms: Bom[], rng: () => number) {
    const stock: Record<string, number> = {};
    for (const bom of boms) if (rng() < 0.6) stock[bom.code] = 50 + Math.floor(rng() * 750);
    return stock;
}

/* ---------- 基准框架：梯度 / 轮次 / 预算跳过 / 聚合写盘 ---------- */
const NS = [40, 400, 2000, 4000, 10000];
const WARMUP = 2;
const ROUNDS = 9;
const BUDGET_MS = 30_000;
const KEYWORD = "支架";
const RESULTS_PATH = "out/perf-lab/v2/micro.json";
/* vitest 5 module runner 下 import.meta.url 非 file: scheme，改从 cwd 向上探测仓库根（pnpm-workspace.yaml） */
function repoRoot() {
    let dir = process.cwd();
    for (let depth = 0; depth < 4; depth += 1) {
        if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
        dir = resolve(dir, "..");
    }
    return process.cwd();
}
const OUT_DIR = resolve(repoRoot(), "out/perf-lab/v2");
const OUT_FILE = resolve(OUT_DIR, "micro.json");

interface Entry {
    target: string;
    n: number;
    ms: number;
    notes: string;
}
const ENTRIES: Entry[] = [];
let flushed = false;

function median(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
const round3 = (value: number) => Math.round(value * 1000) / 1000;
function push(target: string, n: number, ms: number, notes: string) {
    ENTRIES.push({ target, n, ms: round3(ms), notes });
}
function flush() {
    if (flushed) return;
    flushed = true;
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, `${JSON.stringify({ resultsPath: RESULTS_PATH, entries: ENTRIES }, null, 4)}\n`, "utf8");
    console.log(`[perf-lab] micro.json ← ${ENTRIES.length} entries (${OUT_FILE})`);
    for (const entry of ENTRIES) {
        console.log(`[perf-lab] ${entry.target} n=${entry.n} ms=${entry.ms} | ${entry.notes}`);
    }
}

/* 数据池一次生成、各档取前缀，档间可比且内存可控 */
const POOL_SIZE = NS[NS.length - 1];
const { boms: bomPool, categories } = buildBomPool(POOL_SIZE);
const orderPool = buildOrderPool(POOL_SIZE, bomPool);
const stockPool = buildStock(bomPool, mulberry32(777));
catalogRef.current = categories;

function snapshotFor(n: number): Snapshot {
    return {
        ...EMPTY_SNAPSHOT,
        orders: orderPool.slice(0, n),
        boms: bomPool.slice(0, n),
        stock: Object.fromEntries(bomPool.slice(0, n).map(bom => [bom.code, stockPool[bom.code] ?? 0])),
    };
}
const avgItemsOf = (boms: Bom[]) =>
    boms.length ? Math.round((boms.reduce((sum, bom) => sum + bom.items.length, 0) / boms.length) * 10) / 10 : 0;

/* p2：等价复走 OrdersPage counts.ready——每个活跃订单各调一次真实 maxShipOf */
function runP2() {
    for (const n of NS) {
        const snap = snapshotFor(n);
        const activeOrders = snap.orders.filter(order => order.lifecycleStatus !== "archived");
        /* 试跑估计：丢弃 2 次 JIT 预热后取 8 次平均，外推单轮时长（同一 snap 上每次 maxShipOf 成本相同，线性外推成立） */
        for (let i = 0; i < 2; i += 1) maxShipOf(snap, activeOrders[0].orderNo);
        const probe = Math.min(8, activeOrders.length);
        const start = performance.now();
        for (let i = 0; i < probe; i += 1) maxShipOf(snap, activeOrders[i].orderNo);
        const perCall = (performance.now() - start) / probe;
        const estRound = perCall * activeOrders.length;
        if (estRound * (WARMUP + ROUNDS) > BUDGET_MS) {
            push(
                "p2-ready-counts",
                n,
                estRound,
                `超预算跳过：试跑 ${probe} 次真实 maxShipOf 平均 ${round3(perCall)} ms/次 × ${activeOrders.length} 活跃单 ≈ 单轮 ${round3(
                    estRound,
                )} ms，× ${WARMUP + ROUNDS} 轮超 30s 预算；ms 为预估值而非实测中位数`,
            );
            continue;
        }
        const samples: number[] = [];
        let ready = 0;
        for (let round = 0; round < WARMUP + ROUNDS; round += 1) {
            const roundStart = performance.now();
            ready = 0;
            for (const order of activeOrders) {
                if (maxShipOf(snap, order.orderNo) > 0) ready += 1;
            }
            if (round >= WARMUP) samples.push(performance.now() - roundStart);
        }
        push(
            "p2-ready-counts",
            n,
            median(samples),
            `每个活跃订单各调一次真实 maxShipOf（内部完整执行 readyToShip：过滤+按交期排序+BOM 线性查找+find 定位），等价复走 OrdersPage counts.ready；订单 ${snap.orders.length}（活跃 ${activeOrders.length}，命中可发 ${ready}）× BOM ${snap.boms.length}，明细均值 ${avgItemsOf(
                snap.boms,
            )}；${WARMUP} 预热 + ${ROUNDS} 计时轮取中位数`,
        );
    }
}

/* p5：真实 BomPage，关键词空 → 非空触发 filtered 重算（检索文本重建满额），Profiler actualDuration(update) */
function mountBomPageProbe(n: number) {
    bomsRef.current = bomPool.slice(0, n);
    stocksRef.current = {};
    usageRef.current = { orders: [], inboundLedger: [], outboundLedger: [] };
    let captured = 0;
    let armed = false;
    const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
        if (armed && phase === "update") {
            captured = actualDuration;
            armed = false;
        }
    };
    const view = render(h(MemoryRouter, null, h(Profiler, { id: "p5-bom-page", onRender }, h(BomPage))));
    const input = screen.getByPlaceholderText("BOM / 品类 / 型号 / 物料");
    return {
        once: () => {
            armed = true;
            fireEvent.change(input, { target: { value: KEYWORD } });
            const hit = captured;
            armed = true;
            fireEvent.change(input, { target: { value: "" } });
            return hit;
        },
        cleanup: () => view.unmount(),
    };
}

function runP5() {
    /* 前置预热：在最小档空跑数轮，摊平 react-dom 首次 update 的固定开销，避免首档虚高 */
    const prewarm = mountBomPageProbe(NS[0]);
    for (let i = 0; i < 3; i += 1) prewarm.once();
    prewarm.cleanup();

    for (const n of NS) {
        const probe = mountBomPageProbe(n);
        const once = probe.once;
        const warm = once();
        if (warm * (WARMUP + ROUNDS) > BUDGET_MS) {
            push(
                "p5-search-filter",
                n,
                warm,
                `超预算跳过：试跑单轮 ${round3(warm)} ms × ${WARMUP + ROUNDS} 轮超 30s 预算；ms 为试跑值而非实测中位数`,
            );
            probe.cleanup();
            continue;
        }
        const samples: number[] = [];
        for (let round = 0; round < WARMUP - 1 + ROUNDS; round += 1) {
            const hit = once();
            if (round >= WARMUP - 1) samples.push(hit);
        }
        probe.cleanup();
        push(
            "p5-search-filter",
            n,
            median(samples),
            `挂真实 BomPage（仅 mock 数据层 hook，filtered useMemo 与渲染全走真实源码），${n} 条 BOM；关键词 "" → "${KEYWORD}"（对全部候选拼接编码/品类/规格/物料检索文本并转小写，重建成本满额），React Profiler actualDuration(update)；${WARMUP} 预热 + ${ROUNDS} 计时轮取中位数`,
        );
    }
}

/* p6：数据池前 10/50 条挂载真实 BomCell（bomComposition/bomSummary 真实执行） */
function runP6() {
    for (const n of NS) {
        const pool = bomPool.slice(0, n);
        for (const pageSize of [10, 50]) {
            const pageBoms = pool.slice(0, pageSize);
            const mountOnce = () => {
                let duration = 0;
                const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
                    if (phase === "mount") duration = actualDuration;
                };
                const view = render(
                    h(
                        Profiler,
                        { id: "p6-cells", onRender },
                        pageBoms.map(bom => h(BomCell, { key: bom.code, bom, bomCode: bom.code, categories })),
                    ),
                );
                view.unmount();
                return duration;
            };
            const warm = mountOnce();
            if (warm * (WARMUP + ROUNDS) > BUDGET_MS) {
                push(
                    "p6-page-summary",
                    n,
                    warm,
                    `超预算跳过：试跑单轮 ${round3(warm)} ms × ${WARMUP + ROUNDS} 轮超 30s 预算；ms 为试跑值而非实测中位数`,
                );
                continue;
            }
            const samples: number[] = [];
            for (let round = 0; round < ROUNDS; round += 1) samples.push(mountOnce());
            push(
                "p6-page-summary",
                n,
                median(samples),
                `${n} 条 BOM 数据池挂载 ${pageBoms.length} 个真实 BomCell（pageSize=${pageSize}，池不足时取前 ${pool.length} 条；内部真实执行 bomComposition/bomSummary：组合品类构建目录 Set/Map 并分解，非组合第 15 行早退），React Profiler actualDuration(mount)；1 次试跑预热 + ${ROUNDS} 计时轮取中位数（池 40 档数值偏高、未归因）；双份布局增量以 e2e 配对实验为准（bom-layout-pair），本值仅为行内容分量`,
            );
        }
    }
}

/* p6-update：整页 BomPage 挂载后模拟 usage 数据到达（父级更新），测当前页两套行内容重算的 update 提交 */
function runP6Update() {
    for (const n of NS) {
        const pool = bomPool.slice(0, n);
        const loaded = {
            orders: orderPool.slice(0, Math.floor(n / 2)).map(o => ({ bomCode: o.bomCode })),
            inboundLedger: [] as Array<{ bomCode: string }>,
            outboundLedger: [] as Array<{ bomCode: string }>,
        };
        for (const pageSize of [10, 50]) {
            const once = () => {
                bomsRef.current = pool;
                stocksRef.current = {};
                catalogRef.current = categories;
                usageRef.current = { orders: [], inboundLedger: [], outboundLedger: [] };
                let captured = 0;
                let armed = false;
                const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
                    if (armed && phase === "update") {
                        captured = actualDuration;
                        armed = false;
                    }
                };
                const view = render(h(MemoryRouter, null, h(Profiler, { id: "p6-update", onRender }, h(BomPage))));
                if (pageSize === 50) {
                    const pageSelect = [...view.container.querySelectorAll("select")].find(s =>
                        [...s.options].some(o => o.value === "50"),
                    );
                    if (pageSelect) fireEvent.change(pageSelect, { target: { value: "50" } });
                }
                armed = true;
                act(() => {
                    usageControls.current?.(loaded);
                });
                view.unmount();
                return captured;
            };
            const warm = once();
            if (warm * (WARMUP + ROUNDS) > BUDGET_MS) {
                push(
                    "p6-page-update",
                    n,
                    warm,
                    `超预算跳过：试跑单轮 ${round3(warm)} ms × ${WARMUP + ROUNDS} 轮超 30s 预算；ms 为试跑值而非实测中位数`,
                );
                continue;
            }
            const samples: number[] = [];
            for (let round = 0; round < ROUNDS; round += 1) samples.push(once());
            push(
                "p6-page-update",
                n,
                median(samples),
                `挂真实 BomPage（${n} 条 BOM 数据池）后模拟 usage 数据到达（引用前 ${Math.floor(n / 2)} 订单）触发父级 update：Profiler actualDuration(update) 整页口径——含当前页两套行内容重算（bomComposition/bomSummary 真实执行）与 DataTable 协调；pageSize=${pageSize}${pageSize === 50 ? "（经分页 select 切换后）" : ""}；jsdom 无布局绘制；1 次试跑预热 + ${ROUNDS} 计时轮取中位数（池 40 档数值偏高、未归因）`,
            );
        }
    }
}

/* picker-mount：真实 BomPicker 传入 M 条全匹配项的一次性挂载 */
function runPicker() {
    for (const m of NS) {
        const pool = bomPool.slice(0, m);
        const mountOnce = () => {
            let duration = 0;
            const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
                if (phase === "mount") duration = actualDuration;
            };
            const view = render(
                h(Profiler, { id: "picker-mount", onRender }, h(BomPicker, { boms: pool, onSelect: () => {} })),
            );
            view.unmount();
            return duration;
        };
        const warm = mountOnce();
        if (warm * (WARMUP + ROUNDS) > BUDGET_MS) {
            push(
                "picker-mount",
                m,
                warm,
                `超预算跳过：试跑单轮 ${round3(warm)} ms × ${WARMUP + ROUNDS} 轮超 30s 预算；ms 为试跑值而非实测中位数`,
            );
            continue;
        }
        const samples: number[] = [];
        for (let round = 0; round < ROUNDS; round += 1) samples.push(mountOnce());
        push(
            "picker-mount",
            m,
            median(samples),
            `真实 BomPicker 传入 ${m} 条全匹配项（关键词空，max-h-60 只限滚动高度不限 DOM，全部挂载为选项按钮），React Profiler actualDuration(mount)；1 次试跑预热 + ${ROUNDS} 计时轮取中位数`,
        );
    }
}

/* vitest 5 基准 API：bench 是 test context fixture（仅 *.bench.ts 文件可用）。
 * 轮次/梯度/预算由上面框架自管；.run() 收敛为单次调用（time/iterations/warmup 全 0/1），
 * tinybench 表格里的单样本即下面整段 fn 的墙钟时长，逐档数字以 micro.json 为准。 */
const RUN_ONCE = { iterations: 1, time: 0, warmupIterations: 0, warmupTime: 0 };
/** 注册制落盘：新增 target 必须同时登记 RUNNER_KEYS 并在文件尾加对应 test，否则不会触发 flush */
const RUNNER_KEYS = ["p2", "p5", "p6", "picker", "p6update"];
const executed = new Set<string>();
function oncePer(target: string, fn: () => void) {
    return () => {
        if (executed.has(target)) return;
        executed.add(target);
        fn();
        if (RUNNER_KEYS.every(key => executed.has(key))) flush();
    };
}

test("p2-ready-counts", async ({ bench }) => {
    await bench("p2-ready-counts", oncePer("p2", runP2)).run(RUN_ONCE);
});
test("p5-search-filter", async ({ bench }) => {
    await bench("p5-search-filter", oncePer("p5", runP5)).run(RUN_ONCE);
});
test("p6-page-summary", async ({ bench }) => {
    await bench("p6-page-summary", oncePer("p6", runP6)).run(RUN_ONCE);
});
test("picker-mount", async ({ bench }) => {
    await bench("picker-mount", oncePer("picker", runPicker)).run(RUN_ONCE);
});
test("p6-page-update", async ({ bench }) => {
    await bench("p6-page-update", oncePer("p6update", runP6Update)).run(RUN_ONCE);
});
afterAll(() => flush());

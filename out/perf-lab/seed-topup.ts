/**
 * 幂等造数：把 *_test 库增长到生产量级的指定倍数（端到端性能实测数据源）。
 *
 * 用法：pnpm exec tsx out/perf-lab/seed-topup.ts --factor F
 *
 * 量级基准：同目录 volume.json（最新生产备份的行数与形状摘要）。
 * - 主表（客户/BOM/订单/入库/出库/日志）补齐到 生产行数 × F；
 * - 目录型表（bom_category/material_group/material_item）次线性增长 ×√F
 *   （按品类整支克隆目录，避免建档选择器场景失真）；
 * - 形状按 volume.json.shapes 保真：BOM 明细 7-15 行均值 10.8（分布校准 sum=216/20）、
 *   出库 VOID 率 12.5%（对齐 state_log 45/shipment 40 口径）、订单/入库挂 BOM 冻结快照。
 *
 * 幂等：先查现状只补差额；合成单号（CUS-/ZM/RK/CK/品类前缀）从库内现有最大
 * 序号续接；biz_sequence 只向前推进（GREATEST）；目录克隆按 perf-N 续号。
 * 同一 factor 重复执行零写入；factor 增大时增量补齐。
 *
 * 字段口径与后端一致（apps/backend/prisma/schema.prisma + 各 service）：
 * - spec_hash = SHA-256(JSON.stringify([categoryId, [[id, qty]...], remark]))
 *   （apps/backend/src/common/bom-spec.ts materialSetHash 同算法）；
 * - 订单 bom_spec_snapshot 与 change_log 快照 = bomItemsSnapshotOf / orderSnapshot 形状
 *   （apps/backend/src/common/bom-display.ts、orders.service.ts）；
 * - op_log detail 与 orders/boms/inbound/outbound/customers service 写入形状同构；
 * - 单号格式 = apps/backend/src/sequence/business-sequence.service.ts
 *   （ZM+yyMMdd+≥3 位、RK/CK+yyMMdd+≥2 位、CUS-≥4 位、BOM=品类前缀+≥seqWidth 位）；
 * - 合成主键 = Snowflake workerId 1023（后端 SNOWFLAKE_WORKER_ID=1，永不冲突）。
 *
 * 护栏：库名必须以 _test 结尾、host 仅 localhost/127.0.0.1；绝不触碰非测试库。
 * 写入：conn.batch 多值 INSERT（每批 500 行）；结束逐表自检，任一不达标 exit 1。
 */
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import mariadb from "mariadb";

// ── 定位与 env ───────────────────────────────────────────────────────────────
// 本文件位于 <repo>/out/perf-lab/：path.resolve 会把入口路径最后一段当目录弹出，
// 需要三个 ".." 回到仓库根（scripts/ 下一层的 reset-test-db.ts 才用两个）
const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
config({ path: [join(repoRoot, ".env")] });

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let factor = 0;
let catalogFixed = false;
for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--factor") {
        factor = Number.parseInt(args[i + 1] ?? "", 10);
        i += 1;
    } else if (args[i] === "--catalog-fixed") {
        // 品类固定为 seed 基线数（9），不随 factor 增长——用于选择器在“品类数不变、
        // BOM 增长”业务假设下的定向复测（物料组/物料仍按 √F 次线性增长）
        catalogFixed = true;
    }
}
if (!Number.isInteger(factor) || factor < 1) {
    console.error("用法：pnpm exec tsx out/perf-lab/seed-topup.ts --factor <正整数> [--catalog-fixed]");
    process.exit(1);
}

// ── 库名护栏（口径与 scripts/reset-test-db.ts 一致）──────────────────────────
const rawDatabase = (process.env.DB_DATABASE ?? "").trim() || "zmdb";
const DB = rawDatabase.endsWith("_test") ? rawDatabase : `${rawDatabase}_test`;
const HOST = (process.env.DB_HOST ?? "").trim() || "localhost";
const PORT = Number.parseInt((process.env.DB_PORT ?? "").trim() || "3306", 10) || 3306;
const USER = (process.env.DB_USERNAME ?? "").trim() || "root";
const PASSWORD = process.env.DB_PASSWORD ?? "";
if (!DB.endsWith("_test")) {
    throw new Error(`拒绝操作非测试库：${DB}`);
}
if (!["localhost", "127.0.0.1"].includes(HOST)) {
    throw new Error(`造数仅允许 localhost/127.0.0.1，当前 host=${HOST}`);
}
console.log(`[guard] target=${DB} host=${HOST}:${PORT} factor=${factor}${catalogFixed ? " catalog-fixed" : ""}`);

// ── 量级基准（volume.json）─────────────────────────────────────────────────
const volumePath = join(repoRoot, "out", "perf-lab", "volume.json");
const volume = JSON.parse(readFileSync(volumePath, "utf8")) as { counts: Record<string, number> };
const PROD = volume.counts;
// 目录种子在 reset 后的实际行数（迁移种子固定：9 品类 / 85 组；物料生产快照 263 vs 种子 265）
const SEED_CATEGORIES = 9;
const SEED_GROUPS = 85;
const SEED_ITEMS = 265;

// ── 确定性伪随机（同参数生成序列稳定，重跑结果可复现）────────────────────────
const rng = (seed: number): number => {
    let t = (seed + 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (seed: number, min: number, max: number): number => min + Math.floor(rng(seed) * (max - min + 1));

// ── 合成主键：Snowflake workerId=1023（后端 worker=1，永不冲突）──────────────
const EPOCH = 1_735_689_600_000n; // 与 apps/backend/src/common/snowflake.ts 一致
const SYNTH_WORKER = 1023n;
const snow = (() => {
    let last = -1n;
    let seq = 0n;
    return (): string => {
        let t = BigInt(Date.now());
        if (t < last) t = last; // 时钟回拨时顺延（保持单调唯一）
        if (t === last) {
            seq = (seq + 1n) & 4095n;
            if (seq === 0n) {
                while ((t = BigInt(Date.now())) <= last) {
                    /* 自旋等下一毫秒 */
                }
            }
        } else {
            seq = 0n;
        }
        last = t;
        return (((t - EPOCH) << 22n) | (SYNTH_WORKER << 12n) | seq).toString();
    };
})();

/** 合成 request_key：64 位 hex（与后端 requestKey 同形，满足 ascii CHECK 8-128） */
const key64 = (domain: string, n: number | string): string =>
    createHash("sha256").update(`perf-lab\n${domain}\n${n}`).digest("hex");

/** spec_hash = SHA-256(JSON.stringify([categoryId, [[id, qty]...], remark]))（与后端同算法） */
const materialSetHash = (categoryId: string, entries: Array<[string, number]>, remark: string): Buffer => {
    const sorted = [...entries].sort((a, b) =>
        BigInt(a[0]) < BigInt(b[0]) ? -1 : BigInt(a[0]) > BigInt(b[0]) ? 1 : 0,
    );
    return Buffer.from(
        createHash("sha256")
            .update(JSON.stringify([categoryId, sorted.map(([id, qty]) => [id, qty]), remark]), "utf8")
            .digest(),
    );
};

/** BOM 明细行数分布：20 项 sum=216 → 均值精确 10.8（min 7 / max 15，对齐 shapes） */
const ITEM_SIZE_CYCLE = [12, 10, 9, 13, 8, 11, 14, 7, 10, 12, 11, 9, 15, 8, 13, 10, 12, 7, 10, 15];
if (ITEM_SIZE_CYCLE.reduce((a, b) => a + b, 0) !== 216) {
    throw new Error("明细分布校准错误：sum 应为 216");
}

// ── 时间轴：业务日期铺在今天往前 119 天（不含今天，避开后端当日取号日段）────
const DAY_SPAN = 119;
const dayString = (offsetFromToday: number): string =>
    new Date(Date.now() - offsetFromToday * 86400000).toISOString().slice(0, 10);
const yyMMdd = (day: string): string => day.slice(2, 4) + day.slice(5, 7) + day.slice(8, 10);
/** 业务行 created_at：业务日当天 01:00–22:59 的确定性 UTC 字面量（DATETIME 无会话时区语义，按字面存取） */
const stampOf = (day: string, tick: number): string =>
    `${day} ${String(1 + (tick % 22)).padStart(2, "0")}:${String(tick % 60).padStart(2, "0")}:${String((tick * 7) % 60).padStart(2, "0")}.${String((tick * 13) % 1000).padStart(3, "0")}`;

// ── 连接与批量写 ─────────────────────────────────────────────────────────────
const BATCH = 1000;
const conn = await mariadb.createConnection({ host: HOST, port: PORT, user: USER, password: PASSWORD, database: DB });

const insertRows = async (table: string, columns: string[], rows: unknown[][]): Promise<number> => {
    if (rows.length === 0) return 0;
    const sql = `INSERT INTO \`${table}\` (${columns.map(c => `\`${c}\``).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
    for (let start = 0; start < rows.length; start += BATCH) {
        await conn.batch(sql, rows.slice(start, start + BATCH));
    }
    return rows.length;
};
const countOf = async (table: string, where = ""): Promise<number> => {
    const rows: Array<{ n: bigint | number }> = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\`${where}`);
    return Number(rows[0].n);
};
/** 单号日期段序号解析：'ZM260930012' → { dateKey:'260930', seq:12 } */
const parseSeq = (no: string, prefix: string, dateLen: number): { dateKey: string; seq: number } | null => {
    if (!no.startsWith(prefix)) return null;
    const rest = no.slice(prefix.length);
    if (rest.length <= dateLen) return null;
    const dateKey = rest.slice(0, dateLen);
    const seq = Number.parseInt(rest.slice(dateLen), 10);
    return Number.isNaN(seq) ? null : { dateKey, seq };
};
const toHex = (v: unknown): string => Buffer.from(v as Uint8Array).toString("hex");

// ════════════════════════════════════════════════════════════════════════════
try {
    const t0 = Date.now();

    // ── 现状读取 ──────────────────────────────────────────────────────────────
    const users: Array<{ id: string; name: string; role_code: string }> = await conn.query(
        "SELECT CAST(id AS CHAR) AS id, name, role_code FROM sys_user ORDER BY id",
    );
    if (users.length === 0) throw new Error("sys_user 为空：请先 pnpm test:db:reset");
    const operators = users.map(u => ({ id: u.id, name: u.name, role: u.role_code }));
    const owner = operators.find(u => u.role === "super") ?? operators[0]; // 客户负责人仅 super 合法

    interface CategoryRow {
        id: string;
        category_key: string;
        name: string;
        code_prefix: string;
        seq_width: number;
        status: number;
    }
    let categories: CategoryRow[] = await conn.query(
        "SELECT CAST(id AS CHAR) AS id, category_key, name, code_prefix, seq_width, status FROM bom_category ORDER BY id",
    );
    /** 目录内存模型：GROUP 节点（含物料），SECTION 子组按 sort_order 拍平（与 orderedCatalog 同序） */
    interface GroupView {
        id: string;
        name: string;
        groupKey: string | null;
        multi: boolean;
        qtyGroup: boolean;
        items: Array<{ id: string; name: string }>;
    }
    const loadCatalog = async (): Promise<Map<string, GroupView[]>> => {
        const rows: Array<{
            g_id: string;
            category_id: string;
            parent_id: string | null;
            kind: string;
            g_name: string;
            group_key: string | null;
            multi: number | null;
            qty: number | null;
            sort_order: number;
            item_id: string | null;
            item_name: string | null;
        }> = await conn.query(
            `SELECT CAST(g.id AS CHAR) AS g_id, CAST(g.category_id AS CHAR) AS category_id,
                    CAST(g.parent_id AS CHAR) AS parent_id, g.kind, g.name AS g_name, g.group_key,
                    g.multi, g.qty, g.sort_order, CAST(i.id AS CHAR) AS item_id, i.name AS item_name
             FROM material_group g LEFT JOIN material_item i ON i.group_id = g.id
             ORDER BY g.category_id, g.sort_order, g.id, i.sort_order, i.id`,
        );
        const byCategory = new Map<string, GroupView[]>();
        for (const row of rows) {
            if (row.kind !== "GROUP" || !row.item_id) continue;
            const list = byCategory.get(row.category_id) ?? [];
            list.push({
                id: row.g_id,
                name: row.g_name,
                groupKey: row.group_key,
                multi: row.multi === 1,
                qtyGroup: row.qty === 1,
                items: [{ id: row.item_id, name: row.item_name! }],
            });
            byCategory.set(row.category_id, list);
        }
        // 合并同组多物料 + SECTION 子组保持 sort 顺序（上面 JOIN 已按顺序 append，仅做同组归并）
        const merged = new Map<string, GroupView[]>();
        for (const [catId, list] of byCategory) {
            const order: GroupView[] = [];
            const index = new Map<string, number>();
            for (const g of list) {
                const at = index.get(g.id);
                if (at === undefined) {
                    index.set(g.id, order.length);
                    order.push(g);
                } else {
                    order[at].items.push(...g.items);
                }
            }
            merged.set(
                catId,
                order.filter(g => g.items.length > 0),
            );
        }
        return merged;
    };

    const existingCustomers: Array<{ id: string; customer_code: string; name: string }> = await conn.query(
        "SELECT CAST(id AS CHAR) AS id, customer_code, name FROM custom_table",
    );
    const existingBoms: Array<{
        id: string;
        bom_code: string;
        category_id: string;
        spec_hash: unknown;
        remark: string;
    }> = await conn.query(
        "SELECT CAST(id AS CHAR) AS id, bom_code, CAST(category_id AS CHAR) AS category_id, spec_hash, remark FROM bom_table",
    );
    const existingBomItems: Array<{
        bom_id: string;
        material_id: string;
        group_key: string;
        group_name: string;
        name: string;
        position: number;
        quantity: number;
    }> = await conn.query(
        "SELECT CAST(bom_id AS CHAR) AS bom_id, CAST(material_id AS CHAR) AS material_id, group_key, group_name, name, position, quantity FROM bom_item ORDER BY bom_id, position",
    );
    const existingOrders: Array<{
        id: string;
        order_no: string;
        customer_id: string;
        bom_id: string;
        qty: number;
        lifecycle_status: string;
        row_version: string;
        order_date: string;
        deliver_date: string;
        remark: string;
        customer_name_snapshot: string;
        bom_name_snapshot: string;
        bom_model_snapshot: string;
        bom_spec_snapshot: unknown;
    }> = await conn.query(
        "SELECT CAST(id AS CHAR) AS id, order_no, CAST(customer_id AS CHAR) AS customer_id, CAST(bom_id AS CHAR) AS bom_id, qty, lifecycle_status, row_version, \
                DATE_FORMAT(order_date, '%Y-%m-%d') AS order_date, DATE_FORMAT(deliver_date, '%Y-%m-%d') AS deliver_date, \
                remark, customer_name_snapshot, bom_name_snapshot, bom_model_snapshot, bom_spec_snapshot \
         FROM sales_order_table",
    );
    const existingInbounds: Array<{
        id: string;
        entry_no: string;
        bom_id: string;
        qty: number;
        business_date: string;
        remark: string;
        status: string;
        row_version: string;
    }> = await conn.query(
        "SELECT CAST(id AS CHAR) AS id, entry_no, CAST(bom_id AS CHAR) AS bom_id, qty, DATE_FORMAT(business_date, '%Y-%m-%d') AS business_date, remark, status, row_version FROM inbound_ledger",
    );
    const existingShipments: Array<{
        id: string;
        shipment_no: string;
        order_id: string;
        original_qty: number;
        state: string;
        registered_at: string;
    }> = await conn.query(
        "SELECT CAST(id AS CHAR) AS id, shipment_no, CAST(order_id AS CHAR) AS order_id, original_qty, state, DATE_FORMAT(registered_at, '%Y-%m-%dT%H:%i:%s.%f') AS registered_at FROM outbound_shipment",
    );
    const orderUpdateLogs: Array<{ order_id: string }> = await conn.query(
        "SELECT CAST(order_id AS CHAR) AS order_id FROM sales_order_change_log WHERE event_type = 'UPDATE'",
    );
    const inboundLogIds: Array<{ inbound_id: string }> = await conn.query(
        "SELECT CAST(inbound_id AS CHAR) AS inbound_id FROM inbound_change_log",
    );
    const opLogCounts: Array<{ action: string; n: bigint | number }> = await conn.query(
        "SELECT action, COUNT(*) AS n FROM op_log GROUP BY action",
    );
    const opLogTargets: Array<{ action: string; target_id: string }> = await conn.query(
        "SELECT action, CAST(target_id AS CHAR) AS target_id FROM op_log",
    );

    // 单号序号映射（续接基准，含历次合成行）
    const seqMapOf = (nos: string[], prefix: string, dateLen: number): Map<string, number> => {
        const map = new Map<string, number>();
        for (const no of nos) {
            const parsed = parseSeq(no, prefix, dateLen);
            if (parsed && parsed.seq > (map.get(parsed.dateKey) ?? 0)) map.set(parsed.dateKey, parsed.seq);
        }
        return map;
    };
    const orderSeq = seqMapOf(
        existingOrders.map(o => o.order_no),
        "ZM",
        6,
    );
    const inboundSeq = seqMapOf(
        existingInbounds.map(r => r.entry_no),
        "RK",
        6,
    );
    const outboundSeq = seqMapOf(
        existingShipments.map(s => s.shipment_no),
        "CK",
        6,
    );
    let customerSeq = 0;
    for (const c of existingCustomers) {
        const m = /^CUS-0*(\d+)$/.exec(c.customer_code);
        if (m) customerSeq = Math.max(customerSeq, Number.parseInt(m[1], 10));
    }
    // 品类内 BOM 序号（bom_code = code_prefix + ≥seqWidth 位数字）
    const prefixByCatId = new Map(categories.map(c => [c.id, c.code_prefix] as const));
    const bomSeqByCategory = new Map<string, number>();
    for (const b of existingBoms) {
        const digits = /^(\d+)$/.exec(b.bom_code.slice(prefixByCatId.get(b.category_id)?.length ?? 0));
        if (digits) {
            bomSeqByCategory.set(
                b.category_id,
                Math.max(bomSeqByCategory.get(b.category_id) ?? 0, Number.parseInt(digits[1], 10)),
            );
        }
    }
    const existingHashKeys = new Set(existingBoms.map(b => `${b.category_id}:${toHex(b.spec_hash)}`));
    const synthHashKeys = new Set<string>();

    // ── 目标计算 ──────────────────────────────────────────────────────────────
    const sqrtF = Math.sqrt(factor); // 目录次线性增长系数（先乘后取整，贴合 ×√F）
    const targets = {
        custom_table: PROD.custom_table * factor,
        bom_table: PROD.bom_table * factor,
        bom_item: PROD.bom_item * factor, // 判 ≥（明细随形状，均值精确 10.8）
        bom_category: catalogFixed ? SEED_CATEGORIES : Math.max(SEED_CATEGORIES, Math.round(PROD.bom_category * sqrtF)),
        material_group: Math.max(SEED_GROUPS, Math.round(PROD.material_group * sqrtF)),
        material_item: Math.max(SEED_ITEMS, Math.round(PROD.material_item * sqrtF)),
        sales_order_table: PROD.sales_order_table * factor,
        sales_order_change_log: PROD.sales_order_change_log * factor, // 39F CREATE + 22F UPDATE + 2F ARCHIVE
        inbound_ledger: PROD.inbound_ledger * factor,
        inbound_change_log: PROD.inbound_change_log * factor,
        outbound_shipment: PROD.outbound_shipment * factor,
        outbound_ledger: PROD.outbound_ledger * factor, // 判 ≥（VOIDED 附带冲销流水）
        outbound_state_log: PROD.outbound_state_log * factor, // 40F REGISTER + 5F VOID
        op_log: PROD.op_log * factor, // 配额：ship 35F / create_order 39F / create_bom 40F / create_customer 20F / create_inbound 43F
    };
    const quota = {
        ship: 35 * factor,
        createOrder: 39 * factor,
        createBom: 40 * factor,
        createCustomer: 20 * factor,
        createInbound: Math.max(0, targets.op_log - 35 * factor - 39 * factor - 40 * factor - 20 * factor),
    };

    // ── 1. 目录克隆（×√F，按品类整支复制目录）───────────────────────────────
    const groupCount0 = await countOf("material_group");
    const itemCount0 = await countOf("material_item");
    const categoryCount0 = categories.length;
    if (groupCount0 < targets.material_group || categoryCount0 < targets.bom_category) {
        const seedTime = stampOf(dayString(DAY_SPAN + 1), 1);
        const sources = [1001, 1003, 1004, 1005, 1006, 1007]
            .map(id => categories.find(c => c.id === String(id)))
            .filter((c): c is CategoryRow => Boolean(c));
        if (sources.length === 0) throw new Error("找不到可克隆的源品类（1001/1003-1007）");
        const existingPerfCats = categories.filter(c => c.category_key.startsWith("perf-")).length;
        // 源品类的组/物料行（含 LEFT JOIN 物料行）
        const srcRows: Array<{
            category_id: string;
            g_id: string;
            parent_id: string | null;
            kind: string;
            g_name: string;
            group_key: string | null;
            multi: number | null;
            qty: number | null;
            sort_order: number;
            item_id: string | null;
            item_name: string | null;
        }> = await conn.query(
            `SELECT CAST(g.category_id AS CHAR) AS category_id, CAST(g.id AS CHAR) AS g_id,
                    CAST(g.parent_id AS CHAR) AS parent_id, g.kind, g.name AS g_name, g.group_key,
                    g.multi, g.qty, g.sort_order, CAST(i.id AS CHAR) AS item_id, i.name AS item_name
             FROM material_group g LEFT JOIN material_item i ON i.group_id = g.id
             WHERE g.category_id IN (1001, 1003, 1004, 1005, 1006, 1007)
             ORDER BY g.category_id, g.sort_order, g.id, i.sort_order, i.id`,
        );
        const rowsByCat = new Map<string, typeof srcRows>();
        for (const r of srcRows) {
            const list = rowsByCat.get(r.category_id) ?? [];
            list.push(r);
            rowsByCat.set(r.category_id, list);
        }
        let cloneNo = existingPerfCats;
        let groups = groupCount0;
        let cats = categoryCount0;
        let groupsAdded = 0;
        let itemsAdded = 0;
        while (groups < targets.material_group || cats < targets.bom_category) {
            const src = sources[cloneNo % sources.length];
            cloneNo += 1;
            if (cloneNo - existingPerfCats > 500) throw new Error("目录克隆超过 500 个品类，疑似目标异常");
            const catId = snow();
            const catKey = `perf-${cloneNo}`;
            const catName = `${src.name}·性能${cloneNo}`;
            await insertRows(
                "bom_category",
                [
                    "id",
                    "category_key",
                    "name",
                    "code_prefix",
                    "seq_width",
                    "child_categories",
                    "status",
                    "row_version",
                    "created_at",
                    "updated_at",
                ],
                [[catId, catKey, catName, `Z${cloneNo.toString(36).toUpperCase()}`, 3, null, 1, 1, seedTime, seedTime]],
            );
            const srcRowsForCat = rowsByCat.get(src.id) ?? [];
            const idMap = new Map<string, string>();
            for (const r of srcRowsForCat) if (!idMap.has(r.g_id)) idMap.set(r.g_id, snow());
            const groupRows: unknown[][] = [];
            const itemRows: unknown[][] = [];
            for (const r of srcRowsForCat) {
                if (!groupRows.some(row => row[0] === idMap.get(r.g_id))) {
                    groupRows.push([
                        idMap.get(r.g_id),
                        catId,
                        r.parent_id ? (idMap.get(r.parent_id) ?? null) : null,
                        r.kind,
                        r.g_name, // uk(category_id, name)：新品类内唯一
                        r.group_key,
                        r.multi,
                        r.qty,
                        r.sort_order,
                        1,
                        seedTime,
                        seedTime,
                    ]);
                }
                if (r.item_id) {
                    itemRows.push([snow(), idMap.get(r.g_id), r.item_name, 0, 1, seedTime, seedTime]); // uk(group_id, name)：新组内唯一
                }
            }
            await insertRows(
                "material_group",
                [
                    "id",
                    "category_id",
                    "parent_id",
                    "kind",
                    "name",
                    "group_key",
                    "multi",
                    "qty",
                    "sort_order",
                    "status",
                    "created_at",
                    "updated_at",
                ],
                groupRows.filter(row => row[2] === null), // 先插顶级节点（FK 父行必须先存在）
            );
            await insertRows(
                "material_group",
                [
                    "id",
                    "category_id",
                    "parent_id",
                    "kind",
                    "name",
                    "group_key",
                    "multi",
                    "qty",
                    "sort_order",
                    "status",
                    "created_at",
                    "updated_at",
                ],
                groupRows.filter(row => row[2] !== null), // 再插 SECTION 子组（树仅两级）
            );
            await insertRows(
                "material_item",
                ["id", "group_id", "name", "sort_order", "status", "created_at", "updated_at"],
                itemRows,
            );
            groupsAdded += groupRows.length;
            itemsAdded += itemRows.length;
            groups += groupRows.length;
            cats += 1;
            categories.push({
                id: catId,
                category_key: catKey,
                name: catName,
                code_prefix: `Z${cloneNo.toString(36).toUpperCase()}`,
                seq_width: 3,
                status: 1,
            });
        }
        console.log(
            `[catalog] +${cats - categoryCount0} 品类 / +${groupsAdded} 组 / +${itemsAdded} 物料（√F=${sqrtF.toFixed(2)}）`,
        );
    }

    // ── 2. BOM + 明细 ─────────────────────────────────────────────────────────
    // BOM 品类池：原生启用品类（1002 无自有目录跳过；1008/1009 停用跳过）+ 克隆品类
    const catalogMap = await loadCatalog();
    const catalogOf = (catId: string): GroupView[] => {
        const list = catalogMap.get(catId) ?? [];
        if (catId === "1006") return [...list, ...(catalogMap.get("1003") ?? [])]; // 跌倒开并新微动目录（child_categories 语义）
        return list;
    };
    // 品类池要求目录物料 ≥15（明细行数分布上限），否则轮转分配会把均值拉低于
    // shapes 口径——典型如克隆的跌倒开关（原生 1006 会合并 1003 微动目录，克隆副本不会）
    const bomCategories = categories.filter(c => {
        const native = Number(c.id) <= 1009;
        if (c.id === "1002") return false; // 无自有目录（生产由 1001 目录承载）
        if (native && c.status !== 1) return false; // 1008/1009 停用跳过
        return catalogOf(c.id).reduce((a, g) => a + g.items.length, 0) >= 15;
    });
    if (bomCategories.length === 0) throw new Error("无可用 BOM 品类");
    const categoryNameById = new Map(categories.map(c => [c.id, c.name] as const));

    interface BomPlan {
        id: string;
        code: string;
        categoryId: string;
        categoryName: string;
        remark: string;
        hash: Buffer;
        createdAt: string;
        creatorIdx: number;
        items: Array<{
            materialId: string;
            groupKey: string;
            groupName: string;
            name: string;
            position: number;
            quantity: number;
        }>;
    }
    // BOM 计划数需同时满足两个目标：bom_table 行数 + bom_item 明细总量。
    // 已有 BOM（如 e2e/手工留下的 4 行明细样本）低于均值 10.8 时，只按表行数补差
    // 会留下明细缺口，且 bom_table 达标后重跑 bomNeed=0，无路径再补明细（永久 FAIL）。
    // 故按 ITEM_SIZE_CYCLE 周期精确累计出补齐明细缺口所需的最少 BOM 数，与行数目标取大。
    const itemGap = Math.max(0, targets.bom_item - existingBomItems.length);
    let cycleSum = 0;
    let bomsForItems = 0;
    while (cycleSum < itemGap) {
        cycleSum += ITEM_SIZE_CYCLE[bomsForItems % ITEM_SIZE_CYCLE.length];
        bomsForItems += 1;
    }
    const bomNeed = Math.max(targets.bom_table - existingBoms.length, bomsForItems);
    const bomPlans: BomPlan[] = [];
    const nextBomSeq = new Map(bomSeqByCategory);
    for (let i = 0; i < bomNeed; i += 1) {
        const cat = bomCategories[i % bomCategories.length];
        const catalog = catalogOf(cat.id);
        if (catalog.length === 0) throw new Error(`品类 ${cat.category_key} 目录为空`);
        const totalItems = catalog.reduce((a, g) => a + g.items.length, 0);
        const want = Math.min(ITEM_SIZE_CYCLE[i % ITEM_SIZE_CYCLE.length], totalItems);
        const seq = (nextBomSeq.get(cat.id) ?? 0) + 1;
        nextBomSeq.set(cat.id, seq);
        const code = `${cat.code_prefix}${String(seq).padStart(cat.seq_width, "0")}`;
        // 明细：每组先取 1 个、轮转取第 2 个；起点随 i 轮转保证品类内集合唯一
        const picked = new Set<string>();
        const chosen: Array<{ item: { id: string; name: string }; group: GroupView }> = [];
        let rounds = 0;
        while (chosen.length < want && picked.size < totalItems && rounds < want * 3) {
            const group = catalog[(i + rounds) % catalog.length];
            const start = (i * 3 + rounds) % group.items.length;
            for (let k = 0; k < group.items.length; k += 1) {
                const item = group.items[(start + k) % group.items.length];
                if (picked.has(item.id)) continue;
                picked.add(item.id);
                chosen.push({ item, group });
                break;
            }
            rounds += 1;
        }
        if (chosen.length === 0) throw new Error(`品类 ${cat.category_key} 无法选出物料`);
        // position 按目录组顺序稳定
        const order = new Map(catalog.map((g, idx) => [g.id, idx] as const));
        chosen.sort((a, b) => order.get(a.group.id)! - order.get(b.group.id)!);
        const items = chosen.map((c, idx) => ({
            materialId: c.item.id,
            groupKey: c.group.groupKey ?? "misc",
            groupName: c.group.name,
            name: c.item.name,
            position: idx + 1,
            quantity: c.group.qtyGroup ? int(i * 31 + idx, 2, 9) : 1,
        }));
        let remark = i % 10 === 3 ? `性能样本备注 ${i}` : "";
        let hash = materialSetHash(
            cat.id,
            items.map(it => [it.materialId, it.quantity] as [string, number]),
            remark,
        );
        let hashKey = `${cat.id}:${hash.toString("hex")}`;
        for (let attempt = 2; existingHashKeys.has(hashKey) || synthHashKeys.has(hashKey); attempt += 1) {
            if (attempt > 5) throw new Error(`BOM 判重失败（${cat.category_key} 第 ${seq} 个）`);
            remark = `性能样本备注 ${i} v${attempt}`;
            hash = materialSetHash(
                cat.id,
                items.map(it => [it.materialId, it.quantity] as [string, number]),
                remark,
            );
            hashKey = `${cat.id}:${hash.toString("hex")}`;
        }
        synthHashKeys.add(hashKey);
        bomPlans.push({
            id: snow(),
            code,
            categoryId: cat.id,
            categoryName: categoryNameById.get(cat.id) ?? "",
            remark,
            hash,
            createdAt: stampOf(dayString(int(i * 17 + 11, 1, DAY_SPAN)), i),
            creatorIdx: i % operators.length,
            items,
        });
    }
    await insertRows(
        "bom_table",
        [
            "id",
            "bom_code",
            "category_id",
            "spec_hash",
            "remark",
            "unit",
            "status",
            "row_version",
            "request_key",
            "created_by",
            "updated_by",
            "created_at",
        ],
        bomPlans.map(b => [
            b.id,
            b.code,
            b.categoryId,
            b.hash,
            b.remark,
            "个",
            1,
            1,
            key64("bom", b.code),
            operators[b.creatorIdx].id,
            operators[b.creatorIdx].id,
            b.createdAt,
        ]),
    );
    const bomItemRows: unknown[][] = [];
    for (const b of bomPlans) {
        for (const it of b.items)
            bomItemRows.push([
                snow(),
                b.id,
                it.materialId,
                it.groupKey,
                it.groupName,
                it.name,
                it.position,
                it.quantity,
                b.createdAt,
            ]);
    }
    await insertRows(
        "bom_item",
        ["id", "bom_id", "material_id", "group_key", "group_name", "name", "position", "quantity", "created_at"],
        bomItemRows,
    );
    if (bomPlans.length > 0)
        console.log(
            `[bom] +${bomPlans.length} BOM / +${bomItemRows.length} 明细（均值 ${(bomItemRows.length / bomPlans.length).toFixed(2)}）`,
        );

    // ── 3. 客户 ───────────────────────────────────────────────────────────────
    const customerNeed = Math.max(0, targets.custom_table - existingCustomers.length);
    const customerRows: unknown[][] = [];
    for (let i = 0; i < customerNeed; i += 1) {
        customerSeq += 1;
        const code = `CUS-${String(customerSeq).padStart(4, "0")}`;
        const creator = operators[i % operators.length];
        const createdAt = stampOf(dayString(int(i * 13 + 7, 1, DAY_SPAN)), i);
        customerRows.push([
            snow(),
            code,
            `性能客户${String(i).padStart(4, "0")}号`, // ck_customer_name：CHAR_LENGTH 4-80
            `联系人${String(i).padStart(4, "0")}`,
            `13${String(800000000 + ((i * 7919) % 99999999)).padStart(9, "0")}`, // ck_customer_phone：^1[0-9]{10}$
            "江苏省",
            "苏州市",
            "工业园区",
            null,
            `性能路${(i % 999) + 1}号`,
            owner.id, // 负责人仅 super/sales 合法（当前库仅 super）
            "",
            1,
            key64("customer", code),
            creator.id,
            creator.id,
            createdAt,
            createdAt,
        ]);
    }
    await insertRows(
        "custom_table",
        [
            "id",
            "customer_code",
            "name",
            "contact_person",
            "contact_phone",
            "province",
            "city",
            "district",
            "town",
            "address",
            "owner_id",
            "pay_terms",
            "row_version",
            "request_key",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ],
        customerRows,
    );
    if (customerRows.length > 0) console.log(`[customer] +${customerRows.length}`);
    const allCustomers: Array<{ id: string; code: string; name: string }> = [
        ...existingCustomers.map(c => ({ id: c.id, code: c.customer_code, name: c.name })),
        ...customerRows.map(r => ({ id: r[0] as string, code: r[1] as string, name: r[2] as string })),
    ];
    if (allCustomers.length === 0) throw new Error("客户为空：无法造订单");

    // ── 4. 入库台账 ───────────────────────────────────────────────────────────
    const allBomIds = [...existingBoms.map(b => b.id), ...bomPlans.map(b => b.id)];
    if (allBomIds.length === 0) throw new Error("BOM 为空：无法造入库");
    const inboundNeed = Math.max(0, targets.inbound_ledger - existingInbounds.length);
    const inboundPlans: Array<{
        id: string;
        entryNo: string;
        bomId: string;
        qty: number;
        day: string;
        createdAt: string;
        opIdx: number;
        remark: string;
    }> = [];
    for (let i = 0; i < inboundNeed; i += 1) {
        const bomId = allBomIds[i % allBomIds.length];
        const day = dayString(int(i * 29 + 3, 1, DAY_SPAN));
        const dateKey = yyMMdd(day);
        const seq = (inboundSeq.get(dateKey) ?? 0) + 1;
        inboundSeq.set(dateKey, seq);
        inboundPlans.push({
            id: snow(),
            entryNo: `RK${dateKey}${String(seq).padStart(2, "0")}`,
            bomId,
            qty: int(i * 37 + 11, 300, 2000),
            day,
            createdAt: stampOf(day, i),
            opIdx: i % operators.length,
            remark: i % 15 === 5 ? "性能入库样本" : "",
        });
    }
    await insertRows(
        "inbound_ledger",
        [
            "id",
            "entry_no",
            "bom_id",
            "qty",
            "business_date",
            "operator_id",
            "remark",
            "status",
            "row_version",
            "request_key",
            "updated_by",
            "created_at",
            "updated_at",
        ],
        inboundPlans.map(r => [
            r.id,
            r.entryNo,
            r.bomId,
            r.qty,
            r.day,
            operators[r.opIdx].id,
            r.remark,
            "ACTIVE",
            1,
            key64("inbound", r.entryNo),
            operators[r.opIdx].id,
            r.createdAt,
            r.createdAt,
        ]),
    );
    if (inboundPlans.length > 0) console.log(`[inbound] +${inboundPlans.length}`);

    // ── 5. 订单 + CREATE/ARCHIVE 日志 ────────────────────────────────────────
    // BOM 快照（订单冻结用）：新 BOM 用内存 items；旧 BOM 用库内 bom_item
    const itemsByBomId = new Map<string, BomPlan["items"]>();
    for (const b of bomPlans) itemsByBomId.set(b.id, b.items);
    for (const r of existingBomItems) {
        const list = itemsByBomId.get(r.bom_id) ?? [];
        list.push({
            materialId: r.material_id,
            groupKey: r.group_key,
            groupName: r.group_name,
            name: r.name,
            position: r.position,
            quantity: r.quantity,
        });
        itemsByBomId.set(r.bom_id, list);
    }
    const categoryNameByBomId = new Map<string, string>([
        ...existingBoms.map(b => [b.id, categoryNameById.get(b.category_id) ?? ""] as const),
        ...bomPlans.map(b => [b.id, b.categoryName] as const),
    ]);
    const bomCodeById = new Map<string, string>([
        ...existingBoms.map(b => [b.id, b.bom_code] as const),
        ...bomPlans.map(b => [b.id, b.code] as const),
    ]);
    /** bomItemsSnapshotOf 同构（common/bom-display.ts）：items 已按 position 排序 */
    const snapshotOfItems = (items: BomPlan["items"]): { items: unknown[]; modelCode: string; spec: string } => {
        const sorted = [...items].sort((a, b) => a.position - b.position);
        const model = sorted.find(it => it.groupKey === "model");
        return {
            items: sorted,
            modelCode: model?.name ?? "",
            spec: sorted
                .map(it => `${it.groupName}：${it.name}${it.quantity > 1 ? ` ×${it.quantity}` : ""}`)
                .join(" · "),
        };
    };

    const orderNeed = Math.max(0, targets.sales_order_table - existingOrders.length);
    const archivedCount = existingOrders.filter(o => o.lifecycle_status === "ARCHIVED").length;
    const archiveNeed = Math.max(0, 2 * factor - archivedCount); // ARCHIVE 目标 = 2F
    if (archiveNeed > orderNeed) {
        throw new Error(
            `归档补差 ${archiveNeed} 超过新增订单 ${orderNeed}：库内存在非本脚本口径的订单，先 pnpm test:db:reset 再跑`,
        );
    }
    interface OrderPlan {
        id: string;
        orderNo: string;
        customer: { id: string; code: string; name: string };
        bomId: string;
        qty: number;
        orderDate: string;
        deliverDate: string;
        remark: string;
        archived: boolean;
        createdAt: string;
        opIdx: number;
        snapshot: Record<string, unknown>; // orderSnapshot 形状（orders.service.ts）
    }
    const orderPlans: OrderPlan[] = [];
    for (let i = 0; i < orderNeed; i += 1) {
        const customer = allCustomers[i % allCustomers.length];
        const bomId = allBomIds[i % allBomIds.length];
        const orderDate = dayString(int(i * 23 + 5, 8, DAY_SPAN));
        const dateKey = yyMMdd(orderDate);
        const seq = (orderSeq.get(dateKey) ?? 0) + 1;
        orderSeq.set(dateKey, seq);
        const orderNo = `ZM${dateKey}${String(seq).padStart(3, "0")}`;
        const qty = int(i * 41 + 17, 100, 800);
        const deliverDate = dayString(Math.max(0, int(i * 23 + 5, 8, DAY_SPAN) - int(i * 3 + 1, 3, 25))); // deliver ≥ order
        const createdAt = stampOf(orderDate, i + 60);
        const bomSpec = snapshotOfItems(itemsByBomId.get(bomId) ?? []);
        const archived = i < archiveNeed;
        const snapshot = {
            orderNo,
            qty,
            orderDate,
            deliverDate,
            remark: "",
            lifecycleStatus: archived ? "ARCHIVED" : "ACTIVE",
            archivedAt: archived ? createdAt : null,
            archiveReason: archived ? "性能压测归档" : null,
            bomName: categoryNameByBomId.get(bomId) ?? "",
            bomModel: bomSpec.modelCode,
            bomSpec,
            rowVersion: archived ? 2 : 1, // CREATE(1) → ARCHIVE(2)
        };
        orderPlans.push({
            id: snow(),
            orderNo,
            customer,
            bomId,
            qty,
            orderDate,
            deliverDate,
            remark: "",
            archived,
            createdAt,
            opIdx: i % operators.length,
            snapshot,
        });
    }
    await insertRows(
        "sales_order_table",
        [
            "id",
            "order_no",
            "customer_id",
            "bom_id",
            "qty",
            "lifecycle_status",
            "order_date",
            "deliver_date",
            "remark",
            "customer_name_snapshot",
            "bom_name_snapshot",
            "bom_model_snapshot",
            "bom_spec_snapshot",
            "archived_at",
            "archived_by",
            "archive_reason",
            "row_version",
            "request_key",
            "created_by",
            "updated_by",
            "created_at",
        ],
        orderPlans.map(o => [
            o.id,
            o.orderNo,
            o.customer.id,
            o.bomId,
            o.qty,
            o.archived ? "ARCHIVED" : "ACTIVE",
            o.orderDate,
            o.deliverDate,
            o.remark,
            o.customer.name,
            (o.snapshot.bomName as string) ?? "",
            (o.snapshot.bomModel as string) ?? "",
            JSON.stringify(o.snapshot.bomSpec),
            o.archived ? o.createdAt : null,
            o.archived ? owner.id : null,
            o.archived ? "性能压测归档" : null,
            o.snapshot.rowVersion,
            key64("order", o.orderNo),
            operators[o.opIdx].id,
            operators[o.opIdx].id,
            o.createdAt,
        ]),
    );
    const orderLogRows: unknown[][] = [];
    for (const o of orderPlans) {
        orderLogRows.push([
            snow(),
            o.id,
            operators[o.opIdx].id,
            "CREATE",
            null,
            1,
            "",
            key64("order-create", o.orderNo),
            null,
            JSON.stringify(o.snapshot),
            o.createdAt,
        ]);
    }
    for (const o of orderPlans.filter(p => p.archived)) {
        const before = {
            ...o.snapshot,
            rowVersion: 1,
            lifecycleStatus: "ACTIVE",
            archivedAt: null,
            archiveReason: null,
        };
        orderLogRows.push([
            snow(),
            o.id,
            operators[o.opIdx].id,
            "ARCHIVE",
            1,
            2,
            "性能压测归档",
            key64("order-archive", o.orderNo),
            JSON.stringify(before),
            JSON.stringify(o.snapshot),
            o.createdAt,
        ]);
    }
    await insertRows(
        "sales_order_change_log",
        [
            "id",
            "order_id",
            "operator_id",
            "event_type",
            "before_version",
            "after_version",
            "reason",
            "request_key",
            "before_json",
            "after_json",
            "created_at",
        ],
        orderLogRows,
    );
    if (orderPlans.length > 0)
        console.log(`[orders] +${orderPlans.length}（归档 ${orderPlans.filter(o => o.archived).length}）`);

    // UPDATE 日志补差：目标 63F − CREATE(总单数) − ARCHIVE(归档数)；挂无 UPDATE 日志的活动单并推进版本
    const orderTotal = existingOrders.length + orderPlans.length;
    const updateNeed = Math.max(
        0,
        targets.sales_order_change_log - orderTotal - (archivedCount + archiveNeed) - orderUpdateLogs.length,
    );
    if (updateNeed > 0) {
        const updatedIds = new Set(orderUpdateLogs.map(r => r.order_id));
        const candidates: Array<{ id: string; snapshot: Record<string, unknown>; at: string; opIdx: number }> = [
            ...orderPlans
                .filter(o => !o.archived && !updatedIds.has(o.id))
                .map(o => ({ id: o.id, snapshot: { ...o.snapshot, rowVersion: 1 }, at: o.createdAt, opIdx: o.opIdx })),
            ...existingOrders
                .filter(o => o.lifecycle_status !== "ARCHIVED" && !updatedIds.has(o.id))
                .map(o => ({
                    id: o.id,
                    snapshot: {
                        orderNo: o.order_no,
                        qty: o.qty,
                        orderDate: o.order_date,
                        deliverDate: o.deliver_date,
                        remark: o.remark,
                        lifecycleStatus: "ACTIVE",
                        archivedAt: null,
                        archiveReason: null,
                        bomName: o.bom_name_snapshot,
                        bomModel: o.bom_model_snapshot,
                        bomSpec: o.bom_spec_snapshot,
                        rowVersion: Number(o.row_version),
                    },
                    at: `${o.order_date}T02:00:00.000Z`,
                    opIdx: 0,
                })),
        ];
        const picked = candidates.slice(0, updateNeed);
        const updateRows: unknown[][] = [];
        const logRows: unknown[][] = [];
        for (const c of picked) {
            const before = c.snapshot;
            const after = { ...before, remark: "性能压测改备注", rowVersion: Number(before.rowVersion) + 1 };
            updateRows.push(["性能压测改备注", operators[c.opIdx].id, after.rowVersion, c.id]);
            logRows.push([
                snow(),
                c.id,
                operators[c.opIdx].id,
                "UPDATE",
                before.rowVersion,
                after.rowVersion,
                "",
                null,
                JSON.stringify(before),
                JSON.stringify(after),
                c.at,
            ]);
        }
        for (let s = 0; s < updateRows.length; s += BATCH) {
            await conn.batch(
                "UPDATE sales_order_table SET remark = ?, updated_by = ?, row_version = ? WHERE id = ?",
                updateRows.slice(s, s + BATCH),
            );
        }
        await insertRows(
            "sales_order_change_log",
            [
                "id",
                "order_id",
                "operator_id",
                "event_type",
                "before_version",
                "after_version",
                "reason",
                "request_key",
                "before_json",
                "after_json",
                "created_at",
            ],
            logRows,
        );
        if (picked.length > 0) console.log(`[order-update] +${picked.length}`);
    }

    // ── 6. 出库（shipment + ledger + state log）──────────────────────────────
    // 库存账本（保证 v_bom_stock 非负）：现有 + 合成入库 − 合成出库
    const stockMap = new Map<string, number>();
    const stockRows: Array<{ bom_id: string; stock_qty: bigint | number }> = await conn.query(
        "SELECT CAST(bom_id AS CHAR) AS bom_id, stock_qty FROM v_bom_stock",
    );
    for (const r of stockRows) stockMap.set(r.bom_id, Number(r.stock_qty));
    for (const r of inboundPlans) stockMap.set(r.bomId, (stockMap.get(r.bomId) ?? 0) + r.qty);
    // 可发订单：活动单且 qty − 有效出库净额 > 0
    const netRows: Array<{ order_id: string; outbound_qty: bigint | number }> = await conn.query(
        "SELECT CAST(order_id AS CHAR) AS order_id, outbound_qty FROM v_order_outbound_qty",
    );
    const netMap = new Map(netRows.map(r => [r.order_id, Number(r.outbound_qty)] as const));
    const shippable: Array<{ id: string; orderNo: string; bomId: string; remaining: number; customerName: string }> =
        [];
    for (const o of existingOrders) {
        if (o.lifecycle_status === "ACTIVE" && o.qty - (netMap.get(o.id) ?? 0) > 0) {
            shippable.push({
                id: o.id,
                orderNo: o.order_no,
                bomId: o.bom_id,
                remaining: o.qty - (netMap.get(o.id) ?? 0),
                customerName: o.customer_name_snapshot,
            });
        }
    }
    for (const o of orderPlans.filter(p => !p.archived)) {
        shippable.push({
            id: o.id,
            orderNo: o.orderNo,
            bomId: o.bomId,
            remaining: o.qty,
            customerName: o.customer.name,
        });
    }
    const shipmentNeed = Math.max(0, targets.outbound_shipment - existingShipments.length);
    // VOID 率 12.5%（对齐 state_log 45/40 口径）：前 5F−现有VOIDED 个合成 shipment 置 VOIDED
    const voidQuota = Math.min(
        shipmentNeed,
        Math.max(0, 5 * factor - existingShipments.filter(s => s.state === "VOIDED").length),
    );
    interface ShipmentPlan {
        id: string;
        no: string;
        orderId: string;
        orderNo: string;
        qty: number;
        day: string;
        createdAt: string;
        opIdx: number;
        voided: boolean;
        customerName: string;
    }
    const shipmentPlans: ShipmentPlan[] = [];
    let cursor = 0;
    for (let i = 0; i < shipmentNeed; i += 1) {
        let target: (typeof shippable)[number] | null = null;
        for (let scan = 0; scan < shippable.length; scan += 1) {
            const cand = shippable[(cursor + scan) % shippable.length];
            const stock = stockMap.get(cand.bomId) ?? 0;
            if (cand.remaining > 0 && stock > 0) {
                target = cand;
                cursor = (cursor + scan + 1) % shippable.length;
                break;
            }
        }
        if (!target) break; // 可发量或库存耗尽
        const qty = Math.max(1, Math.min(int(i * 53 + 7, 50, 300), target.remaining, stockMap.get(target.bomId) ?? 1));
        target.remaining -= qty;
        stockMap.set(target.bomId, (stockMap.get(target.bomId) ?? 0) - qty);
        const day = dayString(int(i * 19 + 2, 1, DAY_SPAN));
        const dateKey = yyMMdd(day);
        const seq = (outboundSeq.get(dateKey) ?? 0) + 1;
        outboundSeq.set(dateKey, seq);
        shipmentPlans.push({
            id: snow(),
            no: `CK${dateKey}${String(seq).padStart(2, "0")}`,
            orderId: target.id,
            orderNo: target.orderNo,
            qty,
            day,
            createdAt: stampOf(day, i + 30),
            opIdx: i % operators.length,
            voided: i < voidQuota,
            customerName: target.customerName,
        });
    }
    await insertRows(
        "outbound_shipment",
        [
            "id",
            "shipment_no",
            "order_id",
            "original_qty",
            "business_date",
            "state",
            "voided_by",
            "void_reason",
            "voided_at",
            "row_version",
            "request_key",
            "registered_by",
            "registered_at",
        ],
        shipmentPlans.map(s => [
            s.id,
            s.no,
            s.orderId,
            s.qty,
            s.day,
            s.voided ? "VOIDED" : "REGISTERED",
            s.voided ? operators[s.opIdx].id : null,
            s.voided ? "性能压测作废" : null,
            s.voided ? s.createdAt : null,
            s.voided ? 2 : 1,
            key64("shipment", s.no),
            operators[s.opIdx].id,
            s.createdAt,
        ]),
    );
    const ledgerRows: unknown[][] = [];
    const stateRows: unknown[][] = [];
    for (const s of shipmentPlans) {
        const normalId = snow();
        ledgerRows.push([
            normalId,
            `${s.no}-E1`,
            s.id,
            "NORMAL",
            null,
            s.qty,
            s.day,
            operators[s.opIdx].id,
            "",
            null,
            key64("outbound", `${s.no}-E1`),
            s.createdAt,
        ]);
        stateRows.push([
            snow(),
            s.id,
            operators[s.opIdx].id,
            "REGISTER",
            null,
            "REGISTERED",
            null,
            1,
            "",
            key64("outbound-state", s.no),
            JSON.stringify({ qty: s.qty, orderNo: s.orderNo }),
            s.createdAt,
        ]);
        if (s.voided) {
            ledgerRows.push([
                snow(),
                `${s.no}-E2`,
                s.id,
                "CORRECTION",
                normalId,
                -s.qty,
                s.day,
                operators[s.opIdx].id,
                "",
                "性能压测作废",
                key64("outbound", `${s.no}-E2`),
                s.createdAt,
            ]);
            stateRows.push([
                snow(),
                s.id,
                operators[s.opIdx].id,
                "VOID",
                "REGISTERED",
                "VOIDED",
                1,
                2,
                "性能压测作废",
                key64("outbound-state-void", s.no),
                JSON.stringify({ qty: s.qty, orderNo: s.orderNo, reason: "性能压测作废" }),
                s.createdAt,
            ]);
        }
    }
    await insertRows(
        "outbound_ledger",
        [
            "id",
            "event_no",
            "shipment_id",
            "entry_type",
            "correction_of_id",
            "qty_delta",
            "business_date",
            "operator_id",
            "remark",
            "correction_reason",
            "request_key",
            "created_at",
        ],
        ledgerRows,
    );
    await insertRows(
        "outbound_state_log",
        [
            "id",
            "shipment_id",
            "operator_id",
            "event_type",
            "before_state",
            "after_state",
            "before_version",
            "after_version",
            "reason",
            "request_key",
            "detail_json",
            "created_at",
        ],
        stateRows,
    );
    if (shipmentPlans.length > 0) {
        console.log(
            `[outbound] +${shipmentPlans.length} shipment（VOIDED ${shipmentPlans.filter(s => s.voided).length}）/ +${ledgerRows.length} ledger / +${stateRows.length} state log`,
        );
    }

    // ── 7. 入库修正日志（3F 补差）────────────────────────────────────────────
    const inboundLogNeed = Math.max(0, targets.inbound_change_log - inboundLogIds.length);
    if (inboundLogNeed > 0) {
        const loggedIds = new Set(inboundLogIds.map(r => r.inbound_id));
        const candidates = [
            ...inboundPlans
                .filter(r => !loggedIds.has(r.id))
                .map(r => ({
                    id: r.id,
                    entryNo: r.entryNo,
                    bomCode: bomCodeById.get(r.bomId) ?? "",
                    qty: r.qty,
                    day: r.day,
                    remark: r.remark,
                    at: r.createdAt,
                    opIdx: r.opIdx,
                })),
            ...existingInbounds
                .filter(r => !loggedIds.has(r.id) && r.status === "ACTIVE")
                .map(r => ({
                    id: r.id,
                    entryNo: r.entry_no,
                    bomCode: bomCodeById.get(r.bom_id) ?? "",
                    qty: r.qty,
                    day: r.business_date,
                    remark: r.remark,
                    at: `${r.business_date}T03:00:00.000Z`,
                    opIdx: 0,
                })),
        ];
        const picked = candidates.slice(0, inboundLogNeed);
        const logRows: unknown[][] = [];
        const updateRows: unknown[][] = [];
        for (const c of picked) {
            const before = {
                no: c.entryNo,
                bomCode: c.bomCode,
                qty: c.qty,
                date: c.day,
                remark: c.remark,
                status: "ACTIVE",
                version: 1,
            };
            const after = { ...before, remark: "性能修正备注", version: 2 };
            logRows.push([
                snow(),
                c.id,
                operators[c.opIdx].id,
                "UPDATE",
                1,
                2,
                "性能修正备注",
                null,
                JSON.stringify(before),
                JSON.stringify(after),
                c.at,
            ]);
            updateRows.push(["性能修正备注", operators[c.opIdx].id, 2, c.id]);
        }
        for (let s = 0; s < updateRows.length; s += BATCH) {
            await conn.batch(
                "UPDATE inbound_ledger SET remark = ?, updated_by = ?, row_version = ? WHERE id = ?",
                updateRows.slice(s, s + BATCH),
            );
        }
        await insertRows(
            "inbound_change_log",
            [
                "id",
                "inbound_id",
                "operator_id",
                "event_type",
                "before_version",
                "after_version",
                "reason",
                "request_key",
                "before_json",
                "after_json",
                "created_at",
            ],
            logRows,
        );
        if (picked.length > 0) console.log(`[inbound-change] +${picked.length}`);
    }

    // ── 8. op_log 配额补差（detail 与各 service 写入形状同构）────────────────
    const opNow = new Map(opLogCounts.map(r => [r.action, Number(r.n)] as const));
    const usedTargets = new Map<string, Set<string>>();
    for (const r of opLogTargets) {
        const set = usedTargets.get(r.action) ?? new Set<string>();
        set.add(r.target_id);
        usedTargets.set(r.action, set);
    }
    const opRows: unknown[][] = [];
    const opLog = (
        action: string,
        targetType: string,
        targetId: string,
        targetCode: string,
        detail: unknown,
        at: string,
        opIdx: number,
    ): void => {
        opRows.push([
            snow(),
            operators[opIdx].id,
            operators[opIdx].name,
            operators[opIdx].role,
            action,
            targetType,
            targetId,
            targetCode,
            JSON.stringify(detail),
            at,
        ]);
    };
    // ship：挂非 VOIDED、未挂日志的 shipment
    let quotaLeft = Math.max(0, quota.ship - (opNow.get("ship") ?? 0));
    if (quotaLeft > 0) {
        const used = usedTargets.get("ship") ?? new Set<string>();
        const pool = [
            ...existingShipments
                .filter(s => s.state !== "VOIDED" && !used.has(s.id))
                .map(s => ({
                    id: s.id,
                    no: s.shipment_no,
                    qty: s.original_qty,
                    orderNo: "",
                    customer: "",
                    at: s.registered_at,
                })),
            ...shipmentPlans
                .filter(s => !s.voided && !used.has(s.id))
                .map(s => ({
                    id: s.id,
                    no: s.no,
                    qty: s.qty,
                    orderNo: s.orderNo,
                    customer: s.customerName,
                    at: s.createdAt,
                })),
        ];
        for (const s of pool.slice(0, quotaLeft))
            opLog(
                "ship",
                "outbound",
                s.id,
                s.no,
                { orderNo: s.orderNo, qty: s.qty, remark: "", customer: s.customer },
                s.at,
                0,
            );
    }
    // create_order
    quotaLeft = Math.max(0, quota.createOrder - (opNow.get("create_order") ?? 0));
    if (quotaLeft > 0) {
        const used = usedTargets.get("create_order") ?? new Set<string>();
        const pool = [
            ...orderPlans
                .filter(o => !used.has(o.id))
                .map(o => ({
                    id: o.id,
                    no: o.orderNo,
                    snapshot: o.snapshot,
                    customer: o.customer.name,
                    customerCode: o.customer.code,
                    bomCode: bomCodeById.get(o.bomId) ?? "",
                    bomRemark: "",
                    at: o.createdAt,
                    opIdx: o.opIdx,
                })),
            ...existingOrders
                .filter(o => !used.has(o.id))
                .map(o => ({
                    id: o.id,
                    no: o.order_no,
                    snapshot: null as Record<string, unknown> | null,
                    customer: o.customer_name_snapshot,
                    customerCode: "",
                    bomCode: bomCodeById.get(o.bom_id) ?? "",
                    bomRemark: o.remark,
                    at: `${o.order_date}T04:00:00.000Z`,
                    opIdx: 0,
                })),
        ];
        for (const o of pool.slice(0, quotaLeft)) {
            const detail = o.snapshot
                ? {
                      ...o.snapshot,
                      customer: o.customer,
                      customerCode: o.customerCode,
                      bomCode: o.bomCode,
                      bomRemark: o.bomRemark,
                  }
                : { orderNo: o.no, customer: o.customer };
            opLog("create_order", "order", o.id, o.no, detail, o.at, o.opIdx);
        }
    }
    // create_bom（detail = Bom 契约响应形状：code/name/modelCode/items/spec/remark/creator/created/unit）
    quotaLeft = Math.max(0, quota.createBom - (opNow.get("create_bom") ?? 0));
    if (quotaLeft > 0) {
        const used = usedTargets.get("create_bom") ?? new Set<string>();
        const pool = [
            ...bomPlans
                .filter(b => !used.has(b.id))
                .map(b => ({ id: b.id, no: b.code, at: b.createdAt, opIdx: b.creatorIdx, bom: b as BomPlan })),
            ...existingBoms
                .filter(b => !used.has(b.id))
                .map(b => ({
                    id: b.id,
                    no: b.bom_code,
                    at: stampOf(dayString(2), 2),
                    opIdx: 0,
                    bom: null as BomPlan | null,
                })),
        ];
        for (const b of pool.slice(0, quotaLeft)) {
            const snap = b.bom ? snapshotOfItems(b.bom.items) : null;
            const detail = b.bom
                ? {
                      code: b.no,
                      name: b.bom.categoryName,
                      modelCode: snap!.modelCode,
                      items: b.bom.items.map(({ materialId, groupKey, groupName, name, quantity }) => ({
                          materialId,
                          groupKey,
                          groupName,
                          name,
                          quantity,
                      })),
                      spec: snap!.spec,
                      remark: b.bom.remark,
                      creator: operators[b.opIdx].name,
                      created: b.at,
                      unit: "个",
                  }
                : { code: b.no };
            opLog("create_bom", "bom", b.id, b.no, detail, b.at, b.opIdx);
        }
    }
    // create_customer
    quotaLeft = Math.max(0, quota.createCustomer - (opNow.get("create_customer") ?? 0));
    if (quotaLeft > 0) {
        const used = usedTargets.get("create_customer") ?? new Set<string>();
        const pool = allCustomers.filter(c => !used.has(c.id)).map(c => ({ id: c.id, no: c.code, name: c.name }));
        for (const c of pool.slice(0, quotaLeft))
            opLog(
                "create_customer",
                "customer",
                c.id,
                c.no,
                { name: c.name, ownerAccount: owner.id },
                stampOf(dayString(3), 3),
                0,
            );
    }
    // create_inbound（detail = entrySnapshot 形状：no/bomCode/qty/date/remark/status/version）
    quotaLeft = Math.max(0, quota.createInbound - (opNow.get("create_inbound") ?? 0));
    if (quotaLeft > 0) {
        const used = usedTargets.get("create_inbound") ?? new Set<string>();
        const pool = [
            ...inboundPlans
                .filter(r => !used.has(r.id))
                .map(r => ({
                    id: r.id,
                    no: r.entryNo,
                    bomCode: bomCodeById.get(r.bomId) ?? "",
                    qty: r.qty,
                    day: r.day,
                    remark: r.remark,
                    at: r.createdAt,
                    opIdx: r.opIdx,
                })),
            ...existingInbounds
                .filter(r => !used.has(r.id))
                .map(r => ({
                    id: r.id,
                    no: r.entry_no,
                    bomCode: bomCodeById.get(r.bom_id) ?? "",
                    qty: r.qty,
                    day: r.business_date,
                    remark: r.remark,
                    at: `${r.business_date}T05:00:00.000Z`,
                    opIdx: 0,
                })),
        ];
        for (const r of pool.slice(0, quotaLeft)) {
            opLog(
                "create_inbound",
                "inbound",
                r.id,
                r.no,
                {
                    no: r.no,
                    bomCode: r.bomCode,
                    qty: r.qty,
                    date: r.day,
                    remark: r.remark,
                    status: "ACTIVE",
                    version: 1,
                },
                r.at,
                r.opIdx,
            );
        }
    }
    await insertRows(
        "op_log",
        [
            "id",
            "operator_id",
            "operator_name_snapshot",
            "operator_role_snapshot",
            "action",
            "target_type",
            "target_id",
            "target_code",
            "detail_json",
            "created_at",
        ],
        opRows,
    );
    if (opRows.length > 0) console.log(`[op_log] +${opRows.length}`);

    // ── 9. biz_sequence 只向前推进（GREATEST，防后端取号撞唯一键）────────────
    const seqUpsert = async (key: string, nextValue: number): Promise<void> => {
        await conn.query(
            "INSERT INTO biz_sequence (sequence_key, next_value, updated_at) VALUES (?, ?, UTC_TIMESTAMP(3)) \
             ON DUPLICATE KEY UPDATE next_value = GREATEST(next_value, VALUES(next_value)), updated_at = UTC_TIMESTAMP(3)",
            [key, nextValue],
        );
    };
    await seqUpsert("customer:global", customerSeq + 1);
    for (const [dateKey, seq] of orderSeq) await seqUpsert(`order:${dateKey}`, seq + 1);
    for (const [dateKey, seq] of inboundSeq) await seqUpsert(`inbound:${dateKey}`, seq + 1);
    for (const [dateKey, seq] of outboundSeq) await seqUpsert(`outbound:${dateKey}`, seq + 1);
    const categoryKeyById = new Map(categories.map(c => [c.id, c.category_key] as const));
    for (const [catId, seq] of nextBomSeq) {
        const key = categoryKeyById.get(catId);
        if (key) await seqUpsert(`bom:${key}`, seq + 1);
    }

    // ── 10. 自检：逐表 现有/目标，任一不达标 exit 1 ──────────────────────────
    console.log(`\n[check] 写入耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s；逐表核对（现有/目标，≥ 达标）：`);
    const checks: Array<[string, number]> = [
        ["custom_table", targets.custom_table],
        ["bom_table", targets.bom_table],
        ["bom_item", targets.bom_item],
        ["bom_category", targets.bom_category],
        ["material_group", targets.material_group],
        ["material_item", targets.material_item],
        ["sales_order_table", targets.sales_order_table],
        ["sales_order_change_log", targets.sales_order_change_log],
        ["inbound_ledger", targets.inbound_ledger],
        ["inbound_change_log", targets.inbound_change_log],
        ["outbound_shipment", targets.outbound_shipment],
        ["outbound_ledger", targets.outbound_ledger],
        ["outbound_state_log", targets.outbound_state_log],
        ["op_log", targets.op_log],
    ];
    let failed = false;
    for (const [table, target] of checks) {
        const current = await countOf(table);
        const ok = current >= target;
        if (!ok) failed = true;
        console.log(`${ok ? "PASS" : "FAIL"} ${table} ${current}/${target}`);
    }
    const avgItemsRow: Array<{ n: bigint | number }> = await conn.query(
        "SELECT COUNT(*) / NULLIF(COUNT(DISTINCT bom_id), 0) AS n FROM bom_item",
    );
    const avgOrderLines: Array<{ n: bigint | number }> = await conn.query(
        "SELECT AVG(JSON_LENGTH(JSON_EXTRACT(bom_spec_snapshot, '$.items'))) AS n FROM sales_order_table",
    );
    const voidRate: Array<{ n: bigint | number }> = await conn.query(
        "SELECT COUNT(*) / NULLIF((SELECT COUNT(*) FROM outbound_shipment), 0) * 100 AS n FROM outbound_shipment WHERE state = 'VOIDED'",
    );
    const negStock: Array<{ n: bigint | number }> = await conn.query(
        "SELECT COUNT(*) AS n FROM v_bom_stock WHERE stock_qty < 0",
    );
    console.log(
        `[shape] avgBomItems=${Number(avgItemsRow[0].n).toFixed(2)}（生产 10.8） avgOrderLines=${Number(avgOrderLines[0].n ?? 0).toFixed(2)}（生产 10.9） shipmentVoidRate=${Number(voidRate[0].n ?? 0).toFixed(1)}%（生产口径 12.5%） negativeStockBoms=${Number(negStock[0].n)}（应 0）`,
    );
    if (failed) {
        console.error("[check] 存在未达标表");
        process.exitCode = 1;
    } else {
        console.log("[check] 全部达标");
    }
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    await conn.end();
}

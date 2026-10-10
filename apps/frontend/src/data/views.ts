/* 派生视图（纯函数）：输入聚合快照，输出工作台/列表页所需行。
 * 服务端不出统计端点，全部在前端基于快照计算（与旧 store.ts 的派生函数同口径）。 */
import type { Bom, Order, OrderStatus, ReadyToShipRow, Snapshot } from "@/api";
import { todayIso } from "../lib/date.ts";

/** 加载中/无数据时的空快照，页面可直接对视图函数传值 */
export const EMPTY_SNAPSHOT: Snapshot = {
    version: 0,
    orders: [],
    boms: [],
    bomCategories: [],
    customers: [],
    inboundLedger: [],
    outboundLedger: [],
    stockAdjustments: [],
    stock: {},
    users: [],
    customerOwnerOptions: [],
};

export function bomByCode(snap: Pick<Snapshot, "boms">, code: string): Bom | undefined {
    return snap.boms.find(bom => bom.code === code);
}

/** BOM 索引：列表行渲染与 deriveOrders 共用，替代逐行线性查找；重复 code 首条胜出（与 find 语义一致） */
export function bomIndexOf(snap: Pick<Snapshot, "boms">): Map<string, Bom> {
    const index = new Map<string, Bom>();
    for (const bom of snap.boms) if (!index.has(bom.code)) index.set(bom.code, bom);
    return index;
}

export function stockOf(snap: Pick<Snapshot, "stock">, bomCode: string): number {
    return Math.max(0, snap.stock[bomCode] ?? 0);
}

export function remainingOf(order: Order): number {
    // 非活跃（已归档）订单剩余量按 0 处理：欠量关闭，不参与待交与可发量
    if (order.lifecycleStatus !== "active") return 0;
    return Math.max(0, order.qty - order.outbound);
}

/* 状态判定核心：可发量（桶模型，同"本次最多可发"口径）对比剩余待交。
 * 可发量盖不住整单剩余 → 部分可发货；已发过货且剩余可整单覆盖（或暂无可发）→ 部分发货。
 * 归档单无专属状态：归档 = 结案标记，状态徽章直接复用交付进度口径（已完成/
 * 部分发货）——归档单不参与可发（remainingOf=0），自然落入对应分支。 */
function statusOf(order: Order, maxShip: number): OrderStatus {
    if (order.outbound >= order.qty) return { label: "已完成", key: "done" };
    if (maxShip > 0 && maxShip < remainingOf(order)) return { label: "部分可发货", key: "partReady" };
    if (order.outbound > 0) return { label: "部分发货", key: "progress" };
    if (maxShip > 0) return { label: "可发货", key: "ready" };
    return { label: "待备货", key: "pending" };
}

/** 仅测试使用（页面用 orderStatusOfMax 或 deriveOrders 预计算） */
export function orderStatusOf(snap: Snapshot, order: Order): OrderStatus {
    return statusOf(order, maxShipOf(snap, order.orderNo));
}

/** 状态判定（statusOf 的公开包装）：配合 deriveOrders 预计算的可发量使用，避免逐单全量派生 */
export function orderStatusOfMax(order: Order, maxShip: number): OrderStatus {
    return statusOf(order, maxShip);
}

/* 一次派生的结果：可发量量表 + 订单/BOM 索引，统计、筛选与行组件共用
 * （替代逐单 maxShipOf 的 N 次全量 readyToShip：N² → 一次 O(N·logN)） */
export interface DerivedOrders {
    rows: ReadyToShipRow[];
    byOrderNo: Map<string, ReadyToShipRow>;
    bomIndex: Map<string, Bom>;
}

export function deriveOrders(snap: Snapshot): DerivedOrders {
    const bomIndex = bomIndexOf(snap);
    const rows = readyToShip(snap, bomIndex);
    /* 订单索引首条胜出（与旧 readyToShip().find 定位一致），重复单号时派生/单点路径取同一条 */
    const byOrderNo = new Map<string, ReadyToShipRow>();
    for (const row of rows) if (!byOrderNo.has(row.orderNo)) byOrderNo.set(row.orderNo, row);
    return { rows, byOrderNo, bomIndex };
}

/* 待发货明细：每单可发量 = min(该 BOM 当前库存, 本单剩余待交)（桶模型，不排队
 * 不预留——同 BOM 各单看到同一份库存，先登记发货者先得）；
 * bomIndex 可由调用方传入复用（deriveOrders 已建好，避免重复构建） */
export function readyToShip(snap: Snapshot, bomIndex = bomIndexOf(snap)): ReadyToShipRow[] {
    const today = todayIso();
    return snap.orders
        .filter(order => remainingOf(order) > 0)
        .sort((a, b) => a.deliverDate.localeCompare(b.deliverDate) || a.orderNo.localeCompare(b.orderNo))
        .map(order => {
            const remaining = remainingOf(order);
            const maxShip = Math.max(0, Math.min(remaining, stockOf(snap, order.bomCode)));
            return {
                orderNo: order.orderNo,
                customer: order.customer,
                customerCode: order.customerCode,
                bomCode: order.bomCode,
                bomLabel: bomIndex.get(order.bomCode)?.spec ?? "",
                deliverDate: order.deliverDate,
                remaining,
                stock: stockOf(snap, order.bomCode),
                maxShip,
                status: statusOf(order, maxShip),
                overdue: order.deliverDate < today,
            };
        });
}

export function maxShipOf(snap: Snapshot, orderNo: string): number {
    // 单点查询短路：已归档/交满订单无可发量，结构上恒为 0，免跑全量派生
    const order = snap.orders.find(item => item.orderNo === orderNo);
    if (!order || remainingOf(order) <= 0) return 0;
    return readyToShip(snap).find(row => row.orderNo === orderNo)?.maxShip ?? 0;
}

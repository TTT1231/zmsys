/* 派生视图（纯函数）：输入聚合快照，输出工作台/列表页所需行。
 * 服务端不出统计端点，全部在前端基于快照计算（与旧 store.ts 的派生函数同口径）。 */
import type {
    Bom,
    InboundRow,
    Order,
    OrderStatus,
    OutboundRow,
    PendingVsStockRow,
    ReadyToShipRow,
    RiskOrderRow,
    Snapshot,
    StockGapRow,
    TopCustomerRow,
    TrendRow,
} from "@/api";
// 注意：本文件被 node --test 直跑，运行时值导入保留相对路径 + .ts 扩展名
import { addDays, todayIso } from "../lib/date.ts";

/** 加载中/无数据时的空快照，页面可直接对视图函数传值 */
export const EMPTY_SNAPSHOT: Snapshot = {
    version: 0,
    orders: [],
    boms: [],
    customers: [],
    inboundLedger: [],
    outboundLedger: [],
    stock: {},
    users: [],
    systemEvents: [],
};

export function bomByCode(snap: Pick<Snapshot, "boms">, code: string): Bom | undefined {
    return snap.boms.find(bom => bom.code === code);
}

export function stockOf(snap: Pick<Snapshot, "stock">, bomCode: string): number {
    return Math.max(0, snap.stock[bomCode] ?? 0);
}

export function remainingOf(order: Order): number {
    return Math.max(0, order.qty - order.outbound);
}

export function orderStatusOf(snap: Pick<Snapshot, "stock">, order: Order): OrderStatus {
    if (order.outbound >= order.qty) return { label: "已完成", key: "done" };
    if (order.outbound > 0) return { label: "部分发货", key: "progress" };
    if (stockOf(snap, order.bomCode) > 0) return { label: "可发货", key: "ready" };
    return { label: "待备货", key: "pending" };
}

export function statusCounts(snap: Pick<Snapshot, "orders" | "stock">) {
    const counts = { total: snap.orders.length, done: 0, progress: 0, ready: 0, pending: 0 };
    snap.orders.forEach(order => {
        counts[orderStatusOf(snap, order).key] += 1;
    });
    return counts;
}

/* 待发货明细：按交期顺序在共享库存池上做可发量分配（同一 BOM 库存不重复承诺） */
export function readyToShip(snap: Snapshot): ReadyToShipRow[] {
    const left = new Map(Object.entries(snap.stock));
    const today = todayIso();
    return snap.orders
        .filter(order => remainingOf(order) > 0)
        .sort((a, b) => a.deliverDate.localeCompare(b.deliverDate) || a.orderNo.localeCompare(b.orderNo))
        .map(order => {
            const available = left.get(order.bomCode) ?? 0;
            const remaining = remainingOf(order);
            const maxShip = Math.max(0, Math.min(remaining, available));
            if (maxShip > 0) left.set(order.bomCode, available - maxShip);
            return {
                orderNo: order.orderNo,
                customer: order.customer,
                customerCode: order.customerCode,
                bomCode: order.bomCode,
                bomLabel: bomByCode(snap, order.bomCode)?.spec ?? "",
                deliverDate: order.deliverDate,
                remaining,
                stock: stockOf(snap, order.bomCode),
                maxShip,
                status: orderStatusOf(snap, order),
                overdue: order.deliverDate < today,
            };
        });
}

export function maxShipOf(snap: Snapshot, orderNo: string): number {
    return readyToShip(snap).find(row => row.orderNo === orderNo)?.maxShip ?? 0;
}

export function pendingVsStock(snap: Snapshot, limit: number): PendingVsStockRow[] {
    return readyToShip(snap)
        .sort((a, b) => a.deliverDate.localeCompare(b.deliverDate) || b.remaining - a.remaining)
        .slice(0, limit)
        .map(row => {
            const order = snap.orders.find(item => item.orderNo === row.orderNo)!;
            return {
                id: row.orderNo,
                customer: row.customer,
                bomCode: row.bomCode,
                bomLabel: row.bomLabel,
                productType: "通用产品",
                version: "V1.0",
                deliverDate: row.deliverDate.slice(5).replace("-", "/"),
                ordered: order.qty,
                shipped: order.outbound,
                remaining: row.remaining,
                stock: row.stock,
                maxShip: row.maxShip,
                overdue: row.overdue,
            };
        });
}

export function riskOrders(snap: Snapshot, limit?: number): RiskOrderRow[] {
    const today = todayIso();
    const rows = readyToShip(snap)
        .filter(row => row.maxShip < row.remaining && row.deliverDate <= addDays(today, 14))
        .sort((a, b) => a.deliverDate.localeCompare(b.deliverDate))
        .map(row => {
            const order = snap.orders.find(item => item.orderNo === row.orderNo)!;
            return {
                orderNo: row.orderNo,
                customer: row.customer,
                customerCode: row.customerCode,
                bomCode: row.bomCode,
                bomLabel: row.bomLabel,
                deliverDate: row.deliverDate,
                qty: order.qty,
                outbound: order.outbound,
                remaining: row.remaining,
                stock: row.stock,
                maxShip: row.maxShip,
                overdue: row.deliverDate < today,
            };
        });
    return limit ? rows.slice(0, limit) : rows;
}

export function stockGapList(snap: Snapshot): StockGapRow[] {
    const today = todayIso();
    const list: StockGapRow[] = [];
    const byBom = new Map<string, Order[]>();
    snap.orders
        .filter(order => remainingOf(order) > 0)
        .forEach(order => {
            if (!byBom.has(order.bomCode)) byBom.set(order.bomCode, []);
            byBom.get(order.bomCode)!.push(order);
        });
    byBom.forEach((orders, bomCode) => {
        const stockQty = stockOf(snap, bomCode);
        const demandQty = orders.reduce((sum, order) => sum + remainingOf(order), 0);
        if (demandQty <= stockQty) return;
        const sorted = [...orders].sort((a, b) => a.deliverDate.localeCompare(b.deliverDate));
        const earliest = sorted[0];
        list.push({
            bomCode,
            gapQty: demandQty - stockQty,
            demandQty,
            stockQty,
            orderCount: orders.length,
            earliestDate: earliest.deliverDate,
            earliestOrderNo: earliest.orderNo,
            earliestCustomer: earliest.customer,
            earliestOverdue: earliest.deliverDate < today,
        });
    });
    return list.sort((a, b) => a.earliestDate.localeCompare(b.earliestDate));
}

export function dailyTrend(snap: Snapshot, days: number): TrendRow[] {
    const today = todayIso();
    const buckets: string[] = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) buckets.push(addDays(today, -offset));
    const result: TrendRow[] = buckets.map(date => ({
        date,
        label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
        orderedQty: 0,
        orderedCount: 0,
        inboundQty: 0,
        inboundCount: 0,
        outboundQty: 0,
        outboundCount: 0,
    }));
    const index = new Map(result.map(row => [row.date, row]));
    snap.orders.forEach(order => {
        const row = index.get(order.orderDate);
        if (row) {
            row.orderedQty += order.qty;
            row.orderedCount += 1;
        }
    });
    snap.inboundLedger.forEach(row => {
        const bucket = index.get(row.date);
        if (bucket) {
            bucket.inboundQty += row.qty;
            bucket.inboundCount += 1;
        }
    });
    snap.outboundLedger.forEach(row => {
        const bucket = index.get(row.date);
        if (bucket) {
            bucket.outboundQty += row.qty;
            bucket.outboundCount += 1;
        }
    });
    return result;
}

export function topCustomers(snap: Snapshot, limit?: number): TopCustomerRow[] {
    const byCustomer = new Map<string, TopCustomerRow>();
    snap.orders.forEach(order => {
        const entry = byCustomer.get(order.customerCode) || {
            customer: order.customer,
            customerCode: order.customerCode,
            orderCount: 0,
            totalQty: 0,
            outboundQty: 0,
            pendingQty: 0,
        };
        entry.orderCount += 1;
        entry.totalQty += order.qty;
        entry.outboundQty += order.outbound;
        entry.pendingQty += remainingOf(order);
        byCustomer.set(order.customerCode, entry);
    });
    const rows = [...byCustomer.values()].sort((a, b) => b.totalQty - a.totalQty);
    return limit ? rows.slice(0, limit) : rows;
}

export function recentInbound(snap: Snapshot, limit?: number): Array<InboundRow & { bomLabel: string }> {
    const rows = [...snap.inboundLedger]
        .sort((a, b) => (a.date === b.date ? b.no.localeCompare(a.no) : b.date.localeCompare(a.date)))
        .map(row => ({ ...row, bomLabel: bomByCode(snap, row.bomCode)?.spec ?? "" }));
    return limit ? rows.slice(0, limit) : rows;
}

export function recentOutbound(snap: Snapshot, limit?: number): OutboundRow[] {
    const rows = [...snap.outboundLedger].sort((a, b) =>
        a.date === b.date ? b.no.localeCompare(a.no) : b.date.localeCompare(a.date),
    );
    return limit ? rows.slice(0, limit) : rows;
}

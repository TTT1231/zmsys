/* 派生视图（纯函数）：输入聚合快照，输出工作台/列表页所需行。
 * 服务端不出统计端点，全部在前端基于快照计算（与旧 store.ts 的派生函数同口径）。 */
import type { Bom, Order, OrderStatus, ReadyToShipRow, Snapshot, StockGapRow, TrendRow } from "@/api";
// 注意：本文件被 node --test 直跑，运行时值导入保留相对路径 + .ts 扩展名
import { addDays, todayIso } from "../lib/date.ts";

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

export function stockOf(snap: Pick<Snapshot, "stock">, bomCode: string): number {
    return Math.max(0, snap.stock[bomCode] ?? 0);
}

export function remainingOf(order: Order): number {
    if (order.lifecycleStatus === "cancelled") return 0;
    return Math.max(0, order.qty - order.outbound);
}

export function orderStatusOf(snap: Pick<Snapshot, "stock">, order: Order): OrderStatus {
    if (order.lifecycleStatus === "cancelled")
        return { label: order.outbound > 0 ? "部分发货后取消" : "已取消", key: "cancelled" };
    if (order.outbound >= order.qty) return { label: "已完成", key: "done" };
    if (order.outbound > 0) return { label: "部分发货", key: "progress" };
    if (stockOf(snap, order.bomCode) > 0) return { label: "可发货", key: "ready" };
    return { label: "待备货", key: "pending" };
}

/* 待发货明细：按交期顺序在共享库存池上做可发量分配（同一 BOM 库存不重复承诺） */
export function readyToShip(snap: Snapshot): ReadyToShipRow[] {
    const left = new Map(Object.entries(snap.stock));
    const today = todayIso();
    return snap.orders
        .filter(order => remainingOf(order) > 0)
        .sort((a, b) => a.deliverEnd.localeCompare(b.deliverEnd) || a.orderNo.localeCompare(b.orderNo))
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
                deliverStart: order.deliverStart,
                deliverEnd: order.deliverEnd,
                remaining,
                stock: stockOf(snap, order.bomCode),
                maxShip,
                status: orderStatusOf(snap, order),
                overdue: order.deliverEnd < today,
            };
        });
}

export function maxShipOf(snap: Snapshot, orderNo: string): number {
    return readyToShip(snap).find(row => row.orderNo === orderNo)?.maxShip ?? 0;
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
        const sorted = [...orders].sort((a, b) => a.deliverEnd.localeCompare(b.deliverEnd));
        const earliest = sorted[0];
        list.push({
            bomCode,
            gapQty: demandQty - stockQty,
            demandQty,
            stockQty,
            orderCount: orders.length,
            earliestDate: earliest.deliverEnd,
            earliestOrderNo: earliest.orderNo,
            earliestCustomer: earliest.customer,
            earliestOverdue: earliest.deliverEnd < today,
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
    snap.inboundLedger
        .filter(row => row.status === "active")
        .forEach(row => {
            const bucket = index.get(row.date);
            if (bucket) {
                bucket.inboundQty += row.qty;
                bucket.inboundCount += 1;
            }
        });
    snap.outboundLedger
        .filter(row => row.state !== "voided")
        .forEach(row => {
            const bucket = index.get(row.date);
            if (bucket) {
                bucket.outboundQty += row.qty;
                bucket.outboundCount += 1;
            }
        });
    return result;
}

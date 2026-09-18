/* 老板工作台的独立读模型与纯聚合；库存和风险始终按截至日的全部有效订单计算。 */
import { addDays } from "../lib/date.ts";

export interface WorkbenchProduct {
    code: string;
    category: string;
    model: string;
    spec: string;
    unit: string;
    stock: number;
}

export interface WorkbenchOrder {
    no: string;
    customerCode: string;
    customer: string;
    bomCode: string;
    date: string;
    due: string;
    qty: number;
    shipped: number;
    cancelled?: boolean;
}

export interface WorkbenchMovement {
    date: string;
    bomCode: string;
    inbound: number;
    outbound: number;
}

/** 接真实数据时由数据适配层提供此模型；数量必须使用同一种计量单位。 */
export interface WorkbenchData {
    asOf: string;
    unit: string;
    products: WorkbenchProduct[];
    orders: WorkbenchOrder[];
    movements: WorkbenchMovement[];
}

export interface WorkbenchRange {
    start: string;
    end: string;
}
export type RankingMetric = "qty" | "count";
export const openQty = (order: WorkbenchOrder) => (order.cancelled ? 0 : Math.max(0, order.qty - order.shipped));
// 取消订单只保留实际履行部分，取消的未履行数量不算需求。
export const demandQty = (order: WorkbenchOrder) => (order.cancelled ? order.shipped : order.qty);
export const withinRange = (date: string, range: WorkbenchRange) => date >= range.start && date <= range.end;

export function summarizeWorkbench(data: WorkbenchData, range: WorkbenchRange) {
    const orders = data.orders.filter(order => withinRange(order.date, range));
    const products = data.products.map(product => {
        const selected = orders.filter(order => order.bomCode === product.code);
        const currentDemand = data.orders
            .filter(order => order.bomCode === product.code)
            .reduce((sum, order) => sum + openQty(order), 0);
        return {
            ...product,
            qty: selected.reduce((sum, order) => sum + demandQty(order), 0),
            shipped: selected.reduce((sum, order) => sum + order.shipped, 0),
            remaining: selected.reduce((sum, order) => sum + openQty(order), 0),
            gap: Math.max(0, currentDemand - product.stock),
        };
    });
    const categories = [...new Set(products.map(product => product.category))].map(name => {
        const children = products.filter(product => product.category === name);
        const total = (key: "qty" | "shipped" | "remaining" | "stock" | "gap") =>
            children.reduce((sum, product) => sum + product[key], 0);
        return {
            name,
            children,
            qty: total("qty"),
            shipped: total("shipped"),
            remaining: total("remaining"),
            stock: total("stock"),
            gap: total("gap"),
        };
    });
    return {
        orders,
        categories,
        qty: products.reduce((sum, product) => sum + product.qty, 0),
        shipped: products.reduce((sum, product) => sum + product.shipped, 0),
        remaining: products.reduce((sum, product) => sum + product.remaining, 0),
        completed: orders.filter(order => !order.cancelled && order.shipped >= order.qty).length,
        activeCount: orders.filter(order => !order.cancelled).length,
    };
}

export function workbenchRisks(data: WorkbenchData) {
    const stock = new Map(data.products.map(product => [product.code, product.stock]));
    return data.orders
        .filter(order => openQty(order) > 0)
        .sort((a, b) => a.due.localeCompare(b.due) || a.no.localeCompare(b.no))
        .map(order => {
            const available = Math.max(0, stock.get(order.bomCode) ?? 0);
            const allocated = Math.min(available, openQty(order));
            stock.set(order.bomCode, available - allocated);
            return {
                ...order,
                remaining: openQty(order),
                gap: openQty(order) - allocated,
                kind: order.due < data.asOf ? ("overdue" as const) : ("upcoming" as const),
            };
        })
        .filter(order => order.kind === "overdue" || (order.due <= addDays(data.asOf, 7) && order.gap > 0));
}

export function customerRanking(orders: WorkbenchOrder[], metric: RankingMetric) {
    const customers = new Map<
        string,
        { code: string; name: string; count: number; qty: number; shipped: number; remaining: number }
    >();
    orders
        .filter(order => !order.cancelled || order.shipped > 0)
        .forEach(order => {
            const row = customers.get(order.customerCode) ?? {
                code: order.customerCode,
                name: order.customer,
                count: 0,
                qty: 0,
                shipped: 0,
                remaining: 0,
            };
            row.count += 1;
            row.qty += demandQty(order);
            row.shipped += order.shipped;
            row.remaining += openQty(order);
            customers.set(row.code, row);
        });
    return [...customers.values()]
        .sort((a, b) => b[metric] - a[metric] || b.qty - a.qty || a.code.localeCompare(b.code))
        .slice(0, 20);
}

export function workbenchTrend(data: WorkbenchData, range: WorkbenchRange, category: string, monthly = false) {
    const codes = new Set(
        data.products.filter(product => !category || product.category === category).map(product => product.code),
    );
    const buckets = new Map<string, { date: string; inbound: number; outbound: number }>();
    for (let date = range.start; date <= range.end; date = addDays(date, 1)) {
        const key = monthly ? date.slice(0, 7) : date;
        if (!buckets.has(key)) buckets.set(key, { date: key, inbound: 0, outbound: 0 });
    }
    data.movements
        .filter(row => codes.has(row.bomCode) && withinRange(row.date, range))
        .forEach(row => {
            const bucket = buckets.get(monthly ? row.date.slice(0, 7) : row.date);
            if (bucket) {
                bucket.inbound += row.inbound;
                bucket.outbound += row.outbound;
            }
        });
    return [...buckets.values()];
}

import { openQty, type WorkbenchData } from "./workbench";

/** 日历日差按 ISO 日期计算，不受浏览器时区或夏令时影响。 */
export const calendarDays = (from: string, to: string) =>
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/** BOM 编码本身决定颜色，跨刷新、数据排序和设备保持一致。 */
export function bomColorHue(code: string) {
    let hash = 2166136261;
    for (const char of code) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return Math.floor((((hash >>> 0) * 0.61803398875) % 1) * 36000) / 100;
}

/** 全量有效欠单按交期分配共享库存；时间窗口只改变绘图，不改变库存分配。 */
export function deliveryProgress(data: WorkbenchData) {
    const products = new Map(data.products.map(product => [product.code, product]));
    const stock = new Map(data.products.map(product => [product.code, Math.max(0, product.stock)]));
    const counts = new Map<string, number>();
    const orders = data.orders
        .filter(order => openQty(order) > 0)
        .sort((a, b) => a.due.localeCompare(b.due) || a.no.localeCompare(b.no));
    for (const order of orders) counts.set(order.bomCode, (counts.get(order.bomCode) ?? 0) + 1);
    return orders.map(order => {
        const qty = Math.max(0, order.qty);
        const shipped = Math.min(qty, Math.max(0, order.shipped));
        const remaining = qty - shipped;
        const available = Math.min(remaining, stock.get(order.bomCode) ?? 0);
        stock.set(order.bomCode, (stock.get(order.bomCode) ?? 0) - available);
        const gap = remaining - available;
        const ready = shipped + available;
        const product = products.get(order.bomCode);
        return {
            ...order,
            qty,
            shipped,
            remaining,
            available,
            gap,
            ready,
            // 没备齐时不能因四舍五入显示 100%，避免小数量缺口被掩盖。
            readyPercent: gap === 0 ? 100 : Math.floor((ready / qty) * 100),
            shippedPercent: Math.floor((shipped / qty) * 100),
            daysLeft: calendarDays(data.asOf, order.due),
            colorHue: bomColorHue(order.bomCode),
            sharedCount: counts.get(order.bomCode) ?? 1,
            product,
        };
    });
}

export type DeliveryOrder = ReturnType<typeof deliveryProgress>[number];

/** 日期落在日格中心；跨窗口条带裁切，窗外交期保留方向与明确的日期说明。 */
export function deliveryTimeSpan(order: Pick<DeliveryOrder, "date" | "due">, start: string, days: number, offset = 0) {
    const datePosition = (date: string) => ((calendarDays(start, date) - offset + 0.5) / days) * 100;
    const rawStart = datePosition(order.date);
    const rawEnd = datePosition(order.due);
    const left = Math.max(0, Math.min(100, rawStart));
    const end = Math.max(left, Math.min(100, rawEnd));
    return {
        left,
        width: end - left,
        duePosition: Math.max(1, Math.min(99, rawEnd)),
        outside: rawEnd < 0 ? ("before" as const) : rawEnd > 100 ? ("after" as const) : null,
    };
}

export interface DeliveryViewport {
    offset: number;
    days: number;
}

/** 以指针所在日期为缩放锚点，缩放后保持该日期的位置，避免丢失方向。 */
export function zoomDeliveryViewport(view: DeliveryViewport, factor: number, anchor: number): DeliveryViewport {
    const days = Math.max(5, Math.min(90, view.days * factor));
    const ratio = Math.max(0, Math.min(1, anchor));
    return { offset: view.offset + (view.days - days) * ratio, days };
}

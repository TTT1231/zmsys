import { openQty, type WorkbenchData } from "./workbench";

/** 日历日差按 ISO 日期计算，不受浏览器时区或夏令时影响。 */
export const calendarDays = (from: string, to: string) =>
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

export interface DeliveryColor {
    hue: number;
    lightness: number;
    chroma: number;
}

/* 蓝、紫、黄、青绿、橙、粉、天蓝、绿、靛、红、橄榄、棕。
   用明确的色系代替任意相近色相；黄色用较亮的明度保留辨识度。 */
const BOM_PALETTE: readonly DeliveryColor[] = [
    { hue: 255, lightness: 56, chroma: 0.2 },
    { hue: 305, lightness: 57, chroma: 0.22 },
    { hue: 95, lightness: 78, chroma: 0.17 },
    { hue: 180, lightness: 55, chroma: 0.12 },
    { hue: 55, lightness: 68, chroma: 0.19 },
    { hue: 345, lightness: 63, chroma: 0.22 },
    { hue: 225, lightness: 64, chroma: 0.15 },
    { hue: 145, lightness: 57, chroma: 0.17 },
    { hue: 280, lightness: 46, chroma: 0.22 },
    { hue: 25, lightness: 57, chroma: 0.21 },
    { hue: 115, lightness: 51, chroma: 0.12 },
    { hue: 65, lightness: 44, chroma: 0.09 },
];

function bomHash(code: string) {
    let hash = 2166136261;
    for (const char of code) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 0;
}

function colorCoordinates(color: DeliveryColor) {
    const angle = (color.hue * Math.PI) / 180;
    return [color.lightness / 100, color.chroma * Math.cos(angle), color.chroma * Math.sin(angle)] as const;
}

function coordinateDistance(a: readonly number[], b: readonly number[]) {
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function colorDistance(a: DeliveryColor, b: DeliveryColor) {
    return coordinateDistance(colorCoordinates(a), colorCoordinates(b));
}

/** 同屏 BOM 去重后确定性分配，优先保持编码的身份色，冲突时使用空闲色系。 */
export function bomColors(codes: Iterable<string>) {
    const uniqueCodes = [...new Set(codes)].sort();
    const colors = new Map<string, DeliveryColor>();
    const used = new Set<number>();
    // 基础色用完后，从更大色域挑选与所有已分配颜色距离最远的候选，避免固定偏移的近似色。
    const hueCount = Math.max(36, Math.ceil(uniqueCodes.length / 5));
    const candidates =
        uniqueCodes.length > BOM_PALETTE.length
            ? [46, 54, 62, 70, 78].flatMap(lightness =>
                  [0.12, 0.17, 0.22].flatMap(chroma =>
                      Array.from({ length: hueCount }, (_, index) => ({
                          hue: (index * 360) / hueCount,
                          lightness,
                          chroma,
                      })),
                  ),
              )
            : [];
    const coordinates = candidates.map(colorCoordinates);
    const distances = new Float64Array(candidates.length).fill(Infinity);
    for (const code of uniqueCodes) {
        let index = bomHash(code) % BOM_PALETTE.length;
        let color: DeliveryColor;
        if (colors.size < BOM_PALETTE.length) {
            const separation = (candidate: DeliveryColor) =>
                Math.min(1, ...[...colors.values()].map(color => colorDistance(candidate, color)));
            if (used.has(index) || separation(BOM_PALETTE[index]) < 0.18 ** 2) {
                let best = -1;
                for (let candidate = 0; candidate < BOM_PALETTE.length; candidate++) {
                    if (used.has(candidate)) continue;
                    const distance = separation(BOM_PALETTE[candidate]);
                    if (distance > best) {
                        index = candidate;
                        best = distance;
                    }
                }
            }
            used.add(index);
            color = BOM_PALETTE[index];
        } else {
            let best = 0;
            for (let candidate = 1; candidate < distances.length; candidate++) {
                if (distances[candidate] > distances[best]) best = candidate;
            }
            color = candidates[best];
            distances[best] = -1;
        }
        colors.set(code, color);
        const assigned = colorCoordinates(color);
        for (let candidate = 0; candidate < distances.length; candidate++) {
            distances[candidate] = Math.min(distances[candidate], coordinateDistance(assigned, coordinates[candidate]));
        }
    }
    return colors;
}

/** 全量有效欠单按交期分配共享库存；时间窗口只改变绘图，不改变库存分配。 */
export function deliveryProgress(data: WorkbenchData) {
    const products = new Map(data.products.map(product => [product.code, product]));
    const stock = new Map(data.products.map(product => [product.code, Math.max(0, product.stock)]));
    const counts = new Map<string, number>();
    const orders = data.orders
        .filter(order => openQty(order) > 0)
        .sort((a, b) => a.due.localeCompare(b.due) || a.no.localeCompare(b.no));
    const colors = bomColors(orders.map(order => order.bomCode));
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
            color: colors.get(order.bomCode)!,
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

/** 首屏尽量完整显示待交订单与今天，避免逾期订单一进来就落在窗外。 */
export function initialDeliveryViewport(orders: Pick<DeliveryOrder, "date" | "due">[], asOf: string): DeliveryViewport {
    let first = 0;
    let last = 0;
    for (const order of orders) {
        first = Math.min(first, calendarDays(asOf, order.date), calendarDays(asOf, order.due));
        last = Math.max(last, calendarDays(asOf, order.date), calendarDays(asOf, order.due));
    }
    if (first >= -7 && last <= 7) return { offset: -7, days: 15 };
    const days = Math.min(90, Math.max(15, last - first + 5));
    return { offset: Math.max(first - 2, last + 3 - days), days };
}

/** 数量分段依附完整订单区间，再裁切到视窗；平移不会重新计算数量占比。 */
export function deliveryTimeSegments(
    order: Pick<DeliveryOrder, "date" | "due" | "qty" | "shipped" | "available">,
    start: string,
    days: number,
    offset = 0,
) {
    const span = deliveryTimeSpan(order, start, days, offset);
    const rawStart = ((calendarDays(start, order.date) - offset + 0.5) / days) * 100;
    const duration = Math.max(0, (calendarDays(order.date, order.due) / days) * 100);
    const shippedEnd = rawStart + duration * (order.qty > 0 ? order.shipped / order.qty : 0);
    const availableEnd = shippedEnd + duration * (order.qty > 0 ? order.available / order.qty : 0);
    const width = (from: number, to: number) =>
        span.width > 0 ? (Math.max(0, Math.min(100, to) - Math.max(0, from)) / span.width) * 100 : 0;
    return { ...span, shippedWidth: width(rawStart, shippedEnd), availableWidth: width(shippedEnd, availableEnd) };
}

/** 以指针所在日期为缩放锚点，缩放后保持该日期的位置，避免丢失方向。 */
export function zoomDeliveryViewport(view: DeliveryViewport, factor: number, anchor: number): DeliveryViewport {
    const days = Math.max(5, Math.min(90, view.days * factor));
    const ratio = Math.max(0, Math.min(1, anchor));
    return { offset: view.offset + (view.days - days) * ratio, days };
}

import { describe, expect, it } from "vitest";
import {
    bomColors,
    calendarDays,
    deliveryProgress,
    deliveryTimeSpan,
    fullDeliveryViewport,
    initialDeliveryViewport,
    zoomDeliveryViewport,
} from "@/data/delivery-progress";
import type { WorkbenchData, WorkbenchOrder } from "@/data/workbench";

const order = (patch: Partial<WorkbenchOrder> = {}): WorkbenchOrder => ({
    no: "SO1",
    customerCode: "C1",
    customer: "客户",
    bomCode: "B1",
    date: "2026-09-01",
    due: "2026-10-08",
    qty: 100,
    shipped: 20,
    ...patch,
});
const data = (orders: WorkbenchOrder[]): WorkbenchData => ({
    asOf: "2026-10-08",
    unit: "个",
    movements: [],
    orders,
    products: [
        { code: "B1", category: "开关", model: "M1", spec: "二脚", stock: 50, unit: "个" },
        { code: "B2", category: "开关", model: "M2", spec: "三脚", stock: 1000, unit: "个" },
    ],
});

describe("交付进度", () => {
    it("只显示未完成订单，归档欠单与已发完的同 BOM 单不占用库存", () => {
        const result = deliveryProgress(
            data([order(), order({ no: "done", shipped: 100 }), order({ no: "archived", archived: true, shipped: 0 })]),
        );
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            remaining: 80,
            available: 50,
            gap: 30,
            readyPercent: 70,
            sharedCount: 1,
            daysLeft: 0,
        });
    });
    it("全量按交期再按订单号分配共享库存，既不重复分配也不跨 BOM 抵扣", () => {
        const snapshot = data([
            order({ no: "later", due: "2026-11-01", qty: 50, shipped: 0 }),
            order({ no: "B", qty: 40, shipped: 0 }),
            order({ no: "A", qty: 40, shipped: 0 }),
            order({ no: "other", bomCode: "B2", qty: 80, shipped: 0 }),
        ]);
        const result = deliveryProgress(snapshot);
        expect(result.map(row => [row.no, row.available, row.gap])).toEqual([
            ["A", 40, 0],
            ["B", 10, 30],
            ["other", 80, 0],
            ["later", 0, 50],
        ]);
        expect(result.filter(row => row.bomCode === "B1").every(row => row.sharedCount === 3)).toBe(true);
        expect(deliveryProgress({ ...snapshot, orders: [...snapshot.orders].reverse() })).toEqual(result);
    });
    it("保留缺口而非将 99.99% 四舍五入为备齐，缺失 BOM 库存按零处理", () => {
        const result = deliveryProgress(data([order({ qty: 10000, shipped: 9999, bomCode: "missing" })]));
        expect(result[0]).toMatchObject({ readyPercent: 99, shippedPercent: 99, gap: 1, available: 0 });
    });
    it("同 BOM 自动同色，顺序变化不会改变颜色，空闲颜色不会影响原有 BOM", () => {
        const a = deliveryProgress(data([order()]));
        const b = deliveryProgress(data([order({ no: "other", bomCode: "B2" }), order()]));
        expect(b.find(row => row.no === "SO1")?.color).toEqual(a[0].color);
        expect(bomColors(["B1"]).get("B1")).toEqual(a[0].color);
    });
    it("KW005 与 KD001 使用明显不同的色系，碰撞编码不会复用已占用颜色", () => {
        const codes = ["KW005", "KD001", "KQ006", "KW001", "KR001", "KQ011", "XW016", "B1", "B2", "B3", "B4", "B5"];
        const colors = bomColors(codes);
        const pair = bomColors(["KW005", "KD001"]);
        expect(Math.abs(pair.get("KW005")!.hue - pair.get("KD001")!.hue)).toBeGreaterThan(60);
        expect(colors.get("KD001")).not.toEqual(colors.get("KQ006"));
        expect(new Set([...colors.values()].map(color => JSON.stringify(color))).size).toBe(codes.length);
        expect(bomColors([...codes].reverse())).toEqual(colors);
        expect(bomColors([...codes, "KD001"])).toEqual(colors);
    });
    it("基础色板用完后扩展颜色，与其他 BOM 保持差异而非仅挪动一点色相", () => {
        const codes = Array.from({ length: 30 }, (_, index) => `KD${index}`);
        const colors = bomColors(codes);
        expect(new Set([...colors.values()].map(color => JSON.stringify(color))).size).toBe(codes.length);
        const values = [...colors.values()].map(color => {
            const angle = (color.hue * Math.PI) / 180;
            return [color.lightness / 100, color.chroma * Math.cos(angle), color.chroma * Math.sin(angle)];
        });
        for (let index = 0; index < values.length; index++) {
            for (let other = index + 1; other < values.length; other++) {
                const a = values[index],
                    b = values[other];
                expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(0.09);
            }
        }
        expect(bomColors([...codes].reverse())).toEqual(colors);
    });
});

describe("时间线平移与缩放", () => {
    it("默认四周聚焦今天，早期和远期交期保留窗外方向", () => {
        const view = initialDeliveryViewport();
        expect(view.days).toBe(28);
        expect(view.offset).toBeLessThan(0);
        expect(view.offset + view.days).toBeGreaterThan(0);
        expect(deliveryTimeSpan(order({ due: "2026-09-30" }), "2026-10-08", view.days, view.offset).outside).toBe(
            "before",
        );
        expect(deliveryTimeSpan(order({ due: "2026-11-15" }), "2026-10-08", view.days, view.offset).outside).toBe(
            "after",
        );
    });
    it("完整跨度覆盖待交订单和今天，发完与归档订单不挤占视窗", () => {
        const snapshot = data([
            order({ date: "2026-09-01", due: "2026-09-30" }),
            order({ no: "later", date: "2026-10-01", due: "2026-10-21" }),
            order({ no: "done", date: "2025-01-01", shipped: 100 }),
            order({ no: "archive", date: "2025-01-01", archived: true }),
        ]);
        const orders = deliveryProgress(snapshot);
        const view = fullDeliveryViewport(orders, snapshot.asOf);
        expect(view.days).toBeLessThanOrEqual(90);
        expect(view.offset).toBeLessThan(0);
        expect(view.offset + view.days).toBeGreaterThan(0);
        for (const row of orders) {
            const span = deliveryTimeSpan(row, snapshot.asOf, view.days, view.offset);
            expect(span.outside).toBeNull();
            expect(span.left).toBeGreaterThan(0);
        }
    });
    it("超过 90 天的完整跨度仍覆盖早期订单，放大后能缩回完整跨度", () => {
        const rows = [order({ date: "2025-01-01", due: "2026-10-14" })];
        const view = fullDeliveryViewport(rows, "2026-10-08");
        expect(view.days).toBeGreaterThan(90);
        expect(deliveryTimeSpan(rows[0], "2026-10-08", view.days, view.offset)).toMatchObject({ outside: null });
        expect(deliveryTimeSpan(rows[0], "2026-10-08", view.days, view.offset).left).toBeGreaterThan(0);
        const zoomed = zoomDeliveryViewport(view, 0.8, 0.5, view.days);
        expect(zoomDeliveryViewport(zoomed, 1.25, 0.5, view.days).days).toBeCloseTo(view.days);
        expect(zoomDeliveryViewport(zoomed, 1.25, 0.5, view.days).offset).toBeCloseTo(view.offset);
    });
    it("日期和交期落在格子中心，窗外交期仍有方向，平移不改变订单数据", () => {
        const inside = deliveryTimeSpan(order({ date: "2026-10-03", due: "2026-10-08" }), "2026-10-01", 15);
        expect(inside.left).toBeCloseTo(100 / 6);
        expect(inside.duePosition).toBe(50);
        expect(inside.width).toBeCloseTo(100 / 3);
        expect(inside.outside).toBeNull();
        expect(deliveryTimeSpan(order({ due: "2026-09-30" }), "2026-10-01", 15)).toMatchObject({
            width: 0,
            outside: "before",
        });
        expect(deliveryTimeSpan(order({ due: "2026-11-01" }), "2026-10-01", 15)).toMatchObject({ outside: "after" });
        expect(calendarDays("2026-12-31", "2027-01-01")).toBe(1);
        expect(calendarDays("2024-02-28", "2024-03-01")).toBe(2);
    });
    it("以鼠标日期为锚点缩放，范围限制在 5–90 天", () => {
        const view = { offset: -7, days: 15 };
        const next = zoomDeliveryViewport(view, 0.5, 0.7);
        expect(view.offset + view.days * 0.7).toBeCloseTo(next.offset + next.days * 0.7);
        expect(next.days).toBe(7.5);
        expect(zoomDeliveryViewport(view, 0.001, 0.5).days).toBe(5);
        expect(zoomDeliveryViewport(view, 100, 0.5).days).toBe(90);
        expect(zoomDeliveryViewport(view, 0.5, -1).offset).toBe(view.offset);
    });
});

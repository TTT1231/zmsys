import { describe, expect, it } from "vitest";
import {
    bomColorHue,
    calendarDays,
    deliveryProgress,
    deliveryTimeSpan,
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
    it("同 BOM 颜色不随排序与其他 BOM 的增删变化", () => {
        const a = deliveryProgress(data([order()]));
        const b = deliveryProgress(data([order({ no: "other", bomCode: "B2" }), order()]));
        expect(b.find(row => row.no === "SO1")?.colorHue).toBe(a[0].colorHue);
        expect(bomColorHue("B1")).toBe(a[0].colorHue);
    });
});

describe("时间线平移与缩放", () => {
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

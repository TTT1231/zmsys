/* views 派生视图纯函数：固定系统时间后断言四态、共享库存分配、缺口聚合与趋势分桶 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bom, Order, Snapshot } from "@/api";

import {
    EMPTY_SNAPSHOT,
    bomByCode,
    dailyTrend,
    maxShipOf,
    orderStatusOf,
    readyToShip,
    remainingOf,
    stockGapList,
    stockOf,
} from "@/data/views";

const TODAY = "2026-03-15";

const bom = (over: Partial<Bom> = {}): Bom => ({
    code: "ZMXK001",
    name: "旋转开关",
    modelCode: "M-100",
    specs: {},
    spec: "二脚 / 一档",
    created: "2026-01-01",
    unit: "个",
    ...over,
});

const order = (over: Partial<Order> = {}): Order => ({
    version: 1,
    orderNo: "ZM260315001",
    customer: "华兴精密",
    customerCode: "CUS-1024",
    bomCode: "ZMXK001",
    qty: 10,
    outbound: 0,
    orderDate: "2026-03-10",
    deliverStart: "2026-03-15",
    deliverEnd: "2026-03-20",
    remark: "",
    lifecycleStatus: "active",
    ...over,
});

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
    ...EMPTY_SNAPSHOT,
    boms: [bom()],
    stock: { ZMXK001: 0 },
    ...over,
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T10:00:00`));
});

afterEach(() => {
    vi.useRealTimers();
});

describe("bomByCode / stockOf / remainingOf", () => {
    it("finds bom by code", () => {
        const fixture = snap();
        expect(bomByCode(fixture, "ZMXK001")?.modelCode).toBe("M-100");
        expect(bomByCode(fixture, "ZMKQ999")).toBeUndefined();
    });

    it("reads stock and clamps missing or negative to zero", () => {
        expect(stockOf(snap({ stock: { ZMXK001: 7 } }), "ZMXK001")).toBe(7);
        expect(stockOf(snap({ stock: {} }), "ZMXK001")).toBe(0);
        expect(stockOf(snap({ stock: { ZMXK001: -3 } }), "ZMXK001")).toBe(0);
    });

    it("computes remaining qty and clamps overshoot", () => {
        expect(remainingOf(order({ qty: 10, outbound: 4 }))).toBe(6);
        expect(remainingOf(order({ qty: 5, outbound: 9 }))).toBe(0);
    });
});

describe("orderStatusOf", () => {
    it("returns done when outbound covers qty", () => {
        expect(orderStatusOf(snap(), order({ outbound: 10 }))).toEqual({ label: "已完成", key: "done" });
        expect(orderStatusOf(snap(), order({ outbound: 12 }))).toEqual({ label: "已完成", key: "done" });
    });

    it("returns progress for partial shipment regardless of stock", () => {
        expect(orderStatusOf(snap({ stock: { ZMXK001: 5 } }), order({ outbound: 3 }))).toEqual({
            label: "部分发货",
            key: "progress",
        });
    });

    it("returns ready when stock exists and nothing shipped", () => {
        expect(orderStatusOf(snap({ stock: { ZMXK001: 5 } }), order())).toEqual({ label: "可发货", key: "ready" });
    });

    it("returns pending when no stock and nothing shipped", () => {
        expect(orderStatusOf(snap(), order())).toEqual({ label: "待备货", key: "pending" });
    });
});

describe("readyToShip", () => {
    it("allocates one shared stock pool in deliver-date order without double promise", () => {
        const fixture = snap({
            stock: { ZMXK001: 15 },
            orders: [
                order({ orderNo: "ZM-B", qty: 10, deliverEnd: "2026-03-19" }),
                order({ orderNo: "ZM-A", qty: 10, deliverEnd: "2026-03-18" }),
            ],
        });
        const rows = readyToShip(fixture);
        expect(rows.map(row => row.orderNo)).toEqual(["ZM-A", "ZM-B"]);
        expect(rows[0].maxShip).toBe(10);
        expect(rows[1].maxShip).toBe(5);
        // 行内 stock 展示的是分配前的池子总量
        expect(rows[1].stock).toBe(15);
    });

    it("caps maxShip by remaining qty even with plenty of stock", () => {
        const rows = readyToShip(snap({ stock: { ZMXK001: 100 }, orders: [order({ qty: 6 })] }));
        expect(rows[0].maxShip).toBe(6);
    });

    it("breaks deliver-date ties by order number", () => {
        const rows = readyToShip(
            snap({
                stock: { ZMXK001: 99 },
                orders: [
                    order({ orderNo: "ZM-2", deliverEnd: "2026-03-18" }),
                    order({ orderNo: "ZM-1", deliverEnd: "2026-03-18" }),
                ],
            }),
        );
        expect(rows.map(row => row.orderNo)).toEqual(["ZM-1", "ZM-2"]);
    });

    it("drops fulfilled orders and flags overdue deliver dates", () => {
        const rows = readyToShip(
            snap({
                stock: { ZMXK001: 5 },
                orders: [
                    order({ orderNo: "ZM-DONE", outbound: 10 }),
                    order({ orderNo: "ZM-LATE", deliverEnd: "2026-03-14" }),
                    order(),
                ],
            }),
        );
        expect(rows.map(row => row.orderNo)).toEqual(["ZM-LATE", "ZM260315001"]);
        expect(rows[0].overdue).toBe(true);
        expect(rows[1].overdue).toBe(false);
    });
});

describe("maxShipOf", () => {
    it("returns allocation for the order and zero for unknown order no", () => {
        const fixture = snap({ stock: { ZMXK001: 4 }, orders: [order()] });
        expect(maxShipOf(fixture, "ZM260315001")).toBe(4);
        expect(maxShipOf(fixture, "ZM-UNKNOWN")).toBe(0);
    });
});

describe("stockGapList", () => {
    it("aggregates demand per bom and reports only shortfalls", () => {
        const rows = stockGapList(
            snap({
                stock: { ZMXK001: 5 },
                orders: [
                    order({ orderNo: "ZM-1", qty: 10, deliverEnd: "2026-03-22" }),
                    order({ orderNo: "ZM-2", qty: 10, deliverEnd: "2026-03-18" }),
                    // 已完成订单不占需求
                    order({ orderNo: "ZM-DONE", qty: 99, outbound: 99 }),
                ],
            }),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            bomCode: "ZMXK001",
            gapQty: 15,
            demandQty: 20,
            stockQty: 5,
            orderCount: 2,
            earliestDate: "2026-03-18",
            earliestOrderNo: "ZM-2",
            earliestOverdue: false,
        });
    });

    it("omits boms whose demand fits stock", () => {
        expect(stockGapList(snap({ stock: { ZMXK001: 10 }, orders: [order({ qty: 10 })] }))).toEqual([]);
    });

    it("sorts gap rows by earliest deliver date across boms", () => {
        const rows = stockGapList(
            snap({
                stock: {},
                orders: [
                    order({ orderNo: "ZM-LATE", bomCode: "ZMXK001", deliverEnd: "2026-03-25" }),
                    order({ orderNo: "ZM-EARLY", bomCode: "ZMKQ001", deliverEnd: "2026-03-16" }),
                ],
            }),
        );
        expect(rows.map(row => row.bomCode)).toEqual(["ZMKQ001", "ZMXK001"]);
        expect(rows[0].earliestOverdue).toBe(false);
        expect(rows[1].earliestOverdue).toBe(false);
    });
});

describe("dailyTrend", () => {
    it("builds day buckets ending today and aggregates ledgers into them", () => {
        const rows = dailyTrend(
            snap({
                orders: [
                    order({ orderDate: TODAY, qty: 10 }),
                    order({ orderDate: "2026-03-14", qty: 2 }),
                    order({ orderDate: "2026-03-01", qty: 50 }),
                ],
                inboundLedger: [
                    {
                        no: "RK-1",
                        bomCode: "ZMXK001",
                        qty: 4,
                        date: "2026-03-14",
                        time: "09:00",
                        inspector: "测试",
                        status: "active",
                        version: 1,
                        createdAt: "2026-03-14T09:00:00+08:00",
                    },
                ],
                outboundLedger: [
                    {
                        no: "CK-1",
                        orderNo: "ZM260315001",
                        customer: "华兴精密",
                        customerCode: "CUS-1024",
                        bomCode: "ZMXK001",
                        qty: 3,
                        date: TODAY,
                        time: "10:00",
                        operator: "测试",
                        state: "printed",
                        version: 2,
                        printVersion: 1,
                    },
                ],
            }),
            3,
        );
        expect(rows.map(row => row.date)).toEqual(["2026-03-13", "2026-03-14", "2026-03-15"]);
        expect(rows.map(row => row.label)).toEqual(["3/13", "3/14", "3/15"]);
        expect(rows[1]).toMatchObject({
            orderedQty: 2,
            orderedCount: 1,
            inboundQty: 4,
            inboundCount: 1,
            outboundQty: 0,
        });
        expect(rows[2]).toMatchObject({ orderedQty: 10, orderedCount: 1, outboundQty: 3, outboundCount: 1 });
        // 窗口外的 2026-03-01 订单不计入任何桶
        expect(rows.reduce((sum, row) => sum + row.orderedQty, 0)).toBe(12);
    });

    it("returns zeroed buckets when snapshot is empty", () => {
        const rows = dailyTrend(EMPTY_SNAPSHOT, 7);
        expect(rows).toHaveLength(7);
        expect(rows.every(row => row.orderedQty === 0 && row.inboundQty === 0 && row.outboundQty === 0)).toBe(true);
    });
});

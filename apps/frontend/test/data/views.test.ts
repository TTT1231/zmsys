/* views 派生视图纯函数：固定系统时间后断言订单各状态、共享库存分配 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bom, Order, Snapshot } from "@/api";

import {
    EMPTY_SNAPSHOT,
    bomByCode,
    bomIndexOf,
    deriveOrders,
    maxShipOf,
    orderStatusOf,
    orderStatusOfMax,
    readyToShip,
    remainingOf,
    stockOf,
} from "@/data/views";

const TODAY = "2026-03-15";

const bom = (over: Partial<Bom> = {}): Bom => ({
    code: "ZMXK001",
    name: "旋转XK2",
    modelCode: "M-100",
    remark: "",
    items: [
        { materialId: "3001", groupKey: "model", groupName: "型号", name: "M-100", quantity: 1 },
        { materialId: "3003", groupKey: "silver-wire-thickness", groupName: "银丝厚度", name: "0.2", quantity: 1 },
    ],
    spec: "型号：M-100 · 银丝厚度：0.2",
    creator: "郭均",
    created: "2026-01-01T02:00:00.000Z",
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
    deliverDate: "2026-03-20",
    remark: "",
    lifecycleStatus: "active",
    createdBy: "郭均",
    createdAt: "2026-03-10T02:00:00Z",
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

    it("returns zero remaining for archived orders (欠量关闭，与取消同口径)", () => {
        expect(remainingOf(order({ qty: 10, outbound: 4, lifecycleStatus: "archived" }))).toBe(0);
    });
});

describe("orderStatusOf", () => {
    it("returns done when outbound covers qty", () => {
        expect(orderStatusOf(snap(), order({ outbound: 10 }))).toEqual({ label: "已完成", key: "done" });
        expect(orderStatusOf(snap(), order({ outbound: 12 }))).toEqual({ label: "已完成", key: "done" });
    });

    it("returns partReady when shippable stock cannot cover remaining", () => {
        // 未发货：库存 5 盖不住待交 10
        const unshipped = order();
        expect(orderStatusOf(snap({ stock: { ZMXK001: 5 }, orders: [unshipped] }), unshipped)).toEqual({
            label: "部分可发货",
            key: "partReady",
        });
        // 已发 3、可发 5、待交 7：仍盖不住整单剩余
        const shipped = order({ outbound: 3 });
        expect(orderStatusOf(snap({ stock: { ZMXK001: 5 }, orders: [shipped] }), shipped)).toEqual({
            label: "部分可发货",
            key: "partReady",
        });
    });

    it("returns progress for partial shipment when remaining covered or no stock", () => {
        // 已发 3、库存 7 正好盖住待交 7
        const covered = order({ outbound: 3 });
        expect(orderStatusOf(snap({ stock: { ZMXK001: 7 }, orders: [covered] }), covered)).toEqual({
            label: "部分发货",
            key: "progress",
        });
        // 已发 3、无库存
        const dry = order({ outbound: 3 });
        expect(orderStatusOf(snap({ orders: [dry] }), dry)).toEqual({
            label: "部分发货",
            key: "progress",
        });
    });

    it("returns ready when allocated stock covers remaining", () => {
        const fixture = order();
        expect(orderStatusOf(snap({ stock: { ZMXK001: 10 }, orders: [fixture] }), fixture)).toEqual({
            label: "可发货",
            key: "ready",
        });
    });

    it("returns pending when nothing shipped and no stock to allocate", () => {
        expect(orderStatusOf(snap(), order())).toEqual({ label: "待备货", key: "pending" });
    });

    it("labels archived orders by delivery progress (复用销售订单口径)", () => {
        // 已完成归档
        expect(orderStatusOf(snap(), order({ qty: 10, outbound: 10, lifecycleStatus: "archived" }))).toEqual({
            label: "已完成",
            key: "done",
        });
        // 部分发货归档：归档即结案，无专属形态，直接按交付进度展示
        expect(orderStatusOf(snap(), order({ qty: 10, outbound: 4, lifecycleStatus: "archived" }))).toEqual({
            label: "部分发货",
            key: "progress",
        });
    });

    it("excludes archived orders from ready-to-ship allocation", () => {
        // 库存 5：归档单不再参与分配，可发量留给活跃订单
        const fixture = snap({
            stock: { ZMXK001: 5 },
            orders: [order({ orderNo: "ZM-ARC", qty: 10, outbound: 2, lifecycleStatus: "archived" }), order()],
        });
        expect(maxShipOf(fixture, "ZM-ARC")).toBe(0);
        expect(maxShipOf(fixture, "ZM260315001")).toBe(5);
        expect(readyToShip(fixture).map(row => row.orderNo)).toEqual(["ZM260315001"]);
    });

    it("only sees stock left after earlier deliver dates' reservation", () => {
        // 库存 10 全部被更早交期的 ZM-A 预留：ZM-B 账面有货但可发 0
        const fixture = snap({
            stock: { ZMXK001: 10 },
            orders: [
                order({ orderNo: "ZM-A", qty: 10, deliverDate: "2026-03-18" }),
                order({ orderNo: "ZM-B", qty: 5, deliverDate: "2026-03-19" }),
            ],
        });
        expect(orderStatusOf(fixture, fixture.orders[1])).toEqual({ label: "待备货", key: "pending" });
    });
});

describe("readyToShip", () => {
    it("allocates one shared stock pool in deliver-date order without double promise", () => {
        const fixture = snap({
            stock: { ZMXK001: 15 },
            orders: [
                order({ orderNo: "ZM-B", qty: 10, deliverDate: "2026-03-19" }),
                order({ orderNo: "ZM-A", qty: 10, deliverDate: "2026-03-18" }),
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
                    order({ orderNo: "ZM-2", deliverDate: "2026-03-18" }),
                    order({ orderNo: "ZM-1", deliverDate: "2026-03-18" }),
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
                    order({ orderNo: "ZM-LATE", deliverDate: "2026-03-14" }),
                    order(),
                ],
            }),
        );
        expect(rows.map(row => row.orderNo)).toEqual(["ZM-LATE", "ZM260315001"]);
        expect(rows[0].overdue).toBe(true);
        expect(rows[1].overdue).toBe(false);
    });
});

describe("deriveOrders", () => {
    it("precomputes maxShip/status equal to per-order queries for every order", () => {
        const fixture = snap({
            stock: { ZMXK001: 12 },
            orders: [
                order({ orderNo: "ZM-1", qty: 10 }),
                order({ orderNo: "ZM-2", qty: 10, deliverDate: "2026-03-18" }),
                order({ orderNo: "ZM-DONE", qty: 10, outbound: 10 }),
                order({ orderNo: "ZM-ARC", qty: 10, outbound: 2, lifecycleStatus: "archived" }),
            ],
        });
        const derived = deriveOrders(fixture);
        for (const item of fixture.orders) {
            expect(derived.byOrderNo.get(item.orderNo)?.maxShip ?? 0).toBe(maxShipOf(fixture, item.orderNo));
            expect(derived.byOrderNo.get(item.orderNo)?.status ?? orderStatusOfMax(item, 0)).toEqual(
                orderStatusOf(fixture, item),
            );
        }
    });

    it("keeps first-wins on duplicate order no (与旧 readyToShip().find 定位一致)", () => {
        const fixture = snap({
            stock: { ZMXK001: 8 },
            orders: [
                order({ orderNo: "ZM-DUP", qty: 5, deliverDate: "2026-03-18" }),
                order({ orderNo: "ZM-DUP", qty: 6, deliverDate: "2026-03-19" }),
            ],
        });
        const derived = deriveOrders(fixture);
        expect(derived.rows.map(row => row.remaining)).toEqual([5, 6]);
        expect(derived.byOrderNo.get("ZM-DUP")?.remaining).toBe(5);
        expect(maxShipOf(fixture, "ZM-DUP")).toBe(5);
    });

    it("indexes boms first-wins, matching bomByCode", () => {
        const fixture = snap({ boms: [bom(), bom({ modelCode: "M-200", spec: "重复编码档案" })] });
        const index = bomIndexOf(fixture);
        expect(index.get("ZMXK001")?.modelCode).toBe("M-100");
        expect(index.get("ZMXK001")).toBe(bomByCode(fixture, "ZMXK001"));
    });

    it("accepts a shared bomIndex without changing allocation rows", () => {
        const fixture = snap({ stock: { ZMXK001: 5 }, orders: [order()] });
        expect(readyToShip(fixture, bomIndexOf(fixture))).toEqual(readyToShip(fixture));
    });
});

describe("maxShipOf", () => {
    it("returns allocation for the order and zero for unknown order no", () => {
        const fixture = snap({ stock: { ZMXK001: 4 }, orders: [order()] });
        expect(maxShipOf(fixture, "ZM260315001")).toBe(4);
        expect(maxShipOf(fixture, "ZM-UNKNOWN")).toBe(0);
    });

    it("short-circuits fulfilled orders to zero without allocation", () => {
        const fixture = snap({ stock: { ZMXK001: 4 }, orders: [order({ outbound: 10 })] });
        expect(maxShipOf(fixture, "ZM260315001")).toBe(0);
    });
});

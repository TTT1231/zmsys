/* 覆盖取消订单口径、BOM 库存隔离、交期分配、客户排名和趋势补零。 */
import { describe, expect, it } from "vitest";
import {
    customerRanking,
    summarizeWorkbench,
    workbenchRisks,
    workbenchTrend,
    type WorkbenchData,
    type WorkbenchOrder,
} from "@/data/workbench";

const order = (patch: Partial<WorkbenchOrder> = {}): WorkbenchOrder => ({
    no: "SO1",
    customerCode: "C1",
    customer: "客户一",
    bomCode: "B1",
    date: "2026-09-01",
    due: "2026-09-12",
    qty: 100,
    shipped: 20,
    ...patch,
});
const data = (orders: WorkbenchOrder[]): WorkbenchData => ({
    asOf: "2026-09-12",
    unit: "个",
    orders,
    movements: [],
    products: [
        { code: "B1", category: "旋转XK2", model: "M1", spec: "二脚", unit: "个", stock: 50 },
        { code: "B2", category: "旋转XK2", model: "M2", spec: "三脚", unit: "个", stock: 1000 },
    ],
});
const all = { start: "2026-01-01", end: "2026-09-12" };

describe("工作台统计", () => {
    it("需求含完成订单，取消只保留已履行部分，且需求等于已发加未发", () => {
        const result = summarizeWorkbench(
            data([
                order(),
                order({ no: "done", shipped: 100 }),
                order({ no: "cancelled", cancelled: true, shipped: 30 }),
                order({ no: "empty", cancelled: true, shipped: 0 }),
            ]),
            all,
        );
        expect(result.qty).toBe(230);
        expect(result.shipped).toBe(150);
        expect(result.remaining).toBe(80);
        expect(result.qty).toBe(result.shipped + result.remaining);
        expect(result.completed).toBe(1);
    });
    it("不同规格库存不能抵扣缺口，改变订单周期不改变当前库存与缺口", () => {
        const snapshot = data([order()]);
        const selected = summarizeWorkbench(snapshot, { start: "2026-09-10", end: "2026-09-12" });
        expect(selected.qty).toBe(0);
        expect(selected.categories[0].stock).toBe(1050);
        expect(selected.categories[0].gap).toBe(30);
        expect(summarizeWorkbench(snapshot, all).categories[0].gap).toBe(30);
    });
    it("按交期消耗共享库存，逾期即使不缺货也保留，未来7天外不提醒", () => {
        const snapshot = data([
            order({ no: "later", due: "2026-09-19", qty: 50, shipped: 0 }),
            order({ no: "early", due: "2026-09-11", qty: 40, shipped: 0 }),
            order({ no: "outside", due: "2026-09-20", qty: 100, shipped: 0 }),
            order({ no: "cancelled", cancelled: true, due: "2026-09-10" }),
        ]);
        expect(workbenchRisks(snapshot).map(row => [row.no, row.kind, row.gap])).toEqual([
            ["early", "overdue", 0],
            ["later", "upcoming", 40],
        ]);
    });
    it("今天到期算近期，同交期以订单号决定分配顺序", () => {
        const result = workbenchRisks(
            data([order({ no: "B", qty: 40, shipped: 0 }), order({ no: "A", qty: 40, shipped: 0 })]),
        );
        expect(result.map(row => [row.no, row.kind, row.gap])).toEqual([["B", "upcoming", 30]]);
    });
    it("按客户编码合并，支持两种排名且只返回前20名", () => {
        const orders = Array.from({ length: 24 }, (_, index) =>
            order({ no: `SO${index}`, customerCode: `C${index}`, customer: "同名客户", qty: 100 + index }),
        );
        orders.push(order({ no: "extra", customerCode: "C0", qty: 10, shipped: 0 }));
        expect(customerRanking(orders, "qty")).toHaveLength(20);
        expect(customerRanking(orders, "qty")[0].code).toBe("C23");
        expect(customerRanking(orders, "count")[0]).toMatchObject({ code: "C0", count: 2, qty: 110 });
        expect(customerRanking([order({ cancelled: true, shipped: 0 })], "count")).toEqual([]);
    });
    it("趋势按业务日期及品类过滤，补齐无流水日期，并可按月汇总", () => {
        const snapshot = data([]);
        snapshot.products[1].category = "琴键开关";
        snapshot.movements = [
            { date: "2026-09-10", bomCode: "B1", inbound: 100, outbound: 0 },
            { date: "2026-09-12", bomCode: "B1", inbound: 0, outbound: 80 },
            { date: "2026-09-12", bomCode: "B2", inbound: 300, outbound: 100 },
        ];
        const range = { start: "2026-09-10", end: "2026-09-12" };
        expect(workbenchTrend(snapshot, range, "旋转XK2")).toEqual([
            { date: "2026-09-10", inbound: 100, outbound: 0 },
            { date: "2026-09-11", inbound: 0, outbound: 0 },
            { date: "2026-09-12", inbound: 0, outbound: 80 },
        ]);
        expect(workbenchTrend(snapshot, range, "", true)).toEqual([{ date: "2026-09", inbound: 400, outbound: 180 }]);
    });
});

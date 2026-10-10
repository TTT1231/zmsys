/* 覆盖归档订单口径、BOM 库存隔离、桶模型可发口径、客户排名和趋势补零。 */
import { describe, expect, it } from "vitest";
import {
    archivedCategoryStats,
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
    it("需求含完成订单，归档订单全额计入需求且不再安排交付", () => {
        const result = summarizeWorkbench(
            data([
                order(),
                order({ no: "done", shipped: 100 }),
                order({ no: "archived", archived: true, shipped: 30 }),
                order({ no: "archived-empty", archived: true, shipped: 0 }),
            ]),
            all,
        );
        expect(result.qty).toBe(400);
        expect(result.shipped).toBe(150);
        expect(result.remaining).toBe(80);
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
    it("各单独立对照共享库存（桶模型），逾期即使不缺货也保留，未来7天外不提醒", () => {
        const snapshot = data([
            order({ no: "later", due: "2026-09-19", qty: 60, shipped: 0 }),
            order({ no: "early", due: "2026-09-11", qty: 40, shipped: 0 }),
            order({ no: "outside", due: "2026-09-20", qty: 100, shipped: 0 }),
            order({ no: "archived", archived: true, due: "2026-09-10" }),
        ]);
        // B1 库存 50：early 可发 40 无缺口；later 独立对照同一份 50，缺口 10；
        // outside 缺口 50 但在 7 天提醒窗之外，不提醒
        expect(workbenchRisks(snapshot).map(row => [row.no, row.kind, row.gap])).toEqual([
            ["early", "overdue", 0],
            ["later", "upcoming", 10],
        ]);
    });
    it("今天到期算近期，桶模型下各单独立对照同一库存", () => {
        const result = workbenchRisks(
            data([order({ no: "B", qty: 60, shipped: 0 }), order({ no: "A", qty: 60, shipped: 0 })]),
        );
        expect(result.map(row => [row.no, row.kind, row.gap])).toEqual([
            ["A", "upcoming", 10],
            ["B", "upcoming", 10],
        ]);
    });
    it("按客户编码合并，支持两种排名且只返回前20名", () => {
        const orders = Array.from({ length: 24 }, (_, index) =>
            order({ no: `SO${index}`, customerCode: `C${index}`, customer: "同名客户", qty: 100 + index }),
        );
        orders.push(order({ no: "extra", customerCode: "C0", qty: 10, shipped: 0 }));
        expect(customerRanking(orders, "qty")).toHaveLength(20);
        expect(customerRanking(orders, "qty")[0].code).toBe("C23");
        expect(customerRanking(orders, "count")[0]).toMatchObject({ code: "C0", count: 2, qty: 110 });
        // 归档单是真实历史需求：仍进排行（口径与取消时代相反）
        expect(customerRanking([order({ archived: true, shipped: 0 })], "count")).toHaveLength(1);
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
    it("归档品类统计：需求/出库按归档订单合并品类，只认归档口径；range 按下单日期过滤", () => {
        const snapshot = data([
            order({ no: "arch-1", qty: 100, shipped: 60, archived: true }),
            order({ no: "arch-2", qty: 50, shipped: 50, archived: true, bomCode: "B2" }),
            order({
                no: "arch-old",
                qty: 30,
                shipped: 30,
                archived: true,
                date: "2025-12-31",
            }),
            order({ no: "live", qty: 70, shipped: 10 }),
        ]);
        snapshot.products.push({ code: "B3", category: "琴键开关", model: "M3", spec: "四脚", unit: "个", stock: 0 });
        expect(archivedCategoryStats(snapshot)).toEqual([{ name: "旋转XK2", orders: 3, qty: 180, shipped: 140 }]);
        expect(archivedCategoryStats(snapshot, { start: "2026-01-01", end: "2026-09-12" })).toEqual([
            { name: "旋转XK2", orders: 2, qty: 150, shipped: 110 },
        ]);
    });
});

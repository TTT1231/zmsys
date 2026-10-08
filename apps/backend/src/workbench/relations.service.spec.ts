import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { RelationsService } from "./relations.service";
import { RelationsQueryDto } from "./relations-query.dto";
import { WorkbenchController } from "./workbench.controller";
import { PERMISSIONS_KEY, PERMISSIONS } from "../constants";
import type { PrismaService } from "../prisma/prisma.service";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const creator = { id: 1n, name: "张敏", roleCode: "admin" };
const owner = { id: 2n, name: "张敏", roleCode: "sales" };
const operator = { id: 3n, name: "仓管", roleCode: "warehouse" };
const boms = [
    { id: 10n, bomCode: "KW001", unit: "个", creator },
    { id: 20n, bomCode: "KW002", unit: "箱", creator },
];
const customer = { id: 30n, customerCode: "CUS-0001", name: "客户", owner };
const order = (id: bigint, bom = boms[0], archived = false, qty = 100) => ({
    id,
    orderNo: `SO${id}`,
    qty,
    lifecycleStatus: archived ? "ARCHIVED" : "ACTIVE",
    orderDate: date("2026-09-10"),
    deliverDate: date("2026-09-20"),
    bomId: bom.id,
    customerId: customer.id,
    creator: owner,
    archiver: archived ? creator : null,
    customer,
    bom,
});
const inbound = {
    id: 40n,
    entryNo: "IN001",
    bomId: 10n,
    qty: 200,
    status: "ACTIVE",
    businessDate: date("2026-10-01"),
    operator,
};
const outbound = {
    id: 50n,
    shipmentNo: "OUT001",
    orderId: 101n,
    originalQty: 20,
    state: "REGISTERED",
    businessDate: date("2026-10-02"),
    registrar: operator,
};

describe("分析页业务关系聚合", () => {
    const db = {
        salesOrderTable: { findMany: vi.fn() },
        bomTable: { findMany: vi.fn() },
        inboundLedger: { findMany: vi.fn() },
        outboundShipment: { findMany: vi.fn() },
        $queryRaw: vi.fn(),
        $transaction: vi.fn(),
    };
    let service: RelationsService;
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-08T08:00:00.000Z"));
        vi.resetAllMocks();
        db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
        db.salesOrderTable.findMany.mockResolvedValue([
            order(101n),
            order(102n),
            order(103n, boms[1], true),
            order(104n, boms[1], true),
        ]);
        db.bomTable.findMany.mockResolvedValue([]);
        db.inboundLedger.findMany.mockResolvedValue([
            inbound,
            { ...inbound, id: 41n, entryNo: "IN-VOID", status: "VOIDED" },
        ]);
        db.outboundShipment.findMany.mockResolvedValue([
            outbound,
            { ...outbound, id: 51n, shipmentNo: "OUT-VOID", state: "VOIDED", originalQty: 5 },
        ]);
        db.$queryRaw.mockImplementation((sql: TemplateStringsArray) =>
            Promise.resolve(
                sql.join("").includes("v_order_outbound_qty")
                    ? [
                          { order_id: 101n, outbound_qty: 20n },
                          { order_id: 102n, outbound_qty: 100n },
                          { order_id: 103n, outbound_qty: 30n },
                          { order_id: 104n, outbound_qty: 100n },
                      ]
                    : [{ bom_code: "KW001", stock_qty: 180n }],
            ),
        );
        service = new RelationsService(db as unknown as PrismaService);
    });
    afterEach(() => vi.useRealTimers());

    it("默认仅未完成未归档；同名人员按真实 ID 区分，入库不伪造订单关系", async () => {
        const data = await service.getRelations(new RelationsQueryDto());
        expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
            isolationLevel: "RepeatableRead",
            timeout: 15_000,
        });
        expect(data.counts).toEqual({ open: 1, completed: 2, archived: 2, all: 4 });
        expect(data.nodes.filter(n => n.type === "order").map(n => n.id)).toEqual(["order:101"]);
        expect(
            data.nodes
                .filter(n => n.name === "张敏")
                .map(n => n.id)
                .sort(),
        ).toEqual(["person:1", "person:2"]);
        expect(data.edges.filter(e => e.kind === "business")).toContainEqual({
            source: "inbound:40",
            target: "bom:10",
            relation: "入库",
            kind: "business",
        });
        expect(data.edges.some(e => e.source.startsWith("inbound:") && e.target.startsWith("order:"))).toBe(false);
        expect(data.nodes.find(n => n.id === "bom:10")?.facts).toMatchObject({ stock: 180, unit: "个" });
        expect(data.nodes.find(n => n.id === "order:101")?.facts).toMatchObject({
            qty: 100,
            shipped: 20,
            pendingQty: 80,
        });
        expect(data.summary.overdueOrderIds).toContain("order:101");
        expect(() => JSON.stringify(data)).not.toThrow();
    });

    it("已完成按全生命周期有效出库净额判断，类型组合由后端筛选", async () => {
        db.outboundShipment.findMany.mockResolvedValue([]);
        const data = await service.getRelations({ status: "completed", types: ["bom", "customer", "order"] });
        expect(data.nodes.filter(n => n.type === "order").map(n => n.id)).toEqual(["order:102", "order:104"]);
        expect(data.nodes.every(n => ["bom", "customer", "order"].includes(n.type))).toBe(true);
        const ids = new Set(data.nodes.map(n => n.id));
        expect(data.edges.every(e => ids.has(e.source) && ids.has(e.target))).toBe(true);
        expect(data.typeCounts.person).toBeGreaterThan(0);
        expect(data.summary.quantitiesByUnit).toEqual([
            { unit: "个", ordered: 100, shipped: 100, pending: 0 },
            { unit: "箱", ordered: 100, shipped: 100, pending: 0 },
        ]);
    });

    it("归档不等于交满：欠量单保留 unshippedQty，退出 pending 和逾期汇总", async () => {
        db.inboundLedger.findMany.mockResolvedValue([]);
        db.outboundShipment.findMany.mockResolvedValue([]);
        const data = await service.getRelations({ status: "archived" });
        expect(data.nodes.find(n => n.id === "order:103")?.facts).toMatchObject({
            archived: true,
            shipped: 30,
            unshippedQty: 70,
            pendingQty: 0,
        });
        expect(data.summary.overdueOrderIds).toEqual([]);
        expect(data.edges).toContainEqual({
            source: "person:1",
            target: "order:103",
            relation: "归档",
            kind: "person",
        });
    });

    it("日期约束覆盖单据业务日，同时纳入期间出库引用的旧订单", async () => {
        db.salesOrderTable.findMany.mockResolvedValue([order(101n)]);
        const data = await service.getRelations({
            status: "open",
            start: "2026-10-01",
            end: "2026-10-08",
            orderNo: "SO101",
            bomCode: "KW001",
            customerCode: "CUS-0001",
        });
        const dates = { gte: date("2026-10-01"), lte: date("2026-10-08") };
        expect(db.salesOrderTable.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    deletedAt: null,
                    orderNo: "SO101",
                    bom: { bomCode: "KW001" },
                    customer: { customerCode: "CUS-0001" },
                    OR: [{ orderDate: dates }, { shipments: { some: { deletedAt: null, businessDate: dates } } }],
                },
            }),
        );
        expect(db.inboundLedger.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { deletedAt: null, bomId: { in: [10n] }, businessDate: dates } }),
        );
        expect(db.outboundShipment.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { deletedAt: null, orderId: { in: [101n] }, businessDate: dates } }),
        );
        expect(data.nodes.find(n => n.id === "order:101")?.facts).toMatchObject({ date: "2026-09-10" });
        expect(data.nodes.find(n => n.id === "outbound:51")).toMatchObject({
            voided: true,
            facts: { qty: 5, voided: true, orderId: "order:101" },
        });
    });

    it("全部支持没有订单的入库 BOM；精确订单查询不引入无关 BOM", async () => {
        db.salesOrderTable.findMany.mockResolvedValue([]);
        db.bomTable.findMany.mockResolvedValue([boms[0]]);
        db.outboundShipment.findMany.mockResolvedValue([]);
        const data = await service.getRelations({ status: "all", bomCode: "KW001", start: "2026-10-01" });
        expect(data.nodes.some(n => n.type === "inbound")).toBe(true);
        expect(data.nodes.some(n => n.type === "order")).toBe(false);
        expect(data.summary.orderCount).toBe(0);
        db.bomTable.findMany.mockClear();
        await service.getRelations({ status: "all", orderNo: "MISSING" });
        expect(db.bomTable.findMany).not.toHaveBeenCalled();
    });

    it("空类型返回空图，仍保留统计；逆序日期拒绝且不查库", async () => {
        const data = await service.getRelations({ status: "open", types: [] });
        expect(data.nodes).toEqual([]);
        expect(data.edges).toEqual([]);
        expect(data.counts.open).toBe(1);
        db.salesOrderTable.findMany.mockClear();
        await expect(service.getRelations({ status: "all", start: "2026-10-08", end: "2026-10-01" })).rejects.toThrow(
            "开始日期不能晚于结束日期",
        );
        expect(db.salesOrderTable.findMany).not.toHaveBeenCalled();
    });

    it("DTO 校验状态、类型和真实日期，支持 CSV 类型组合和空组合", async () => {
        const dto = plainToInstance(RelationsQueryDto, {
            status: "completed",
            types: "bom,customer,order",
            start: "2026-10-01",
        });
        expect(await validate(dto)).toEqual([]);
        expect(dto.types).toEqual(["bom", "customer", "order"]);
        expect(plainToInstance(RelationsQueryDto, { types: "" }).types).toEqual([]);
        for (const input of [
            { status: "unknown" },
            { types: "bom,unknown" },
            { start: "2026-02-30" },
            { end: "2026-10-01T00:00:00Z" },
        ]) {
            expect((await validate(plainToInstance(RelationsQueryDto, input))).length).toBeGreaterThan(0);
        }
    });

    it("关系接口同时要求分析页与工作台权限", () => {
        const metadata = Reflect.getMetadata(PERMISSIONS_KEY, WorkbenchController.prototype.getRelations);
        expect(metadata.codes).toEqual([PERMISSIONS.MENU_ANALYTICS, PERMISSIONS.MENU_WORKBENCH]);
    });
});

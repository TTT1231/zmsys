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

    it("候选订单过量时提前拒绝，不返回被截断的状态计数", async () => {
        db.salesOrderTable.findMany.mockResolvedValue(Array.from({ length: 1_001 }, (_, i) => order(BigInt(i + 101))));
        await expect(service.getRelations({ status: "completed", types: [] })).rejects.toThrow("候选订单超过 1,000 条");
        expect(db.salesOrderTable.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1_001 }));
        expect(db.$queryRaw).not.toHaveBeenCalled();
        expect(db.inboundLedger.findMany).not.toHaveBeenCalled();
    });

    it("仅有入库的历史 BOM 过量时拒绝，避免继续读库存与流水", async () => {
        db.salesOrderTable.findMany.mockResolvedValue([]);
        db.bomTable.findMany.mockResolvedValue(
            Array.from({ length: 1_001 }, (_, i) => ({ ...boms[0], id: BigInt(i + 10), bomCode: `BOM${i}` })),
        );
        await expect(service.getRelations({ status: "all" })).rejects.toThrow("BOM超过 1,000 条");
        expect(db.bomTable.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1_001 }));
        expect(db.$queryRaw).not.toHaveBeenCalled();
        expect(db.inboundLedger.findMany).not.toHaveBeenCalled();
    });

    it.each(["inbound", "outbound"] as const)("%s 历史流水过量时拒绝，要求缩小范围", async type => {
        if (type === "inbound")
            db.inboundLedger.findMany.mockResolvedValue(
                Array.from({ length: 1_001 }, (_, i) => ({ ...inbound, id: BigInt(i + 40), entryNo: `IN${i}` })),
            );
        else
            db.outboundShipment.findMany.mockResolvedValue(
                Array.from({ length: 1_001 }, (_, i) => ({ ...outbound, id: BigInt(i + 50), shipmentNo: `OUT${i}` })),
            );
        await expect(service.getRelations({ status: "open" })).rejects.toThrow(
            `${type === "inbound" ? "入库单" : "出库单"}超过 1,000 条`,
        );
        expect(db.inboundLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1_001 }));
        expect(db.outboundShipment.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1_001 }));
    });

    it("订单 BOM 与仅有入库的 BOM 合并后也遵守上限", async () => {
        db.bomTable.findMany.mockResolvedValue(
            Array.from({ length: 1_000 }, (_, i) => ({ ...boms[0], id: BigInt(i + 100), bomCode: `BOM${i}` })),
        );
        await expect(service.getRelations({ status: "all" })).rejects.toThrow("BOM超过 1,000 条");
        // 只读取过候选订单的净额，尚未读取超量 BOM 的库存/流水。
        expect(db.$queryRaw).toHaveBeenCalledTimes(1);
        expect(db.inboundLedger.findMany).not.toHaveBeenCalled();
    });

    it("单类查询未过量但整图过量时拒绝，不输出缺少关联的半张图", async () => {
        db.inboundLedger.findMany.mockResolvedValue(
            Array.from({ length: 800 }, (_, i) => ({ ...inbound, id: BigInt(i + 40), entryNo: `IN${i}` })),
        );
        db.outboundShipment.findMany.mockResolvedValue(
            Array.from({ length: 800 }, (_, i) => ({ ...outbound, id: BigInt(i + 50), shipmentNo: `OUT${i}` })),
        );
        await expect(service.getRelations({ status: "open" })).rejects.toThrow("关联节点超过 1,500 个");
    });

    it("恰好 1,500 个唯一节点仍返回完整图，再多一个则拒绝", async () => {
        db.inboundLedger.findMany.mockResolvedValue(
            Array.from({ length: 997 }, (_, i) => ({ ...inbound, id: BigInt(i + 40), entryNo: `IN${i}` })),
        );
        const shipments = Array.from({ length: 497 }, (_, i) => ({
            ...outbound,
            id: BigInt(i + 50),
            shipmentNo: `OUT${i}`,
        }));
        db.outboundShipment.findMany.mockResolvedValue(shipments);
        const data = await service.getRelations({ status: "open" });
        expect(data.nodes).toHaveLength(1_500);
        expect(data.typeCounts.person).toBe(3);
        db.outboundShipment.findMany.mockResolvedValue([
            ...shipments,
            { ...outbound, id: 10_000n, shipmentNo: "OUT-MORE" },
        ]);
        await expect(service.getRelations({ status: "open" })).rejects.toThrow("关联节点超过 1,500 个");
    });

    it("较多流水的完整图按实体 ID 去重，所有边和 facts 引用均有上下文", async () => {
        db.inboundLedger.findMany.mockResolvedValue(
            Array.from({ length: 1_000 }, (_, i) => ({ ...inbound, id: BigInt(i + 40), entryNo: `IN${i}` })),
        );
        db.outboundShipment.findMany.mockResolvedValue([]);
        const data = await service.getRelations({ status: "open" });
        const ids = new Set(data.nodes.map(n => n.id));
        expect(data.typeCounts.inbound).toBe(1_000);
        expect(ids.size).toBe(data.nodes.length);
        expect(data.typeCounts.person).toBe(3);
        expect(data.edges.every(e => ids.has(e.source) && ids.has(e.target))).toBe(true);
        for (const n of data.nodes) {
            for (const [property, value] of Object.entries(n.facts))
                if (property.endsWith("Id") && typeof value === "string") expect(ids.has(value)).toBe(true);
        }
        expect(data.summary.orderCount).toBe(1);
        expect(data.counts).toEqual({ open: 1, completed: 2, archived: 2, all: 4 });
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

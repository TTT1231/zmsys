import { ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OutboundService } from "./outbound.service";
import { PrismaService } from "../prisma/prisma.service";
import { SnowflakeGenerator } from "../common/snowflake";
import { mkIdempotencyMock, type BeginFn } from "../idempotency/idempotency.mock";
import { BusinessSequenceService } from "../sequence/business-sequence.service";
import type { OutboundLedger, OutboundShipment, SalesOrderTable } from "../generated/prisma/client";

const actor = {
    id: "1",
    account: "guojun",
    name: "郭均",
    role: "super",
    isSuper: true,
    rowVersion: 1,
    permissions: new Set<string>(),
} as const;

const ID_KEY = "idem-key-01";

/** 订单冻结快照（建档形态）：打印 bomSpec 直接取其中的 spec 字符串 */
const BOM_SNAPSHOT = {
    items: [
        { materialId: "3101", groupKey: "base", groupName: "底座", name: "二脚底座（无挡脚）", position: 1 },
        { materialId: "3112", groupKey: "bracket", groupName: "支架", name: "6.3支架：铜镀银", position: 2 },
    ],
    modelCode: "",
    spec: "底座：二脚底座（无挡脚） · 支架：6.3支架：铜镀银",
};

type OrderRow = SalesOrderTable & {
    customer: { customerCode: string };
    bom: { bomCode: string };
};

const mkOrder = (overrides: Partial<OrderRow> = {}): OrderRow =>
    ({
        id: 500n,
        orderNo: "ZM260913001",
        customerId: 900n,
        bomId: 10n,
        qty: 600,
        orderDate: new Date("2026-09-13T00:00:00Z"),
        deliverDate: new Date("2026-10-31T00:00:00Z"),
        remark: "",
        customerNameSnapshot: "深圳市智造电子",
        bomNameSnapshot: "新微动",
        bomModelSnapshot: "",
        bomSpecSnapshot: BOM_SNAPSHOT,
        lifecycleStatus: "ACTIVE",
        deletedAt: null,
        rowVersion: 1n,
        requestKey: "req-order",
        createdBy: 1n,
        updatedBy: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        customer: { customerCode: "CUS-0900" },
        bom: { bomCode: "ZMKW0001" },
        ...overrides,
    }) as OrderRow;

type ShipmentRow = OutboundShipment & {
    order: OrderRow;
    registrar: { name: string };
    ledgers: Array<{ entryType: string; remark: string }>;
};

const mkShipment = (overrides: Partial<ShipmentRow> = {}): ShipmentRow =>
    ({
        id: 600n,
        shipmentNo: "CK26091301",
        orderId: 500n,
        originalQty: 200,
        businessDate: new Date("2026-09-13T00:00:00Z"),
        state: "REGISTERED",
        voidedBy: null,
        voidReason: null,
        voidedAt: null,
        deletedAt: null,
        rowVersion: 1n,
        requestKey: "req-ship",
        registeredBy: 1n,
        registeredAt: new Date(),
        updatedAt: new Date(),
        order: mkOrder(),
        registrar: { name: "郭均" },
        ledgers: [{ entryType: "NORMAL", remark: "首次发货" }],
        ...overrides,
    }) as ShipmentRow;

interface Store {
    orders: OrderRow[];
    shipments: ShipmentRow[];
    ledgers: Array<OutboundLedger>;
    /** 视图口径：bom_id → 库存、order_id → 有效出库净额 */
    stock: Map<bigint, number>;
    outboundNet: Map<bigint, number>;
    stateLogs: unknown[];
    opLogs: unknown[];
}

const emptyStore = (): Store => ({
    orders: [mkOrder()],
    shipments: [],
    ledgers: [],
    stock: new Map(),
    outboundNet: new Map(),
    stateLogs: [],
    opLogs: [],
});

const mkService = (store: Store, beginOrReplay?: ReturnType<typeof vi.fn>) => {
    const tx = {
        // 锁查询返回空行集；v_bom_stock / v_order_outbound_qty / 活动订单列表按 store 应答
        $queryRaw: vi.fn(async (sql: unknown, ...rest: unknown[]) => {
            const isTemplate = Array.isArray(sql);
            const strings = isTemplate
                ? (sql as readonly string[])
                : ((sql as { strings?: readonly string[] }).strings ?? []);
            const boundValues = isTemplate ? rest : ((sql as { values?: unknown[] }).values ?? []);
            const text = strings.join("");
            if (text.includes("v_bom_stock")) {
                const bomId = boundValues[0] as bigint;
                const qty = store.stock.get(bomId);
                return qty === undefined ? [] : [{ stock_qty: BigInt(qty) }];
            }
            if (text.includes("deliver_date")) {
                // computeShippableQty 的活动订单聚合（§6.2 分配算法的输入）
                return store.orders
                    .filter(order => order.lifecycleStatus === "ACTIVE")
                    .map(order => ({
                        id: order.id,
                        qty: order.qty,
                        outbound_qty: BigInt(store.outboundNet.get(order.id) ?? 0),
                    }));
            }
            if (text.includes("v_order_outbound_qty")) {
                const orderId = boundValues[0] as bigint;
                const qty = store.outboundNet.get(orderId);
                return qty === undefined ? [] : [{ outbound_qty: BigInt(qty) }];
            }
            return [];
        }),
        salesOrderTable: {
            findUnique: vi.fn(
                async ({ where }: { where: { orderNo?: string; id?: bigint } }) =>
                    store.orders.find(o => (where.orderNo ? o.orderNo === where.orderNo : o.id === where.id)) ?? null,
            ),
        },
        outboundShipment: {
            // 全局软删注入(prisma-extensions.ts)在 mock 层的等价物:已删行视为不存在
            findUnique: vi.fn(
                async ({ where }: { where: { shipmentNo?: string; id?: bigint } }) =>
                    store.shipments.find(
                        s =>
                            (where.shipmentNo ? s.shipmentNo === where.shipmentNo : s.id === where.id) &&
                            s.deletedAt === null,
                    ) ?? null,
            ),
            findMany: vi.fn(async () => store.shipments.filter(s => s.deletedAt === null)),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                const created = mkShipment({
                    id: data.id as bigint,
                    orderId: data.orderId as bigint,
                    shipmentNo: data.shipmentNo as string,
                    originalQty: data.originalQty as number,
                });
                store.shipments.push(created);
                return created;
            }),
            update: vi.fn(async ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
                const index = store.shipments.findIndex(s => s.id === where.id);
                if (index < 0) {
                    throw new Error("update: 出库单不存在");
                }
                const applied = { ...store.shipments[index], ...data } as ShipmentRow;
                const patch = data.rowVersion as { increment: number } | undefined;
                if (patch) {
                    applied.rowVersion = store.shipments[index].rowVersion + BigInt(patch.increment);
                }
                store.shipments[index] = applied;
                return applied;
            }),
        },
        outboundLedger: {
            findFirst: vi.fn(
                async ({ where }: { where: { shipmentId: bigint; entryType: string } }) =>
                    store.ledgers.find(l => l.shipmentId === where.shipmentId && l.entryType === where.entryType) ??
                    null,
            ),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                const created = {
                    id: 800n,
                    eventNo: data.eventNo as string,
                    shipmentId: data.shipmentId as bigint,
                    entryType: data.entryType as "NORMAL" | "CORRECTION",
                    correctionOfId: (data.correctionOfId ?? null) as bigint | null,
                    qtyDelta: data.qtyDelta as number,
                    businessDate: data.businessDate as Date,
                    operatorId: 1n,
                    remark: (data.remark ?? "") as string,
                    correctionReason: (data.correctionReason ?? null) as string | null,
                    requestKey: "req-event",
                    createdAt: new Date(),
                };
                store.ledgers.push(created);
                return created;
            }),
        },
        outboundStateLog: {
            create: vi.fn(async ({ data }: { data: unknown }) => {
                store.stateLogs.push(data);
                return data;
            }),
        },
        opLog: {
            create: vi.fn(async ({ data }: { data: unknown }) => {
                store.opLogs.push(data);
                return data;
            }),
        },
    };
    const prisma = {
        $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
        $queryRaw: tx.$queryRaw,
        outboundShipment: { findMany: tx.outboundShipment.findMany, findUnique: tx.outboundShipment.findUnique },
    } as unknown as PrismaService;
    const snowflake = { next: vi.fn(() => 9000000000000000n) } as unknown as SnowflakeGenerator;
    const idempotency = mkIdempotencyMock(prisma.$transaction as never, beginOrReplay as BeginFn | undefined);
    const sequence = {
        nextCode: vi.fn(async (_tx: unknown, type: string, businessDate: string) =>
            type === "outbound" ? `CK${businessDate.slice(2).replaceAll("-", "")}01` : "ZM000000001",
        ),
    } as unknown as BusinessSequenceService;
    return {
        service: new OutboundService(prisma, snowflake, idempotency, sequence),
        idempotency,
        store,
    };
};

const shipInput = { orderNo: "ZM260913001", qty: 200, date: "2026-09-13", remark: "首次发货" };

describe("OutboundService.createOutbound", () => {
    let store: Store;
    let service: OutboundService;

    beforeEach(() => {
        store = emptyStore();
        ({ service } = mkService(store));
    });

    it("订单不存在 404；可发量不足 409", async () => {
        await expect(service.createOutbound({ ...shipInput, orderNo: "ZM999999999" }, actor, ID_KEY)).rejects.toThrow(
            new NotFoundException("订单不存在"),
        );

        // 归档是终态：不再接收任何发货（显式拦截给出准确文案，不经可发量兜底）
        store.orders[0] = mkOrder({ lifecycleStatus: "ARCHIVED" });
        await expect(service.createOutbound(shipInput, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("订单已归档，不能登记发货"),
        );

        store.orders[0] = mkOrder();
        store.stock.set(10n, 100); // 库存 100 < 请求 200
        await expect(service.createOutbound(shipInput, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("库存可发量不足，请刷新后重试"),
        );
    });

    it("成功登记：单头/正向事件/状态日志/op_log 同事务，映射契约形态", async () => {
        store.stock.set(10n, 300);
        const created = await service.createOutbound(shipInput, actor, ID_KEY);
        expect(created).toMatchObject({
            no: "CK26091301",
            orderNo: "ZM260913001",
            customer: "深圳市智造电子",
            customerCode: "CUS-0900",
            bomCode: "ZMKW0001",
            qty: 200,
            state: "registered",
            version: 1,
            operator: "郭均",
            date: "2026-09-13",
        });
        expect(created).not.toHaveProperty("printVersion");
        expect(store.ledgers).toHaveLength(1);
        expect(store.ledgers[0]).toMatchObject({ entryType: "NORMAL", qtyDelta: 200 });
        expect(store.stateLogs).toHaveLength(1);
        expect(store.stateLogs[0]).toMatchObject({ eventType: "REGISTER", afterVersion: 1n });
        expect(store.opLogs).toHaveLength(1);
        expect(store.opLogs[0]).toMatchObject({ action: "ship", targetCode: "CK26091301" });
        expect((store.opLogs[0] as { detailJson: { remark: string } }).detailJson.remark).toBe("首次发货");
    });
});

describe("OutboundService.voidOutbound", () => {
    it("已作废再作废 409；作废追加等额冲销并引用原事件", async () => {
        const store = emptyStore();
        store.shipments.push(mkShipment({ state: "VOIDED", rowVersion: 2n }));
        const { service } = mkService(store);
        await expect(
            service.voidOutbound("CK26091301", { expectedVersion: 2, reason: "重复操作" }, actor, ID_KEY),
        ).rejects.toThrow(new ConflictException("出库单已作废，不能重复作废"));

        store.shipments[0] = mkShipment();
        store.ledgers.push({
            id: 810n,
            eventNo: "CK26091301-E1",
            shipmentId: 600n,
            entryType: "NORMAL",
            correctionOfId: null,
            qtyDelta: 200,
            businessDate: new Date(),
            operatorId: 1n,
            remark: "",
            correctionReason: null,
            requestKey: "req-e1",
            createdAt: new Date(),
        });
        const voided = await service.voidOutbound(
            "CK26091301",
            { expectedVersion: 1, reason: "数量有误" },
            actor,
            ID_KEY,
        );
        expect(voided).toMatchObject({ state: "voided", version: 2, voidReason: "数量有误" });
        expect(store.ledgers[1]).toMatchObject({
            entryType: "CORRECTION",
            correctionOfId: 810n,
            qtyDelta: -200,
            correctionReason: "数量有误",
        });
        expect(store.stateLogs.at(-1)).toMatchObject({ eventType: "VOID" });
        // 审计清单：作废动作进 op_log（含快照与原因）
        expect(store.opLogs).toHaveLength(1);
        expect(store.opLogs[0]).toMatchObject({ action: "void_outbound", targetCode: "CK26091301" });
    });

    it("所属订单已归档 409：作废会回退归档单冻结的已发口径，禁止", async () => {
        const store = emptyStore();
        store.orders[0] = mkOrder({ lifecycleStatus: "ARCHIVED" });
        store.shipments.push(mkShipment());
        const { service } = mkService(store);
        await expect(
            service.voidOutbound("CK26091301", { expectedVersion: 1, reason: "试图作废归档单出库" }, actor, ID_KEY),
        ).rejects.toThrow(new ConflictException("所属订单已归档，出库记录为审计依据，不可作废"));
        // 冲销流水与状态日志均未落库
        expect(store.ledgers).toHaveLength(0);
        expect(store.stateLogs).toHaveLength(0);
    });
});

describe("OutboundService.deleteOutbound", () => {
    it("非作废 409；已删除 404（与不存在同口径）；成功打标不动版本，op_log 快照含作废原因，列表不再返回", async () => {
        const store = emptyStore();
        store.shipments.push(mkShipment()); // REGISTERED：必须先作废
        const { service } = mkService(store);
        await expect(service.deleteOutbound("CK26091301", { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("仅已作废的出库单可删除，请先作废"),
        );

        // 已删除行经全局软删过滤后与不存在同口径(404)，不再单列 409
        store.shipments[0] = mkShipment({ state: "VOIDED", deletedAt: new Date() });
        await expect(service.deleteOutbound("CK26091301", { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new NotFoundException("出库单不存在"),
        );

        store.shipments[0] = mkShipment({
            state: "VOIDED",
            voidReason: "数量有误",
            voidedBy: 1n,
            voidedAt: new Date(),
            rowVersion: 2n,
        });
        await expect(service.deleteOutbound("CK26091301", { expectedVersion: 2 }, actor, ID_KEY)).resolves.toBeNull();

        // 删除是可见性管理非业务变更：版本链止于 VOID，不递增 row_version、不写状态日志
        expect(store.shipments[0]!.deletedAt).toBeInstanceOf(Date);
        expect(store.shipments[0]!.rowVersion).toBe(2n);
        expect(store.stateLogs).toHaveLength(0);
        expect(store.opLogs).toHaveLength(1);
        expect(store.opLogs[0]).toMatchObject({ action: "delete_outbound", targetCode: "CK26091301" });
        expect((store.opLogs[0] as { detailJson: object }).detailJson).toMatchObject({
            customerCode: "CUS-0900",
            registeredBy: "郭均",
            remark: "首次发货",
            state: "voided",
            voidReason: "数量有误",
        });
        // 列表过滤已删除单
        expect(await service.listOutbound()).toHaveLength(0);
    });

    it("所属订单已归档 409：含归档前已作废的单，删除后物理清理会断归档审计链", async () => {
        const store = emptyStore();
        store.orders[0] = mkOrder({ lifecycleStatus: "ARCHIVED" });
        store.shipments.push(mkShipment({ state: "VOIDED", voidReason: "归档前作废", rowVersion: 2n }));
        const { service } = mkService(store);
        await expect(service.deleteOutbound("CK26091301", { expectedVersion: 2 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("所属订单已归档，出库记录为审计依据，不可删除"),
        );
        expect(store.shipments[0]!.deletedAt).toBeNull();
        expect(store.opLogs).toHaveLength(0);
    });
});

describe("OutboundService.printOutboundDocument", () => {
    it("纯读输出：文档含订单冻结规格摘要，不改状态不落任何日志，可重复", async () => {
        const store = emptyStore();
        store.shipments.push(mkShipment());
        const { service } = mkService(store);
        const first = await service.printOutboundDocument("CK26091301", actor);
        expect(first).toMatchObject({
            no: "CK26091301",
            orderNo: "ZM260913001",
            customer: "深圳市智造电子",
            bomSpec: "底座：二脚底座（无挡脚） · 支架：6.3支架：铜镀银",
            qty: 200,
            operator: "郭均",
            remark: "首次发货",
            state: "registered",
            printedBy: "郭均",
        });
        expect(first.printedAt).toBeDefined();
        expect(first).not.toHaveProperty("voidReason");

        const second = await service.printOutboundDocument("CK26091301", actor);
        expect(second.no).toBe("CK26091301");
        expect(store.shipments[0]).toMatchObject({ state: "REGISTERED", rowVersion: 1n });
        expect(store.stateLogs).toHaveLength(0);
        expect(store.opLogs).toHaveLength(0);
        expect(store.ledgers).toHaveLength(0);
    });

    it("已作废出库可打印：文档携带作废标注与原因", async () => {
        const store = emptyStore();
        store.shipments.push(mkShipment({ state: "VOIDED", rowVersion: 2n, voidReason: "登记错误" }));
        const { service } = mkService(store);
        const document = await service.printOutboundDocument("CK26091301", actor);
        expect(document).toMatchObject({ state: "voided", voidReason: "登记错误" });
        expect(store.shipments[0]).toMatchObject({ state: "VOIDED", rowVersion: 2n });
    });

    it("订单已归档的出库单仍可打印（打印不校验订单状态）", async () => {
        const store = emptyStore();
        store.shipments.push(mkShipment({ order: mkOrder({ lifecycleStatus: "ARCHIVED" }) }));
        const { service } = mkService(store);
        const document = await service.printOutboundDocument("CK26091301", actor);
        expect(document).toMatchObject({ state: "registered", no: "CK26091301" });
    });

    it("出库单不存在 404", async () => {
        const store = emptyStore();
        const { service } = mkService(store);
        await expect(service.printOutboundDocument("CK99999999", actor)).rejects.toThrow(
            new NotFoundException("出库单不存在"),
        );
    });

    it("已软删除出库单不可再通过单号打印", async () => {
        const store = emptyStore();
        store.shipments.push(mkShipment({ state: "VOIDED", deletedAt: new Date() }));
        const { service } = mkService(store);
        await expect(service.printOutboundDocument("CK26091301", actor)).rejects.toThrow(
            new NotFoundException("出库单不存在"),
        );
    });
});

describe("OutboundService.listOutbound", () => {
    it("两态单头映射；remark 取正向事件；作废原因仅 voided 返回", async () => {
        const store = emptyStore();
        store.shipments.push(
            mkShipment(),
            mkShipment({
                id: 602n,
                shipmentNo: "CK26091303",
                state: "VOIDED",
                rowVersion: 2n,
                voidReason: "登记错误",
            }),
        );
        const { service } = mkService(store);
        const list = await service.listOutbound();
        expect(list).toHaveLength(2);
        expect(list[0]).toMatchObject({ no: "CK26091301", state: "registered", remark: "首次发货" });
        expect(list[0]).not.toHaveProperty("voidReason");
        expect(list[0]).not.toHaveProperty("printVersion");
        expect(list[1]).toMatchObject({ no: "CK26091303", state: "voided", voidReason: "登记错误" });
    });
});

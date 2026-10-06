import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrdersService } from "./orders.service";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import { mkIdempotencyMock, type BeginFn } from "../idempotency/idempotency.mock";
import { BusinessSequenceService } from "../sequence/business-sequence.service";
import type { BomTable, CustomTable, OutboundShipment, SalesOrderTable } from "../generated/prisma/client";

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

type OrderRow = SalesOrderTable & {
    customer: { customerCode: string };
    bom: { bomCode: string };
    creator: { name: string };
    archiver: { name: string } | null;
};

const mkBom = (
    overrides: Partial<BomTable & { category: { name: string } }> = {},
): BomTable & { category: { name: string } } =>
    ({
        id: 10n,
        bomCode: "ZMKW0001",
        categoryId: 1003n,
        specHash: new Uint8Array(32),
        unit: "个",
        status: true,
        rowVersion: 1n,
        requestKey: "req-bom",
        createdBy: 1n,
        updatedBy: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        category: { name: "新微动" },
        ...overrides,
    }) as BomTable & { category: { name: string } };

const mkCustomer = (overrides: Partial<CustomTable> = {}): CustomTable =>
    ({
        id: 900n,
        customerCode: "CUS-0900",
        name: "深圳市智造电子",
        contactPerson: "王经理",
        contactPhone: "13800001111",
        province: "广东省",
        city: "深圳市",
        district: null,
        town: null,
        address: "科技园 1 号",
        ownerId: 200n,
        payTerms: "",
        rowVersion: 1n,
        requestKey: "req-cus",
        createdBy: 1n,
        updatedBy: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    }) as CustomTable;

const mkOrder = (overrides: Partial<OrderRow> = {}): OrderRow =>
    ({
        id: 500n,
        orderNo: "ZM260912001",
        customerId: 900n,
        bomId: 10n,
        qty: 100,
        lifecycleStatus: "ACTIVE",
        orderDate: new Date("2026-09-12T00:00:00Z"),
        deliverDate: new Date("2026-09-30T00:00:00Z"),
        remark: "",
        customerNameSnapshot: "深圳市智造电子",
        bomNameSnapshot: "新微动",
        bomModelSnapshot: "",
        bomSpecSnapshot: {},
        archivedAt: null,
        archivedBy: null,
        archiveReason: null,
        deletedAt: null,
        rowVersion: 1n,
        requestKey: "req-order",
        createdBy: 1n,
        updatedBy: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        customer: { customerCode: "CUS-0900" },
        bom: { bomCode: "ZMKW0001" },
        creator: { name: "郭均" },
        archiver: null,
        ...overrides,
    }) as OrderRow;

interface Store {
    boms: Array<BomTable & { category: { name: string } }>;
    /** BOM 建档冻结明细（订单快照冻结的读取面） */
    bomItems: Array<{
        bomId: bigint;
        materialId: bigint;
        groupKey: string;
        groupName: string;
        name: string;
        position: number;
    }>;
    customers: CustomTable[];
    orders: OrderRow[];
    shipments: OutboundShipment[];
    /** 视图口径的有效出库净额（order_id → qty） */
    outboundNet: Map<bigint, number>;
    changeLogs: unknown[];
    opLogs: unknown[];
}

const createStore = (store: Store) => {
    const withRelations = (order: SalesOrderTable): OrderRow => ({
        ...order,
        customer: store.customers.find(c => c.id === order.customerId)
            ? { customerCode: store.customers.find(c => c.id === order.customerId)!.customerCode }
            : { customerCode: "CUS-0000" },
        bom: { bomCode: store.boms.find(b => b.id === order.bomId)?.bomCode ?? "ZM0000000" },
        creator: { name: "郭均" },
        archiver: null,
    });
    const tx = {
        // 锁查询返回空行集；v_order_outbound_qty 视图查询按 store.outboundNet 应答。
        // tagged template 调用（锁 SQL）参数是 strings 数组；Prisma.sql 函数式调用
        // （视图查询）参数是 { strings, values } 对象，需分别提取文本与绑定值。
        $queryRaw: vi.fn(async (sql: unknown, ...rest: unknown[]) => {
            const isTemplate = Array.isArray(sql);
            const strings = isTemplate
                ? (sql as readonly string[])
                : ((sql as { strings?: readonly string[] }).strings ?? []);
            const boundValues = isTemplate ? rest : ((sql as { values?: unknown[] }).values ?? []);
            const text = strings.join("");
            if (text.includes("v_order_outbound_qty")) {
                if (text.includes("WHERE")) {
                    const orderId = boundValues[0] as bigint;
                    const qty = store.outboundNet.get(orderId);
                    return qty === undefined ? [] : [{ outbound_qty: BigInt(qty) }];
                }
                return [...store.outboundNet].map(([orderId, qty]) => ({
                    order_id: orderId,
                    outbound_qty: BigInt(qty),
                }));
            }
            return [];
        }),
        customTable: {
            findUnique: vi.fn(
                async ({ where }: { where: { customerCode: string } }) =>
                    store.customers.find(c => c.customerCode === where.customerCode) ?? null,
            ),
        },
        bomTable: {
            // 按编码（预检）或按 id（锁后重读，lockOrderForWrite）双查询面
            findUnique: vi.fn(
                async ({ where }: { where: { bomCode?: string; id?: bigint } }) =>
                    store.boms.find(b => (where.bomCode ? b.bomCode === where.bomCode : b.id === where.id)) ?? null,
            ),
        },
        bomItem: {
            findMany: vi.fn(async ({ where }: { where: { bomId: bigint } }) =>
                store.bomItems.filter(item => item.bomId === where.bomId),
            ),
        },
        salesOrderTable: {
            findUnique: vi.fn(
                async ({ where }: { where: { orderNo: string } }) =>
                    store.orders.find(o => o.orderNo === where.orderNo) ?? null,
            ),
            findMany: vi.fn(async () => store.orders.filter(order => order.deletedAt === null)),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                const created = mkOrder(data as Partial<OrderRow>);
                store.orders.push(created);
                return created;
            }),
            update: vi.fn(async ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
                const index = store.orders.findIndex(o => o.id === where.id);
                if (index < 0) {
                    throw new Error("update: 订单不存在");
                }
                const applied = { ...store.orders[index], ...data } as OrderRow;
                const patch = data.rowVersion as { increment: number } | undefined;
                if (patch) {
                    applied.rowVersion = store.orders[index].rowVersion + BigInt(patch.increment);
                }
                store.orders[index] = applied;
                // 真实 Prisma 会按 include 返回最新关联；此处等价重挂（换客户/BOM 后编码随之）
                return withRelations(applied);
            }),
            delete: vi.fn(async ({ where }: { where: { id: bigint } }) => {
                const index = store.orders.findIndex(o => o.id === where.id);
                if (index >= 0) {
                    store.orders.splice(index, 1);
                }
            }),
        },
        outboundShipment: {
            findFirst: vi.fn(
                async ({ where }: { where: { orderId: bigint; state: string } }) =>
                    store.shipments.find(s => s.orderId === where.orderId && s.state === where.state) ?? null,
            ),
            // 全局软删注入(prisma-extensions.ts)在 mock 层的等价物:无条件滤已删行
            count: vi.fn(
                async ({ where }: { where: { orderId: bigint } }) =>
                    store.shipments.filter(s => s.orderId === where.orderId && s.deletedAt === null).length,
            ),
        },
        salesOrderChangeLog: {
            create: vi.fn(async ({ data }: { data: unknown }) => {
                store.changeLogs.push(data);
                return data;
            }),
            deleteMany: vi.fn(async ({ where }: { where: { orderId: bigint } }) => {
                const before = store.changeLogs.length;
                store.changeLogs = store.changeLogs.filter(
                    entry => (entry as { orderId?: bigint }).orderId !== where.orderId,
                );
                return { count: before - store.changeLogs.length };
            }),
        },
        opLog: {
            create: vi.fn(async ({ data }: { data: unknown }) => {
                store.opLogs.push(data);
                return data;
            }),
        },
    };
    return Object.assign(tx, {
        $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
        // 供 listOrders 的视图查询（prisma 直连面）
        __withRelations: withRelations,
    });
};

const mkService = (store: Store, beginOrReplay?: ReturnType<typeof vi.fn>) => {
    const tx = createStore(store);
    const prisma = {
        $transaction: tx.$transaction,
        $queryRaw: tx.$queryRaw,
        salesOrderTable: { findMany: tx.salesOrderTable.findMany },
    } as unknown as PrismaService;
    const snowflake = { next: vi.fn(() => 9000000000000000n) } as unknown as SnowflakeGenerator;
    const idempotency = mkIdempotencyMock(tx.$transaction as never, beginOrReplay as BeginFn | undefined);
    const sequence = {
        nextCode: vi.fn(async (_tx: unknown, type: string, businessDate: string) =>
            type === "order" ? `ZM${businessDate.slice(2).replaceAll("-", "")}001` : "CUS-0042",
        ),
    } as unknown as BusinessSequenceService;
    return {
        service: new OrdersService(prisma, snowflake, new TransactionRunner(prisma), idempotency, sequence),
        tx,
        idempotency,
        store,
    };
};

const createInput = {
    customerCode: "CUS-0900",
    bomCode: "ZMKW0001",
    qty: 500,
    deliverDate: "2026-09-30",
    orderDate: "2026-09-12",
    remark: "首次合作",
};

const emptyStore = (): Store => ({
    boms: [mkBom()],
    bomItems: [
        { bomId: 10n, materialId: 3101n, groupKey: "base", groupName: "底座", name: "二脚底座（无挡脚）", position: 1 },
        { bomId: 10n, materialId: 3112n, groupKey: "bracket", groupName: "支架", name: "6.3支架：铜镀银", position: 2 },
    ],
    customers: [mkCustomer()],
    orders: [],
    shipments: [],
    outboundNet: new Map(),
    changeLogs: [],
    opLogs: [],
});

describe("OrdersService.listOrders", () => {
    it("映射契约形态：快照客户名、视图出库净额（缺行按 0）、日期 yyyy-MM-dd、归档字段仅终态返回", async () => {
        const store = emptyStore();
        store.orders.push(
            mkOrder(),
            mkOrder({
                id: 502n,
                orderNo: "ZM260912003",
                lifecycleStatus: "ARCHIVED" as const,
                archivedAt: new Date("2026-09-20T08:00:00Z"),
                archiveReason: "行情不好客户弃单",
                archiver: { name: "郭均" },
            }),
        );
        store.outboundNet.set(500n, 60);
        const { service } = mkService(store);
        const list = await service.listOrders();
        expect(list).toHaveLength(2);
        expect(list[0]).toMatchObject({
            orderNo: "ZM260912001",
            customer: "深圳市智造电子",
            customerCode: "CUS-0900",
            bomCode: "ZMKW0001",
            outbound: 60,
            orderDate: "2026-09-12",
            deliverDate: "2026-09-30",
            lifecycleStatus: "active",
        });
        expect(list[0]).not.toHaveProperty("archivedAt");
        expect(list[1]).toMatchObject({
            lifecycleStatus: "archived",
            archivedBy: "郭均",
            archiveReason: "行情不好客户弃单",
        });
        expect(list[1].outbound).toBe(0);
        expect(list[1].archivedAt).toBe("2026-09-20T08:00:00.000Z");
    });
});

describe("OrdersService.createOrder", () => {
    let store: Store;
    let ctx: ReturnType<typeof mkService>;

    beforeEach(() => {
        store = emptyStore();
        ctx = mkService(store);
    });

    it("创建成功：服务端冻结客户与 BOM 快照、按 orderDate 取号、写 CREATE 日志与 op_log", async () => {
        const created = await ctx.service.createOrder(createInput, actor, ID_KEY);
        expect(created).toMatchObject({
            orderNo: "ZM260912001",
            version: 1,
            qty: 500,
            customer: "深圳市智造电子",
            lifecycleStatus: "active",
            outbound: 0,
        });
        const stored = store.orders[0]!;
        expect(stored.customerNameSnapshot).toBe("深圳市智造电子");
        expect(stored.bomNameSnapshot).toBe("新微动");
        // 冻结形态：{ items, modelCode, spec }，全部取自建档快照（无 model 组 → modelCode 为空）
        expect(stored.bomModelSnapshot).toBe("");
        expect(stored.bomSpecSnapshot).toMatchObject({
            modelCode: "",
            spec: "底座：二脚底座（无挡脚） · 支架：6.3支架：铜镀银",
            items: [
                { materialId: "3101", groupName: "底座", name: "二脚底座（无挡脚）", position: 1 },
                { materialId: "3112", groupName: "支架", name: "6.3支架：铜镀银", position: 2 },
            ],
        });
        expect(store.changeLogs).toHaveLength(1);
        expect(store.changeLogs[0]).toMatchObject({ eventType: "CREATE" });
        expect(store.opLogs).toHaveLength(1);
        expect(ctx.idempotency.complete).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ httpStatus: 200, resource: { type: "order", code: "ZM260912001" } }),
        );
    });

    it("BOM 或客户不存在返回 404；幂等键非法 400 不触碰数据库", async () => {
        await expect(ctx.service.createOrder({ ...createInput, bomCode: "ZMXXXX999" }, actor, ID_KEY)).rejects.toThrow(
            new NotFoundException("BOM 不存在"),
        );
        await expect(
            ctx.service.createOrder({ ...createInput, customerCode: "CUS-9999" }, actor, ID_KEY),
        ).rejects.toThrow(new NotFoundException("客户不存在"));
        await expect(ctx.service.createOrder(createInput, actor, "short")).rejects.toThrow(BadRequestException);
        expect(ctx.tx.salesOrderTable.create).not.toHaveBeenCalled();
    });

    it("重放直接返回首次响应，不再执行业务", async () => {
        const replayBody = { version: 1, orderNo: "ZM260912009" };
        const local = mkService(
            store,
            vi.fn(async () => ({ replay: { httpStatus: 200, body: replayBody }, placeholderId: null })),
        );
        const result = await local.service.createOrder(createInput, actor, ID_KEY);
        expect(result).toEqual(replayBody);
        expect(local.tx.salesOrderTable.create).not.toHaveBeenCalled();
    });
});

describe("OrdersService.updateOrder", () => {
    let store: Store;
    let ctx: ReturnType<typeof mkService>;

    beforeEach(() => {
        store = emptyStore();
        store.orders.push(mkOrder());
        ctx = mkService(store);
    });

    it("订单不存在 404；无可变字段 400；版本不匹配 409；已归档 409", async () => {
        await expect(ctx.service.updateOrder("ZM999999999", { expectedVersion: 1, qty: 10 }, actor)).rejects.toThrow(
            new NotFoundException("订单不存在"),
        );
        await expect(ctx.service.updateOrder("ZM260912001", { expectedVersion: 1 }, actor)).rejects.toThrow(
            new BadRequestException("至少修改客户、BOM、数量、交货日期或备注之一"),
        );
        await expect(ctx.service.updateOrder("ZM260912001", { expectedVersion: 3, qty: 10 }, actor)).rejects.toThrow(
            ConflictException,
        );
        store.orders[0]!.lifecycleStatus = "ARCHIVED" as const;
        await expect(
            ctx.service.updateOrder("ZM260912001", { expectedVersion: 1, remark: "x" }, actor),
        ).rejects.toThrow(new ConflictException("订单已归档，不可修改"));
    });

    it("未发货订单可改数量与交期：合法修改版本 +1 并写 UPDATE 日志", async () => {
        const updated = await ctx.service.updateOrder(
            "ZM260912001",
            { expectedVersion: 1, qty: 120, deliverDate: "2026-10-15", remark: "加急" },
            actor,
        );
        expect(updated).toMatchObject({
            version: 2,
            qty: 120,
            deliverDate: "2026-10-15",
            remark: "加急",
            outbound: 0,
        });
        expect(store.changeLogs.at(-1)).toMatchObject({ eventType: "UPDATE", beforeVersion: 1n, afterVersion: 2n });
    });

    it("已发货订单数量与交货日期锁定：携带任一字段 409，仅改备注放行", async () => {
        store.outboundNet.set(500n, 80);
        await expect(
            ctx.service.updateOrder("ZM260912001", { expectedVersion: 1, qty: 120, remark: "补备注" }, actor),
        ).rejects.toThrow(new ConflictException("订单已有出库记录，数量与交货日期不可修改，仅可修改备注"));
        await expect(
            ctx.service.updateOrder("ZM260912001", { expectedVersion: 1, deliverDate: "2026-10-15" }, actor),
        ).rejects.toThrow(new ConflictException("订单已有出库记录，数量与交货日期不可修改，仅可修改备注"));

        const updated = await ctx.service.updateOrder("ZM260912001", { expectedVersion: 1, remark: "仅改备注" }, actor);
        expect(updated).toMatchObject({ version: 2, qty: 100, deliverDate: "2026-09-30", remark: "仅改备注" });
        expect(store.changeLogs.at(-1)).toMatchObject({ eventType: "UPDATE" });
    });

    /** 换客户/换 BOM 的种子：第二 BOM（含自己的建档明细）与第二客户 */
    const seedSecondIdentity = () => {
        store.boms.push(mkBom({ id: 11n, bomCode: "ZMKW0002", category: { name: "防水微动" } }));
        store.bomItems.push({
            bomId: 11n,
            materialId: 3102n,
            groupKey: "base",
            groupName: "底座",
            name: "三脚底座（带挡脚）",
            position: 1,
        });
        store.customers.push(mkCustomer({ id: 901n, customerCode: "CUS-0901", name: "广州精密仪器" }));
    };

    it("未发货订单可换客户与 BOM：外键与名称/规格快照重冻、版本 +1、UPDATE 日志带前后客户", async () => {
        seedSecondIdentity();
        const updated = await ctx.service.updateOrder(
            "ZM260912001",
            {
                expectedVersion: 1,
                customerCode: "CUS-0901",
                bomCode: "ZMKW0002",
                qty: 80,
                deliverDate: "2026-10-20",
                remark: "换客户与 BOM",
            },
            actor,
        );
        expect(updated).toMatchObject({
            version: 2,
            customer: "广州精密仪器",
            customerCode: "CUS-0901",
            bomCode: "ZMKW0002",
            qty: 80,
            deliverDate: "2026-10-20",
            remark: "换客户与 BOM",
        });
        const stored = store.orders[0]!;
        expect(stored.customerId).toBe(901n);
        expect(stored.bomId).toBe(11n);
        expect(stored.customerNameSnapshot).toBe("广州精密仪器");
        expect(stored.bomNameSnapshot).toBe("防水微动");
        // BOM 明细按新建档重冻（与 createOrder 同口径）
        expect(stored.bomSpecSnapshot).toMatchObject({
            modelCode: "",
            spec: "底座：三脚底座（带挡脚）",
            items: [{ materialId: "3102", groupName: "底座", name: "三脚底座（带挡脚）", position: 1 }],
        });
        const log = store.changeLogs.at(-1) as {
            beforeJson: Record<string, unknown>;
            afterJson: Record<string, unknown>;
        };
        expect(log).toMatchObject({ eventType: "UPDATE", beforeVersion: 1n, afterVersion: 2n });
        expect(log.beforeJson).toMatchObject({
            customer: "深圳市智造电子",
            customerCode: "CUS-0900",
            bomName: "新微动",
        });
        expect(log.afterJson).toMatchObject({
            customer: "广州精密仪器",
            customerCode: "CUS-0901",
            bomName: "防水微动",
        });
    });

    it("同值客户/BOM 上送视为未变更：存在已作废出库单也不触发身份守卫", async () => {
        store.shipments.push({ orderId: 500n, state: "VOIDED", deletedAt: null } as OutboundShipment);
        const updated = await ctx.service.updateOrder(
            "ZM260912001",
            { expectedVersion: 1, customerCode: "CUS-0900", bomCode: "ZMKW0001", remark: "仅改备注" },
            actor,
        );
        expect(updated).toMatchObject({
            version: 2,
            customerCode: "CUS-0900",
            bomCode: "ZMKW0001",
            remark: "仅改备注",
        });
        expect(store.orders[0]!.customerId).toBe(900n);
        expect(store.orders[0]!.bomId).toBe(10n);
    });

    it("已发货订单客户与 BOM 锁定：携带变更 409，仅改备注放行", async () => {
        seedSecondIdentity();
        store.outboundNet.set(500n, 80);
        await expect(
            ctx.service.updateOrder(
                "ZM260912001",
                { expectedVersion: 1, customerCode: "CUS-0901", remark: "x" },
                actor,
            ),
        ).rejects.toThrow(new ConflictException("订单已有出库记录，客户与 BOM 不可修改，仅可修改备注"));
        await expect(
            ctx.service.updateOrder("ZM260912001", { expectedVersion: 1, bomCode: "ZMKW0002" }, actor),
        ).rejects.toThrow(new ConflictException("订单已有出库记录，客户与 BOM 不可修改，仅可修改备注"));
        const updated = await ctx.service.updateOrder("ZM260912001", { expectedVersion: 1, remark: "仅改备注" }, actor);
        expect(updated).toMatchObject({ version: 2, customerCode: "CUS-0900" });
    });

    it("存在未删除出库单（净额已归零）时换 BOM 409：与删除同口径", async () => {
        seedSecondIdentity();
        store.shipments.push({ orderId: 500n, state: "VOIDED", deletedAt: null } as OutboundShipment);
        await expect(
            ctx.service.updateOrder("ZM260912001", { expectedVersion: 1, bomCode: "ZMKW0002" }, actor),
        ).rejects.toThrow(new ConflictException("请先作废并删除关联出库单，再修改客户与 BOM"));
        // 出库单软删除后不再阻止
        store.shipments[0]!.deletedAt = new Date();
        const updated = await ctx.service.updateOrder(
            "ZM260912001",
            { expectedVersion: 1, bomCode: "ZMKW0002" },
            actor,
        );
        expect(updated).toMatchObject({ version: 2, bomCode: "ZMKW0002" });
    });

    it("换 BOM 预检与换客户解析：未知编码 404（BOM 预检在守卫前，与新建同序）", async () => {
        await expect(
            ctx.service.updateOrder("ZM260912001", { expectedVersion: 1, bomCode: "ZMXXXX999" }, actor),
        ).rejects.toThrow(new NotFoundException("BOM 不存在"));
        await expect(
            ctx.service.updateOrder("ZM260912001", { expectedVersion: 1, customerCode: "CUS-9999" }, actor),
        ).rejects.toThrow(new NotFoundException("客户不存在"));
        expect(store.orders[0]!.rowVersion).toBe(1n);
    });

    it("定位读与锁定间 BOM 引用漂移：409 刷新重试（锁集完整性兜底）", async () => {
        ctx.tx.salesOrderTable.findUnique.mockImplementationOnce(
            async () => ({ id: 500n, bomId: 999n }) as unknown as OrderRow,
        );
        await expect(
            ctx.service.updateOrder("ZM260912001", { expectedVersion: 1, remark: "x" }, actor),
        ).rejects.toThrow(new ConflictException("订单已被其他人修改，请刷新后重试"));
        expect(ctx.tx.salesOrderTable.update).not.toHaveBeenCalled();
    });
});

describe("OrdersService.archiveOrder", () => {
    let store: Store;
    let ctx: ReturnType<typeof mkService>;

    beforeEach(() => {
        store = emptyStore();
        store.orders.push(mkOrder());
        ctx = mkService(store);
    });

    it("订单不存在 404；幂等键非法 400；版本不匹配 409", async () => {
        await expect(ctx.service.archiveOrder("ZM999999999", { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new NotFoundException("订单不存在"),
        );
        await expect(ctx.service.archiveOrder("ZM260912001", { expectedVersion: 1 }, actor, "short")).rejects.toThrow(
            BadRequestException,
        );
        await expect(ctx.service.archiveOrder("ZM260912001", { expectedVersion: 9 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("订单已被其他人修改，请刷新后重试"),
        );
        expect(ctx.tx.salesOrderTable.update).not.toHaveBeenCalled();
    });

    it("未发货的订单不可归档 409；已归档重复归档 409；存在已登记出库单仍可归档", async () => {
        await expect(ctx.service.archiveOrder("ZM260912001", { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("订单尚未发货，无需归档；手误订单请删除"),
        );

        store.orders[0]!.lifecycleStatus = "ARCHIVED" as const;
        await expect(ctx.service.archiveOrder("ZM260912001", { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("订单已归档"),
        );

        store.orders[0]!.lifecycleStatus = "ACTIVE" as const;
        store.outboundNet.set(500n, 40);
        store.shipments.push({ orderId: 500n, state: "REGISTERED" } as OutboundShipment);
        const archived = await ctx.service.archiveOrder("ZM260912001", { expectedVersion: 1 }, actor, ID_KEY);
        expect(archived).toMatchObject({ lifecycleStatus: "archived" });
        expect(store.changeLogs).toHaveLength(1);
    });

    it("归档成功：终态三要素落库（备注选填）、版本 +1、写 ARCHIVE 日志与 op_log、返回归档后订单", async () => {
        store.outboundNet.set(500n, 40);
        const archived = await ctx.service.archiveOrder(
            "ZM260912001",
            { expectedVersion: 1, reason: "行情不好客户弃单" },
            actor,
            ID_KEY,
        );
        expect(archived).toMatchObject({
            lifecycleStatus: "archived",
            version: 2,
            qty: 100,
            outbound: 40,
            archiveReason: "行情不好客户弃单",
        });
        expect(archived.archivedAt).toBeDefined();
        const stored = store.orders[0]!;
        expect(stored.archivedBy).toBe(BigInt(actor.id));
        expect(stored.archivedAt).toBeInstanceOf(Date);
        expect(store.changeLogs.at(-1)).toMatchObject({
            eventType: "ARCHIVE",
            reason: "行情不好客户弃单",
            beforeVersion: 1n,
            afterVersion: 2n,
        });
        expect(store.opLogs.at(-1)).toMatchObject({ action: "archive_order", targetCode: "ZM260912001" });
        expect(ctx.idempotency.complete).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ httpStatus: 200, resource: { type: "order", code: "ZM260912001" } }),
        );
    });

    it("未带备注归档：归档三要素中 reason 允许为空，op_log 快照记终态语境", async () => {
        store.outboundNet.set(500n, 40);
        const archived = await ctx.service.archiveOrder("ZM260912001", { expectedVersion: 1 }, actor, ID_KEY);
        expect(archived).toMatchObject({
            lifecycleStatus: "archived",
            version: 2,
            outbound: 40,
        });
        expect(archived.archivedAt).toBeDefined();
        expect(archived.archivedBy).toBe("");
        expect(archived.archiveReason).toBe("");
        expect(store.orders[0]!.archiveReason).toBeNull();
        expect(store.opLogs.at(-1)).toMatchObject({
            action: "archive_order",
            detailJson: expect.objectContaining({ lifecycleStatus: "ARCHIVED" }),
        });
    });

    it("重放直接返回首次响应，不再执行业务", async () => {
        store.outboundNet.set(500n, 40);
        const replayBody = { version: 2, lifecycleStatus: "archived" };
        const local = mkService(
            store,
            vi.fn(async () => ({ replay: { httpStatus: 200, body: replayBody }, placeholderId: null })),
        );
        const result = await local.service.archiveOrder("ZM260912001", { expectedVersion: 1 }, actor, ID_KEY);
        expect(result).toEqual(replayBody);
        expect(local.tx.salesOrderTable.update).not.toHaveBeenCalled();
    });
});

describe("OrdersService.unarchiveOrder", () => {
    let store: Store;
    let ctx: ReturnType<typeof mkService>;

    /** 已归档订单（归档人为 actor）：rowVersion 2 = 建单 1 + 归档 1 */
    const mkArchived = () =>
        mkOrder({
            lifecycleStatus: "ARCHIVED" as const,
            archivedAt: new Date("2026-10-05T08:00:00Z"),
            archivedBy: BigInt(actor.id),
            archiveReason: "行情不好客户弃单",
            rowVersion: 2n,
        });

    beforeEach(() => {
        store = emptyStore();
        store.orders.push(mkArchived());
        ctx = mkService(store);
    });

    it("订单不存在 404；幂等键非法 400；版本不匹配 409；未归档订单 409", async () => {
        await expect(ctx.service.unarchiveOrder("ZM999999999", { expectedVersion: 2 }, actor, ID_KEY)).rejects.toThrow(
            new NotFoundException("订单不存在"),
        );
        await expect(ctx.service.unarchiveOrder("ZM260912001", { expectedVersion: 2 }, actor, "short")).rejects.toThrow(
            BadRequestException,
        );
        await expect(ctx.service.unarchiveOrder("ZM260912001", { expectedVersion: 9 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("订单已被其他人修改，请刷新后重试"),
        );
        store.orders[0]!.lifecycleStatus = "ACTIVE" as const;
        await expect(ctx.service.unarchiveOrder("ZM260912001", { expectedVersion: 2 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("订单未归档，无需回退"),
        );
        expect(ctx.tx.salesOrderTable.update).not.toHaveBeenCalled();
    });

    it("非归档人 403（超管同样受限）：archived_by 判等在服务层强校验", async () => {
        store.orders[0]!.archivedBy = 999n;
        await expect(ctx.service.unarchiveOrder("ZM260912001", { expectedVersion: 2 }, actor, ID_KEY)).rejects.toThrow(
            new ForbiddenException("只有归档人本人可以回退归档"),
        );
        // 防御分支：ARCHIVED 态下 archived_by 理论上非空（ck_sales_order_archive），空值同样拒绝
        store.orders[0]!.archivedBy = null;
        await expect(ctx.service.unarchiveOrder("ZM260912001", { expectedVersion: 2 }, actor, ID_KEY)).rejects.toThrow(
            new ForbiddenException("只有归档人本人可以回退归档"),
        );
        expect(ctx.tx.salesOrderTable.update).not.toHaveBeenCalled();
    });

    it("回退成功：归档三要素清空、版本 +1、写 UNARCHIVE 日志与 op_log、返回活跃订单", async () => {
        store.outboundNet.set(500n, 40);
        const result = await ctx.service.unarchiveOrder(
            "ZM260912001",
            { expectedVersion: 2, reason: "归档错了，恢复跟进" },
            actor,
            ID_KEY,
        );
        expect(result).toMatchObject({
            lifecycleStatus: "active",
            version: 3,
            qty: 100,
            outbound: 40,
        });
        expect(result.archivedAt).toBeUndefined();
        expect(result.archivedBy).toBeUndefined();
        const stored = store.orders[0]!;
        expect(stored.lifecycleStatus).toBe("ACTIVE");
        expect(stored.archivedAt).toBeNull();
        expect(stored.archivedBy).toBeNull();
        expect(stored.archiveReason).toBeNull();
        expect(store.changeLogs.at(-1)).toMatchObject({
            eventType: "UNARCHIVE",
            reason: "归档错了，恢复跟进",
            beforeVersion: 2n,
            afterVersion: 3n,
        });
        expect(store.opLogs.at(-1)).toMatchObject({ action: "unarchive_order", targetCode: "ZM260912001" });
        expect(ctx.idempotency.complete).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ httpStatus: 200, resource: { type: "order", code: "ZM260912001" } }),
        );
    });

    it("未带备注回退：change_log reason 允许为空，op_log 快照记回退后语境", async () => {
        store.outboundNet.set(500n, 40);
        const result = await ctx.service.unarchiveOrder("ZM260912001", { expectedVersion: 2 }, actor, ID_KEY);
        expect(result).toMatchObject({ lifecycleStatus: "active", version: 3, outbound: 40 });
        expect(store.changeLogs.at(-1)).toMatchObject({ eventType: "UNARCHIVE", reason: "" });
        expect(store.opLogs.at(-1)).toMatchObject({
            action: "unarchive_order",
            detailJson: expect.objectContaining({ lifecycleStatus: "ACTIVE", unarchivedBy: "郭均" }),
        });
    });

    it("重放直接返回首次响应，不再执行业务", async () => {
        store.outboundNet.set(500n, 40);
        const replayBody = { version: 3, lifecycleStatus: "active" };
        const local = mkService(
            store,
            vi.fn(async () => ({ replay: { httpStatus: 200, body: replayBody }, placeholderId: null })),
        );
        const result = await local.service.unarchiveOrder("ZM260912001", { expectedVersion: 2 }, actor, ID_KEY);
        expect(result).toEqual(replayBody);
        expect(local.tx.salesOrderTable.update).not.toHaveBeenCalled();
    });
});

describe("OrdersService.deleteOrder", () => {
    let store: Store;
    let ctx: ReturnType<typeof mkService>;

    beforeEach(() => {
        store = emptyStore();
        store.orders.push(mkOrder());
        ctx = mkService(store);
    });

    it("订单不存在 404；幂等键非法 400；版本不匹配 409", async () => {
        await expect(ctx.service.deleteOrder("ZM999999999", { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new NotFoundException("订单不存在"),
        );
        await expect(ctx.service.deleteOrder("ZM260912001", { expectedVersion: 1 }, actor, "short")).rejects.toThrow(
            BadRequestException,
        );
        await expect(ctx.service.deleteOrder("ZM260912001", { expectedVersion: 9 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("订单已被其他人修改，请刷新后重试"),
        );
        store.orders[0]!.lifecycleStatus = "ARCHIVED" as const;
        await expect(ctx.service.deleteOrder("ZM260912001", { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("订单已归档，不可删除"),
        );
        expect(ctx.tx.salesOrderTable.delete).not.toHaveBeenCalled();
    });

    it("有效出库净额大于 0 或存在未删除的作废出库单均 409；已软删除出库不阻止", async () => {
        store.outboundNet.set(500n, 20);
        await expect(ctx.service.deleteOrder("ZM260912001", { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("订单已有发货记录，不可删除"),
        );

        // 曾发货又作废：净额回到 0，但出库单（VOIDED）仍在——审计链不悬空，同样拒绝
        store.outboundNet.delete(500n);
        store.shipments.push({ orderId: 500n, state: "VOIDED", deletedAt: null } as OutboundShipment);
        await expect(ctx.service.deleteOrder("ZM260912001", { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException("请先作废并删除关联出库单，再删除订单"),
        );
        expect(store.orders).toHaveLength(1);
        store.shipments[0]!.deletedAt = new Date();
        await expect(ctx.service.deleteOrder("ZM260912001", { expectedVersion: 1 }, actor, ID_KEY)).resolves.toBeNull();
        expect(store.orders[0]!.deletedAt).toBeInstanceOf(Date);
    });

    it("删除成功：订单软删除并保留变更日志和出库外键，列表隐藏，op_log 留快照", async () => {
        store.changeLogs.push({ orderId: 500n, eventType: "CREATE" });
        const result = await ctx.service.deleteOrder("ZM260912001", { expectedVersion: 1 }, actor, ID_KEY);
        expect(result).toBeNull();
        expect(store.orders).toHaveLength(1);
        expect(store.orders[0]!.deletedAt).toBeInstanceOf(Date);
        expect(store.changeLogs).toHaveLength(1);
        expect(await ctx.service.listOrders()).toHaveLength(0);
        expect(store.opLogs.at(-1)).toMatchObject({
            action: "delete_order",
            targetCode: "ZM260912001",
        });
        expect(ctx.idempotency.complete).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                httpStatus: 200,
                resource: { type: "order", code: "ZM260912001" },
            }),
        );

        const local = mkService(
            store,
            vi.fn(async () => ({ replay: { httpStatus: 200, body: { deleted: true } }, placeholderId: null })),
        );
        const replay = await local.service.deleteOrder("ZM260912001", { expectedVersion: 1 }, actor, ID_KEY);
        expect(replay).toBeNull();
        expect(local.idempotency.complete).not.toHaveBeenCalled();
    });

    it("删除的订单：快照保留终态与 BOM 冻结字段，长期审计可独立还原", async () => {
        await ctx.service.deleteOrder("ZM260912001", { expectedVersion: 1 }, actor, ID_KEY);
        expect(store.opLogs.at(-1)).toMatchObject({
            action: "delete_order",
            detailJson: {
                lifecycleStatus: "ACTIVE",
                bomName: "新微动",
                bomCode: "ZMKW0001",
            },
        });
        expect(store.opLogs.at(-1)).not.toMatchObject({
            detailJson: expect.objectContaining({ cancelledBy: expect.anything() }),
        });
    });
});

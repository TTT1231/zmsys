import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionRunner } from '../prisma/transaction.runner';
import { SnowflakeGenerator } from '../common/snowflake';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { BusinessSequenceService } from '../sequence/business-sequence.service';
import type { BomTable, CustomTable, OutboundShipment, SalesOrderTable } from '../generated/prisma/client';

const actor = {
    id: '1',
    account: 'guojun',
    name: '郭均',
    role: 'super',
    isSuper: true,
    rowVersion: 1,
    permissions: new Set<string>(),
} as const;

const ID_KEY = 'idem-key-01';

type OrderRow = SalesOrderTable & {
    customer: { customerCode: string };
    bom: { bomCode: string };
    canceller: { name: string } | null;
};

const mkBom = (overrides: Partial<BomTable> = {}): BomTable & { category: { name: string } } =>
    ({
        id: 10n,
        bomCode: 'ZMKW0001',
        categoryId: 1003n,
        specHash: new Uint8Array(32),
        unit: '个',
        status: true,
        rowVersion: 1n,
        requestKey: 'req-bom',
        createdBy: 1n,
        updatedBy: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        category: { name: '新微动' },
        ...overrides,
    }) as BomTable & { category: { name: string } };

const mkCustomer = (overrides: Partial<CustomTable> = {}): CustomTable =>
    ({
        id: 900n,
        customerCode: 'CUS-0900',
        name: '深圳市智造电子',
        contactPerson: '王经理',
        contactPhone: '13800001111',
        province: '广东省',
        city: '深圳市',
        district: null,
        town: null,
        address: '科技园 1 号',
        ownerId: 200n,
        payTerms: '',
        rowVersion: 1n,
        requestKey: 'req-cus',
        createdBy: 1n,
        updatedBy: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    }) as CustomTable;

const mkOrder = (overrides: Partial<OrderRow> = {}): OrderRow =>
    ({
        id: 500n,
        orderNo: 'ZM260912001',
        customerId: 900n,
        bomId: 10n,
        qty: 100,
        lifecycleStatus: 'ACTIVE',
        orderDate: new Date('2026-09-12T00:00:00Z'),
        deliverDate: new Date('2026-09-30T00:00:00Z'),
        remark: '',
        customerNameSnapshot: '深圳市智造电子',
        bomNameSnapshot: '新微动',
        bomModelSnapshot: '',
        bomSpecSnapshot: {},
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        rowVersion: 1n,
        requestKey: 'req-order',
        createdBy: 1n,
        updatedBy: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        customer: { customerCode: 'CUS-0900' },
        bom: { bomCode: 'ZMKW0001' },
        canceller: null,
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
            : { customerCode: 'CUS-0000' },
        bom: { bomCode: store.boms.find(b => b.id === order.bomId)?.bomCode ?? 'ZM0000000' },
        canceller: null,
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
            const text = strings.join('');
            if (text.includes('v_order_outbound_qty')) {
                if (text.includes('WHERE')) {
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
            findUnique: vi.fn(
                async ({ where }: { where: { bomCode: string } }) =>
                    store.boms.find(b => b.bomCode === where.bomCode) ?? null,
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
            findMany: vi.fn(async () => store.orders),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                const created = mkOrder(data as Partial<OrderRow>);
                store.orders.push(created);
                return created;
            }),
            update: vi.fn(async ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
                const index = store.orders.findIndex(o => o.id === where.id);
                if (index < 0) {
                    throw new Error('update: 订单不存在');
                }
                const applied = { ...store.orders[index], ...data } as OrderRow;
                const patch = data.rowVersion as { increment: number } | undefined;
                if (patch) {
                    applied.rowVersion = store.orders[index].rowVersion + BigInt(patch.increment);
                }
                store.orders[index] = applied;
                return applied;
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
            count: vi.fn(
                async ({ where }: { where: { orderId: bigint } }) =>
                    store.shipments.filter(s => s.orderId === where.orderId).length,
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
    const idempotency = {
        requireKey: vi.fn((key?: string) => {
            if (!key || key.length < 8) {
                throw new BadRequestException('Idempotency-Key 必须为 8–128 个可见 ASCII 字符');
            }
            return key;
        }),
        digest: vi.fn(() => new Uint8Array(32)),
        requestKey: vi.fn(() => 'a'.repeat(64)),
        beginOrReplay: beginOrReplay ?? vi.fn(async () => ({ replay: null, placeholderId: 8000000000000000n })),
        complete: vi.fn(),
    } as unknown as IdempotencyService & Record<string, ReturnType<typeof vi.fn>>;
    const sequence = {
        nextCode: vi.fn(async (_tx: unknown, type: string, businessDate: string) =>
            type === 'order' ? `ZM${businessDate.slice(2).replaceAll('-', '')}001` : 'CUS-0042',
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
    customerCode: 'CUS-0900',
    bomCode: 'ZMKW0001',
    qty: 500,
    deliverDate: '2026-09-30',
    orderDate: '2026-09-12',
    remark: '首次合作',
};

const emptyStore = (): Store => ({
    boms: [mkBom()],
    bomItems: [
        { bomId: 10n, materialId: 3101n, groupKey: 'base', groupName: '底座', name: '二脚底座（无挡脚）', position: 1 },
        { bomId: 10n, materialId: 3112n, groupKey: 'bracket', groupName: '支架', name: '6.3支架：铜镀银', position: 2 },
    ],
    customers: [mkCustomer()],
    orders: [],
    shipments: [],
    outboundNet: new Map(),
    changeLogs: [],
    opLogs: [],
});

describe('OrdersService.listOrders', () => {
    it('映射契约形态：快照客户名、视图出库净额（缺行按 0）、日期 yyyy-MM-dd、取消字段仅终态返回', async () => {
        const store = emptyStore();
        store.orders.push(
            mkOrder(),
            mkOrder({
                id: 501n,
                orderNo: 'ZM260912002',
                lifecycleStatus: 'CANCELLED' as const,
                cancelledAt: new Date('2026-09-12T07:30:00Z'),
                cancelReason: '客户计划变更',
            }),
        );
        store.outboundNet.set(500n, 60);
        const { service } = mkService(store);
        const list = await service.listOrders();
        expect(list).toHaveLength(2);
        expect(list[0]).toMatchObject({
            orderNo: 'ZM260912001',
            customer: '深圳市智造电子',
            customerCode: 'CUS-0900',
            bomCode: 'ZMKW0001',
            outbound: 60,
            orderDate: '2026-09-12',
            deliverDate: '2026-09-30',
            lifecycleStatus: 'active',
        });
        expect(list[0]).not.toHaveProperty('cancelledAt');
        expect(list[1]).toMatchObject({
            lifecycleStatus: 'cancelled',
            cancelReason: '客户计划变更',
        });
        expect(list[1].outbound).toBe(0);
    });
});

describe('OrdersService.createOrder', () => {
    let store: Store;
    let ctx: ReturnType<typeof mkService>;

    beforeEach(() => {
        store = emptyStore();
        ctx = mkService(store);
    });

    it('创建成功：服务端冻结客户与 BOM 快照、按 orderDate 取号、写 CREATE 日志与 op_log', async () => {
        const created = await ctx.service.createOrder(createInput, actor, ID_KEY);
        expect(created).toMatchObject({
            orderNo: 'ZM260912001',
            version: 1,
            qty: 500,
            customer: '深圳市智造电子',
            lifecycleStatus: 'active',
            outbound: 0,
        });
        const stored = store.orders[0]!;
        expect(stored.customerNameSnapshot).toBe('深圳市智造电子');
        expect(stored.bomNameSnapshot).toBe('新微动');
        // 冻结形态：{ items, modelCode, spec }，全部取自建档快照（无 model 组 → modelCode 为空）
        expect(stored.bomModelSnapshot).toBe('');
        expect(stored.bomSpecSnapshot).toMatchObject({
            modelCode: '',
            spec: '底座：二脚底座（无挡脚） · 支架：6.3支架：铜镀银',
            items: [
                { materialId: '3101', groupName: '底座', name: '二脚底座（无挡脚）', position: 1 },
                { materialId: '3112', groupName: '支架', name: '6.3支架：铜镀银', position: 2 },
            ],
        });
        expect(store.changeLogs).toHaveLength(1);
        expect(store.changeLogs[0]).toMatchObject({ eventType: 'CREATE' });
        expect(store.opLogs).toHaveLength(1);
        expect(ctx.idempotency.complete).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ httpStatus: 200, resource: { type: 'order', code: 'ZM260912001' } }),
        );
    });

    it('BOM 或客户不存在返回 404；幂等键非法 400 不触碰数据库', async () => {
        await expect(ctx.service.createOrder({ ...createInput, bomCode: 'ZMXXXX999' }, actor, ID_KEY)).rejects.toThrow(
            new NotFoundException('BOM 不存在'),
        );
        await expect(
            ctx.service.createOrder({ ...createInput, customerCode: 'CUS-9999' }, actor, ID_KEY),
        ).rejects.toThrow(new NotFoundException('客户不存在'));
        await expect(ctx.service.createOrder(createInput, actor, 'short')).rejects.toThrow(BadRequestException);
        expect(ctx.tx.salesOrderTable.create).not.toHaveBeenCalled();
    });

    it('重放直接返回首次响应，不再执行业务', async () => {
        const replayBody = { version: 1, orderNo: 'ZM260912009' };
        const local = mkService(
            store,
            vi.fn(async () => ({ replay: { httpStatus: 200, body: replayBody }, placeholderId: null })),
        );
        const result = await local.service.createOrder(createInput, actor, ID_KEY);
        expect(result).toEqual(replayBody);
        expect(local.tx.salesOrderTable.create).not.toHaveBeenCalled();
    });
});

describe('OrdersService.updateOrder', () => {
    let store: Store;
    let ctx: ReturnType<typeof mkService>;

    beforeEach(() => {
        store = emptyStore();
        store.orders.push(mkOrder());
        ctx = mkService(store);
    });

    it('订单不存在 404；无可变字段 400；版本不匹配 409；已取消 409', async () => {
        await expect(ctx.service.updateOrder('ZM999999999', { expectedVersion: 1, qty: 10 }, actor)).rejects.toThrow(
            new NotFoundException('订单不存在'),
        );
        await expect(ctx.service.updateOrder('ZM260912001', { expectedVersion: 1 }, actor)).rejects.toThrow(
            new BadRequestException('至少修改数量、交货日期或备注之一'),
        );
        await expect(ctx.service.updateOrder('ZM260912001', { expectedVersion: 3, qty: 10 }, actor)).rejects.toThrow(
            ConflictException,
        );
        store.orders[0]!.lifecycleStatus = 'CANCELLED' as const;
        await expect(ctx.service.updateOrder('ZM260912001', { expectedVersion: 1, qty: 10 }, actor)).rejects.toThrow(
            new ConflictException('订单已取消，不可修改'),
        );
    });

    it('新数量低于有效出库净额 409；合法修改版本 +1 并写 UPDATE 日志', async () => {
        store.outboundNet.set(500n, 80);
        await expect(ctx.service.updateOrder('ZM260912001', { expectedVersion: 1, qty: 50 }, actor)).rejects.toThrow(
            ConflictException,
        );

        const updated = await ctx.service.updateOrder(
            'ZM260912001',
            { expectedVersion: 1, qty: 120, deliverDate: '2026-10-15', remark: '加急' },
            actor,
        );
        expect(updated).toMatchObject({
            version: 2,
            qty: 120,
            deliverDate: '2026-10-15',
            remark: '加急',
            outbound: 80,
        });
        expect(store.changeLogs.at(-1)).toMatchObject({ eventType: 'UPDATE', beforeVersion: 1n, afterVersion: 2n });
    });
});

describe('OrdersService.cancelOrder', () => {
    let store: Store;
    let ctx: ReturnType<typeof mkService>;

    beforeEach(() => {
        store = emptyStore();
        store.orders.push(mkOrder());
        ctx = mkService(store);
    });

    it('存在已登记未打印出库单 409；已全部发货 409；已取消 409', async () => {
        store.shipments.push({ orderId: 500n, state: 'REGISTERED' } as OutboundShipment);
        await expect(
            ctx.service.cancelOrder('ZM260912001', { expectedVersion: 1, reason: '计划变更' }, actor, ID_KEY),
        ).rejects.toThrow(new ConflictException('存在已登记未打印的出库单，请先作废后再取消订单'));

        store.shipments.pop();
        store.outboundNet.set(500n, 100);
        await expect(
            ctx.service.cancelOrder('ZM260912001', { expectedVersion: 1, reason: '计划变更' }, actor, ID_KEY),
        ).rejects.toThrow(new ConflictException('订单已全部发货，没有剩余量可取消'));

        store.outboundNet.delete(500n);
        store.orders[0]!.lifecycleStatus = 'CANCELLED' as const;
        await expect(
            ctx.service.cancelOrder('ZM260912001', { expectedVersion: 1, reason: '计划变更' }, actor, ID_KEY),
        ).rejects.toThrow(new ConflictException('订单已取消'));
    });

    it('取消成功：终态字段落库、版本 +1、写 CANCEL 日志（保留已发数量口径）', async () => {
        store.outboundNet.set(500n, 40);
        const cancelled = await ctx.service.cancelOrder(
            'ZM260912001',
            { expectedVersion: 1, reason: '客户计划变更' },
            actor,
            ID_KEY,
        );
        expect(cancelled).toMatchObject({
            lifecycleStatus: 'cancelled',
            version: 2,
            qty: 100,
            outbound: 40,
            cancelReason: '客户计划变更',
        });
        expect(cancelled.cancelledAt).toBeDefined();
        expect(store.changeLogs.at(-1)).toMatchObject({
            eventType: 'CANCEL',
            reason: '客户计划变更',
            beforeVersion: 1n,
            afterVersion: 2n,
        });
        expect(ctx.idempotency.complete).toHaveBeenCalled();
    });

    it('版本不匹配 409；重放返回首次响应', async () => {
        await expect(
            ctx.service.cancelOrder('ZM260912001', { expectedVersion: 9, reason: '计划变更' }, actor, ID_KEY),
        ).rejects.toThrow(ConflictException);

        const replayBody = { version: 2, lifecycleStatus: 'cancelled' };
        const local = mkService(
            store,
            vi.fn(async () => ({ replay: { httpStatus: 200, body: replayBody }, placeholderId: null })),
        );
        const result = await local.service.cancelOrder(
            'ZM260912001',
            { expectedVersion: 1, reason: '计划变更' },
            actor,
            ID_KEY,
        );
        expect(result).toEqual(replayBody);
        expect(local.tx.salesOrderTable.update).not.toHaveBeenCalled();
    });
});

describe('OrdersService.deleteOrder', () => {
    let store: Store;
    let ctx: ReturnType<typeof mkService>;

    beforeEach(() => {
        store = emptyStore();
        store.orders.push(mkOrder());
        ctx = mkService(store);
    });

    it('订单不存在 404；幂等键非法 400；版本不匹配 409', async () => {
        await expect(ctx.service.deleteOrder('ZM999999999', { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new NotFoundException('订单不存在'),
        );
        await expect(ctx.service.deleteOrder('ZM260912001', { expectedVersion: 1 }, actor, 'short')).rejects.toThrow(
            BadRequestException,
        );
        await expect(ctx.service.deleteOrder('ZM260912001', { expectedVersion: 9 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException('订单已被其他人修改，请刷新后重试'),
        );
        expect(ctx.tx.salesOrderTable.delete).not.toHaveBeenCalled();
    });

    it('有效出库净额大于 0 或存在任意出库单（含已作废）均 409，台账引用保持完整', async () => {
        store.outboundNet.set(500n, 20);
        await expect(ctx.service.deleteOrder('ZM260912001', { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException('订单已有发货记录，不可删除'),
        );

        // 曾发货又作废：净额回到 0，但出库单（VOIDED）仍在——审计链不悬空，同样拒绝
        store.outboundNet.delete(500n);
        store.shipments.push({ orderId: 500n, state: 'VOIDED' } as OutboundShipment);
        await expect(ctx.service.deleteOrder('ZM260912001', { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException('订单存在出库流水（含已作废），不可删除'),
        );
        expect(store.orders).toHaveLength(1);
    });

    it('删除成功：订单与专属变更日志同事务清理，op_log 留快照，幂等重放归一为 null', async () => {
        store.changeLogs.push({ orderId: 500n, eventType: 'CREATE' });
        const result = await ctx.service.deleteOrder('ZM260912001', { expectedVersion: 1 }, actor, ID_KEY);
        expect(result).toBeNull();
        expect(store.orders).toHaveLength(0);
        expect(store.changeLogs).toHaveLength(0);
        expect(store.opLogs.at(-1)).toMatchObject({
            action: 'delete_order',
            targetCode: 'ZM260912001',
        });
        expect(ctx.idempotency.complete).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                httpStatus: 200,
                resource: { type: 'order', code: 'ZM260912001' },
            }),
        );

        const local = mkService(
            store,
            vi.fn(async () => ({ replay: { httpStatus: 200, body: { deleted: true } }, placeholderId: null })),
        );
        const replay = await local.service.deleteOrder('ZM260912001', { expectedVersion: 1 }, actor, ID_KEY);
        expect(replay).toBeNull();
        expect(local.idempotency.complete).not.toHaveBeenCalled();
    });

    it('取消后删除的订单：快照保留取消审计与 BOM 冻结字段，长期审计可独立还原', async () => {
        const cancelledAt = new Date('2026-09-13T10:00:00Z');
        store.orders[0] = mkOrder({
            lifecycleStatus: 'CANCELLED',
            cancelledAt,
            cancelReason: '客户撤单',
            canceller: { name: '陈洁' },
        });
        await ctx.service.deleteOrder('ZM260912001', { expectedVersion: 1 }, actor, ID_KEY);
        expect(store.opLogs.at(-1)).toMatchObject({
            action: 'delete_order',
            detailJson: {
                lifecycleStatus: 'CANCELLED',
                cancelledAt: cancelledAt.toISOString(),
                cancelledBy: '陈洁',
                cancelReason: '客户撤单',
                bomName: '新微动',
                bomCode: 'ZMKW0001',
            },
        });
    });
});

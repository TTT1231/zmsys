import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OutboundService } from './outbound.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionRunner } from '../prisma/transaction.runner';
import { SnowflakeGenerator } from '../common/snowflake';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { BusinessSequenceService } from '../sequence/business-sequence.service';
import type { OutboundLedger, OutboundShipment, SalesOrderTable } from '../generated/prisma/client';

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

const SPEC_SCHEMA = {
    fields: [{ key: '额定电压', label: '额定电压', type: 'select', options: ['250V'], required: true }],
};

type OrderRow = SalesOrderTable & {
    customer: { customerCode: string };
    bom: { bomCode: string; category: { specSchema: unknown } };
};

const mkOrder = (overrides: Partial<OrderRow> = {}): OrderRow =>
    ({
        id: 500n,
        orderNo: 'ZM260913001',
        customerId: 900n,
        bomId: 10n,
        qty: 600,
        orderDate: new Date('2026-09-13T00:00:00Z'),
        deliverDate: new Date('2026-10-31T00:00:00Z'),
        remark: '',
        customerNameSnapshot: '深圳市智造电子',
        bomNameSnapshot: '新微动',
        bomModelSnapshot: 'E2E-KW2',
        bomSpecSnapshot: { 额定电压: '250V' },
        lifecycleStatus: 'ACTIVE',
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
        bom: { bomCode: 'ZMKW0001', category: { specSchema: SPEC_SCHEMA } },
        ...overrides,
    }) as OrderRow;

type ShipmentRow = OutboundShipment & {
    order: OrderRow;
    registrar: { name: string };
    ledgers: Array<{ entryType: string; remark: string }>;
    printLogs: Array<{ printSeq: number }>;
};

const mkShipment = (overrides: Partial<ShipmentRow> = {}): ShipmentRow =>
    ({
        id: 600n,
        shipmentNo: 'CK26091301',
        orderId: 500n,
        originalQty: 200,
        businessDate: new Date('2026-09-13T00:00:00Z'),
        state: 'REGISTERED',
        voidMode: null,
        voidedBy: null,
        voidReason: null,
        goodsNotDeparted: null,
        paperInvalidated: null,
        voidedAt: null,
        rowVersion: 1n,
        requestKey: 'req-ship',
        registeredBy: 1n,
        registeredAt: new Date(),
        updatedAt: new Date(),
        order: mkOrder(),
        registrar: { name: '郭均' },
        ledgers: [{ entryType: 'NORMAL', remark: '首次发货' }],
        printLogs: [],
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
    printLogs: unknown[];
    opLogs: unknown[];
}

const emptyStore = (): Store => ({
    orders: [mkOrder()],
    shipments: [],
    ledgers: [],
    stock: new Map(),
    outboundNet: new Map(),
    stateLogs: [],
    printLogs: [],
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
            const text = strings.join('');
            if (text.includes('v_bom_stock')) {
                const bomId = boundValues[0] as bigint;
                const qty = store.stock.get(bomId);
                return qty === undefined ? [] : [{ stock_qty: BigInt(qty) }];
            }
            if (text.includes('deliver_date')) {
                // computeShippableQty 的活动订单聚合（§6.2 分配算法的输入）
                return store.orders
                    .filter(order => order.lifecycleStatus === 'ACTIVE')
                    .map(order => ({
                        id: order.id,
                        qty: order.qty,
                        outbound_qty: BigInt(store.outboundNet.get(order.id) ?? 0),
                    }));
            }
            if (text.includes('v_order_outbound_qty')) {
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
            findUnique: vi.fn(
                async ({ where }: { where: { shipmentNo?: string; id?: bigint } }) =>
                    store.shipments.find(s =>
                        where.shipmentNo ? s.shipmentNo === where.shipmentNo : s.id === where.id,
                    ) ?? null,
            ),
            findMany: vi.fn(async () => store.shipments),
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
                    throw new Error('update: 出库单不存在');
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
                    entryType: data.entryType as 'NORMAL' | 'CORRECTION',
                    correctionOfId: (data.correctionOfId ?? null) as bigint | null,
                    qtyDelta: data.qtyDelta as number,
                    businessDate: data.businessDate as Date,
                    operatorId: 1n,
                    remark: (data.remark ?? '') as string,
                    correctionReason: (data.correctionReason ?? null) as string | null,
                    requestKey: 'req-event',
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
        outboundPrintLog: {
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
                store.printLogs.push(data);
                const shipment = store.shipments.find(s => s.id === data.shipmentId);
                shipment?.printLogs.push({ printSeq: data.printSeq as number });
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
        outboundShipment: { findMany: tx.outboundShipment.findMany },
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
            type === 'outbound' ? `CK${businessDate.slice(2).replaceAll('-', '')}01` : 'ZM000000001',
        ),
    } as unknown as BusinessSequenceService;
    return {
        service: new OutboundService(prisma, snowflake, new TransactionRunner(prisma), idempotency, sequence),
        idempotency,
        store,
    };
};

const shipInput = { orderNo: 'ZM260913001', qty: 200, date: '2026-09-13', remark: '首次发货' };

describe('OutboundService.createOutbound', () => {
    let store: Store;
    let service: OutboundService;

    beforeEach(() => {
        store = emptyStore();
        ({ service } = mkService(store));
    });

    it('订单不存在 404；已取消订单 409；可发量不足 409', async () => {
        await expect(service.createOutbound({ ...shipInput, orderNo: 'ZM999999999' }, actor, ID_KEY)).rejects.toThrow(
            new NotFoundException('订单不存在'),
        );

        store.orders[0] = mkOrder({ lifecycleStatus: 'CANCELLED' });
        await expect(service.createOutbound(shipInput, actor, ID_KEY)).rejects.toThrow(
            new ConflictException('订单已取消，不能登记发货'),
        );

        store.orders[0] = mkOrder();
        store.stock.set(10n, 100); // 库存 100 < 请求 200
        await expect(service.createOutbound(shipInput, actor, ID_KEY)).rejects.toThrow(
            new ConflictException('库存可发量不足，请刷新后重试'),
        );
    });

    it('成功登记：单头/正向事件/状态日志/op_log 同事务，映射契约形态', async () => {
        store.stock.set(10n, 300);
        const created = await service.createOutbound(shipInput, actor, ID_KEY);
        expect(created).toMatchObject({
            no: 'CK26091301',
            orderNo: 'ZM260913001',
            customer: '深圳市智造电子',
            customerCode: 'CUS-0900',
            bomCode: 'ZMKW0001',
            qty: 200,
            state: 'registered',
            version: 1,
            printVersion: 0,
            operator: '郭均',
            date: '2026-09-13',
        });
        expect(store.ledgers).toHaveLength(1);
        expect(store.ledgers[0]).toMatchObject({ entryType: 'NORMAL', qtyDelta: 200 });
        expect(store.stateLogs).toHaveLength(1);
        expect(store.stateLogs[0]).toMatchObject({ eventType: 'REGISTER', afterVersion: 1n });
        expect(store.opLogs).toHaveLength(1);
        expect(store.opLogs[0]).toMatchObject({ action: 'ship', targetCode: 'CK26091301' });
    });
});

describe('OutboundService.voidOutbound / emergencyVoidOutbound', () => {
    it('仅 REGISTERED 可作废；作废追加等额冲销并引用原事件', async () => {
        const store = emptyStore();
        store.shipments.push(mkShipment({ state: 'PRINTED' }));
        const { service } = mkService(store);
        await expect(
            service.voidOutbound('CK26091301', { expectedVersion: 1, reason: '数量有误' }, actor, ID_KEY),
        ).rejects.toThrow(new ConflictException('只有未打印的出库单可以由仓管作废'));

        store.shipments[0] = mkShipment();
        store.ledgers.push({
            id: 810n,
            eventNo: 'CK26091301-E1',
            shipmentId: 600n,
            entryType: 'NORMAL',
            correctionOfId: null,
            qtyDelta: 200,
            businessDate: new Date(),
            operatorId: 1n,
            remark: '',
            correctionReason: null,
            requestKey: 'req-e1',
            createdAt: new Date(),
        });
        const voided = await service.voidOutbound(
            'CK26091301',
            { expectedVersion: 1, reason: '数量有误' },
            actor,
            ID_KEY,
        );
        expect(voided).toMatchObject({ state: 'voided', version: 2, voidReason: '数量有误' });
        expect(store.ledgers[1]).toMatchObject({
            entryType: 'CORRECTION',
            correctionOfId: 810n,
            qtyDelta: -200,
            correctionReason: '数量有误',
        });
        expect(store.stateLogs.at(-1)).toMatchObject({ eventType: 'VOID_PRE_PRINT' });
    });

    it('紧急撤销仅 PRINTED；flags 必须确认', async () => {
        const store = emptyStore();
        store.shipments.push(mkShipment({ state: 'REGISTERED', rowVersion: 3n }));
        const { service } = mkService(store);
        await expect(
            service.emergencyVoidOutbound(
                'CK26091301',
                { expectedVersion: 3, reason: '叫停', goodsNotDeparted: true, paperInvalidated: true },
                actor,
                ID_KEY,
            ),
        ).rejects.toThrow(new ConflictException('只有已打印出库单需要紧急撤销'));

        store.shipments[0] = mkShipment({ state: 'PRINTED', rowVersion: 3n });
        await expect(
            service.emergencyVoidOutbound(
                'CK26091301',
                { expectedVersion: 3, reason: '叫停', goodsNotDeparted: false, paperInvalidated: true },
                actor,
                ID_KEY,
            ),
        ).rejects.toThrow(new ConflictException('必须确认货物尚未离开且纸质单已作废'));
    });
});

describe('OutboundService.printOutbound', () => {
    it('首次打印：文档快照含订单冻结规格摘要，打印日志哈希 32 字节，版本推进', async () => {
        const store = emptyStore();
        store.shipments.push(mkShipment());
        const { service } = mkService(store);
        const result = await service.printOutbound('CK26091301', { expectedVersion: 1 }, actor, ID_KEY);
        expect(result.printVersion).toBe(1);
        expect(result.outbound).toMatchObject({ state: 'printed', version: 2, printVersion: 1 });
        expect(result.document).toMatchObject({
            no: 'CK26091301',
            orderNo: 'ZM260913001',
            customer: '深圳市智造电子',
            bomSpec: 'E2E-KW2 · 额定电压 250V',
            qty: 200,
            operator: '郭均',
            printedBy: '郭均',
        });
        expect(result.document.printedAt).toBeDefined();
        expect(store.printLogs).toHaveLength(1);
        const printLog = store.printLogs[0] as { documentHash: Uint8Array };
        expect(Buffer.from(printLog.documentHash)).toHaveLength(32);
        expect(store.stateLogs.at(-1)).toMatchObject({ eventType: 'PRINT', afterVersion: 2n });
    });

    it('已作废不能打印；重打必须填写原因；重打推进打印版本', async () => {
        const store = emptyStore();
        store.shipments.push(mkShipment({ state: 'VOIDED', rowVersion: 2n }));
        const { service } = mkService(store);
        await expect(service.printOutbound('CK26091301', { expectedVersion: 2 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException('已作废出库单不能打印'),
        );

        store.shipments[0] = mkShipment({ state: 'PRINTED', rowVersion: 2n, printLogs: [{ printSeq: 1 }] });
        await expect(service.printOutbound('CK26091301', { expectedVersion: 2 }, actor, ID_KEY)).rejects.toThrow(
            new BadRequestException('重打必须填写原因'),
        );

        const reprint = await service.printOutbound(
            'CK26091301',
            { expectedVersion: 2, reason: '纸质单遗失' },
            actor,
            ID_KEY,
        );
        expect(reprint.printVersion).toBe(2);
        expect(reprint.outbound).toMatchObject({ state: 'printed', version: 3, printVersion: 2 });
        expect(store.stateLogs.at(-1)).toMatchObject({ eventType: 'REPRINT' });
    });

    it('订单已取消时禁止首次打印（已打印出库不受影响，可说明原因重打）', async () => {
        const store = emptyStore();
        store.shipments.push(mkShipment({ order: mkOrder({ lifecycleStatus: 'CANCELLED' }) }));
        const { service } = mkService(store);
        await expect(service.printOutbound('CK26091301', { expectedVersion: 1 }, actor, ID_KEY)).rejects.toThrow(
            new ConflictException('订单已取消，不能首次打印出库单'),
        );

        store.shipments[0] = mkShipment({
            state: 'PRINTED',
            rowVersion: 2n,
            printLogs: [{ printSeq: 1 }],
            order: mkOrder({ lifecycleStatus: 'CANCELLED' }),
        });
        const reprint = await service.printOutbound(
            'CK26091301',
            { expectedVersion: 2, reason: '取消后补打留档' },
            actor,
            ID_KEY,
        );
        expect(reprint.printVersion).toBe(2);
    });
});

describe('OutboundService.listOutbound', () => {
    it('printVersion 按打印日志派生；remark 取正向事件；作废原因仅 voided 返回', async () => {
        const store = emptyStore();
        store.shipments.push(
            mkShipment(),
            mkShipment({
                id: 601n,
                shipmentNo: 'CK26091302',
                state: 'PRINTED',
                rowVersion: 2n,
                printLogs: [{ printSeq: 1 }, { printSeq: 2 }],
            }),
            mkShipment({
                id: 602n,
                shipmentNo: 'CK26091303',
                state: 'VOIDED',
                rowVersion: 2n,
                voidReason: '登记错误',
            }),
        );
        const { service } = mkService(store);
        const list = await service.listOutbound();
        expect(list).toHaveLength(3);
        expect(list[0]).toMatchObject({ no: 'CK26091301', state: 'registered', printVersion: 0, remark: '首次发货' });
        expect(list[0]).not.toHaveProperty('voidReason');
        expect(list[1]).toMatchObject({ no: 'CK26091302', state: 'printed', printVersion: 2 });
        expect(list[2]).toMatchObject({ no: 'CK26091303', state: 'voided', voidReason: '登记错误' });
    });
});

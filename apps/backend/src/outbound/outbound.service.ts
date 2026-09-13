import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionRunner } from '../prisma/transaction.runner';
import type { Tx } from '../prisma/transaction.runner';
import { SnowflakeGenerator } from '../common/snowflake';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { formatDateColumn, formatBeijingStamp, toDateColumn } from '../common/datetime';
import { parseCategoryFields, specSummaryOf } from '../common/bom-display';
import { lockRowsById } from '../domain/concurrency';
import { computeShippableQty } from '../domain/inventory';
import { recordOpLog } from '../domain/op-log';
import { BusinessSequenceService } from '../sequence/business-sequence.service';
import type { AuthUser } from '../common/types/auth-user';
import type { OutboundShipment } from '../generated/prisma/client';
import type { OutboundPrintDocument, OutboundPrintResult, OutboundRow } from './types';
import type { CreateOutboundDto } from './dto/create-outbound.dto';

/** api_idempotency 的 operation_key，与前端 mock 同粒度 */
const CREATE_OPERATION_KEY = 'outbound:create';
const voidOperationKeyOf = (no: string): string => `outbound:void:${no}`;
const printOperationKeyOf = (no: string): string => `outbound:print:${no}`;
const emergencyVoidOperationKeyOf = (no: string): string => `outbound:emergency-void:${no}`;

/** 单头 + 响应映射与打印快照必需的关联（规格摘要用订单快照 + 品类字段序生成） */
type ShipmentRow = OutboundShipment & {
    order: {
        orderNo: string;
        lifecycleStatus: string;
        customerNameSnapshot: string;
        bomModelSnapshot: string;
        bomSpecSnapshot: Prisma.JsonValue;
        customer: { customerCode: string };
        bom: { bomCode: string; category: { specSchema: Prisma.JsonValue } };
    };
    registrar: { name: string };
    ledgers: Array<{ entryType: string; remark: string }>;
    printLogs: Array<{ printSeq: number }>;
};

const SHIPMENT_INCLUDE = {
    order: {
        select: {
            orderNo: true,
            lifecycleStatus: true,
            customerNameSnapshot: true,
            bomModelSnapshot: true,
            bomSpecSnapshot: true,
            customer: { select: { customerCode: true } },
            bom: { select: { bomCode: true, category: { select: { specSchema: true } } } },
        },
    },
    registrar: { select: { name: true } },
    ledgers: { select: { entryType: true, remark: true } },
    printLogs: { select: { printSeq: true } },
} satisfies Prisma.OutboundShipmentInclude;

@Injectable()
export class OutboundService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly snowflake: SnowflakeGenerator,
        private readonly txRunner: TransactionRunner,
        private readonly idempotency: IdempotencyService,
        private readonly sequence: BusinessSequenceService,
    ) {}

    /** 出库单列表（契约 outbound:view）：返回 registered/printed/voided 单头，新单在前 */
    async listOutbound(): Promise<OutboundRow[]> {
        const rows = await this.prisma.outboundShipment.findMany({
            orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }],
            include: SHIPMENT_INCLUDE,
        });
        return rows.map(row => this.toOutboundRow(row));
    }

    /**
     * 登记发货（契约 outbound:ship，幂等）：事务锁 BOM 与订单并按 §6.2 重算可发量
     * （活动订单按交货日期升序共享库存池，超额 409）；创建 REGISTERED 单头与
     * 正向数量事件，库存与订单累计已发立即生效；同事务写 op_log。
     */
    async createOutbound(
        dto: CreateOutboundDto,
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<OutboundRow> {
        const key = this.idempotency.requireKey(idempotencyKey);
        const requestHash = this.idempotency.digest({ method: 'POST', body: dto });

        return this.txRunner.run(async (tx: Tx) => {
            const { replay, placeholderId } = await this.idempotency.beginOrReplay(tx, {
                actorId: BigInt(actor.id),
                operationKey: CREATE_OPERATION_KEY,
                key,
                requestHash,
            });
            if (replay) {
                return replay.body as unknown as OutboundRow;
            }
            if (placeholderId === null) {
                throw new Error('幂等占位缺失');
            }

            const located = await tx.salesOrderTable.findUnique({
                where: { orderNo: dto.orderNo },
                select: { id: true, bomId: true },
            });
            if (!located) {
                throw new NotFoundException('订单不存在');
            }
            // 锁序（db-scheme.md §2）：BOM → 订单；订单 BOM 引用不可变，定位读与锁定间无竞争
            await lockRowsById(tx, 'bom_table', [located.bomId]);
            await tx.$queryRaw`SELECT id FROM sales_order_table WHERE order_no = ${dto.orderNo} FOR UPDATE`;
            const order = await tx.salesOrderTable.findUnique({ where: { orderNo: dto.orderNo } });
            if (!order) {
                throw new NotFoundException('订单不存在');
            }
            if (order.lifecycleStatus === 'CANCELLED') {
                throw new ConflictException('订单已取消，不能登记发货');
            }

            // 可发量在 BOM+订单锁内重算，不信任任何前端传入的库存/已发数据
            await computeShippableQty(tx, {
                bomId: located.bomId,
                targetOrderId: located.id,
                requestedQty: dto.qty,
            });

            const now = new Date();
            const businessDate = toDateColumn(dto.date);
            const shipmentId = this.snowflake.next();
            const shipmentNo = await this.sequence.nextCode(tx, 'outbound', dto.date);
            await tx.outboundShipment.create({
                data: {
                    id: shipmentId,
                    shipmentNo,
                    orderId: order.id,
                    originalQty: dto.qty,
                    businessDate,
                    state: 'REGISTERED',
                    requestKey: this.idempotency.requestKey(BigInt(actor.id), CREATE_OPERATION_KEY, key),
                    registeredBy: BigInt(actor.id),
                    registeredAt: now,
                    updatedAt: now,
                },
            });
            await tx.outboundLedger.create({
                data: {
                    id: this.snowflake.next(),
                    eventNo: `${shipmentNo}-E1`,
                    shipmentId,
                    entryType: 'NORMAL',
                    qtyDelta: dto.qty,
                    businessDate,
                    operatorId: BigInt(actor.id),
                    remark: dto.remark,
                    requestKey: this.idempotency.requestKey(BigInt(actor.id), `${CREATE_OPERATION_KEY}:event`, key),
                    createdAt: now,
                },
            });
            await tx.outboundStateLog.create({
                data: {
                    id: this.snowflake.next(),
                    shipmentId,
                    operatorId: BigInt(actor.id),
                    eventType: 'REGISTER',
                    beforeState: null,
                    afterState: 'REGISTERED',
                    beforeVersion: null,
                    afterVersion: 1n,
                    reason: '',
                    requestKey: this.idempotency.requestKey(BigInt(actor.id), `${CREATE_OPERATION_KEY}:state`, key),
                    detailJson: { qty: dto.qty, orderNo: order.orderNo },
                    createdAt: now,
                },
            });
            await recordOpLog(tx, this.snowflake, actor, {
                action: 'ship',
                targetType: 'outbound',
                targetId: shipmentId,
                targetCode: shipmentNo,
                detail: { orderNo: order.orderNo, qty: dto.qty },
                now,
            });

            const row = await tx.outboundShipment.findUnique({ where: { id: shipmentId }, include: SHIPMENT_INCLUDE });
            const outbound = this.toOutboundRow(row!);
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                responseBody: outbound as unknown as Prisma.InputJsonValue,
                resource: { type: 'outbound', code: shipmentNo },
            });
            return outbound;
        });
    }

    /**
     * 作废未打印出库（契约 outbound:void，幂等）：仅 REGISTERED 可作废；追加等额
     * 负向冲销流水（引用原正向事件，原事件永不改删）并将单头置 VOIDED/PRE_PRINT，
     * 库存与订单已发量随之恢复。
     */
    async voidOutbound(
        shipmentNo: string,
        dto: { expectedVersion: number; reason: string },
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<OutboundRow> {
        const operationKey = voidOperationKeyOf(shipmentNo);
        const key = this.idempotency.requireKey(idempotencyKey);
        const requestHash = this.idempotency.digest({ method: 'POST', pathParams: { shipmentNo }, body: dto });

        return this.txRunner.run(async (tx: Tx) => {
            const { replay, placeholderId } = await this.idempotency.beginOrReplay(tx, {
                actorId: BigInt(actor.id),
                operationKey,
                key,
                requestHash,
            });
            if (replay) {
                return replay.body as unknown as OutboundRow;
            }
            if (placeholderId === null) {
                throw new Error('幂等占位缺失');
            }

            const now = new Date();
            const current = await this.lockShipmentForWrite(tx, shipmentNo);
            if (current.rowVersion !== BigInt(dto.expectedVersion)) {
                throw new ConflictException('出库单已被其他人处理，请刷新后重试');
            }
            if (current.state !== 'REGISTERED') {
                throw new ConflictException('只有未打印的出库单可以由仓管作废');
            }
            await this.appendCorrection(tx, current, dto.reason, actor, now);

            const updated = await tx.outboundShipment.update({
                where: { id: current.id },
                data: {
                    state: 'VOIDED',
                    voidMode: 'PRE_PRINT',
                    voidedBy: BigInt(actor.id),
                    voidReason: dto.reason,
                    voidedAt: now,
                    rowVersion: { increment: 1 },
                },
            });
            await this.writeStateLog(tx, current, 'VOID_PRE_PRINT', 'REGISTERED', 'VOIDED', updated.rowVersion, {
                reason: dto.reason,
                actor,
                now,
                operationKey,
                key,
            });

            const row = await tx.outboundShipment.findUnique({ where: { id: current.id }, include: SHIPMENT_INCLUDE });
            const outbound = this.toOutboundRow(row!);
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                responseBody: outbound as unknown as Prisma.InputJsonValue,
                resource: { type: 'outbound', code: shipmentNo },
            });
            return outbound;
        });
    }

    /**
     * 正式打印并安排发货（契约 outbound:print，幂等）：打印是系统正式放行点。
     * 首次打印 REGISTERED→PRINTED 且订单未取消；重打生成下一打印版本且必须说明
     * 原因（订单后来取消剩余量不影响历史已打印出库的重打）。写不可变打印日志
     * （版本、文档快照与 SHA-256 哈希），返回与日志完全一致的文档快照。
     */
    async printOutbound(
        shipmentNo: string,
        dto: { expectedVersion: number; reason?: string },
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<OutboundPrintResult> {
        const operationKey = printOperationKeyOf(shipmentNo);
        const key = this.idempotency.requireKey(idempotencyKey);
        const requestHash = this.idempotency.digest({ method: 'POST', pathParams: { shipmentNo }, body: dto });

        return this.txRunner.run(async (tx: Tx) => {
            const { replay, placeholderId } = await this.idempotency.beginOrReplay(tx, {
                actorId: BigInt(actor.id),
                operationKey,
                key,
                requestHash,
            });
            if (replay) {
                return replay.body as unknown as OutboundPrintResult;
            }
            if (placeholderId === null) {
                throw new Error('幂等占位缺失');
            }

            const now = new Date();
            const current = await this.lockShipmentForWrite(tx, shipmentNo);
            if (current.rowVersion !== BigInt(dto.expectedVersion)) {
                throw new ConflictException('出库单已被其他人处理，请刷新后重试');
            }
            if (current.state === 'VOIDED') {
                throw new ConflictException('已作废出库单不能打印');
            }
            if (current.state === 'REGISTERED' && current.order.lifecycleStatus === 'CANCELLED') {
                throw new ConflictException('订单已取消，不能首次打印出库单');
            }
            const reprint = current.state === 'PRINTED';
            if (reprint && !dto.reason) {
                throw new BadRequestException('重打必须填写原因');
            }

            const printVersion = this.printVersionOf(current) + 1;
            // 文档快照源：订单冻结快照 + 品类字段序（不读当前客户/BOM 主数据，防漂移）
            const document: OutboundPrintDocument = {
                no: current.shipmentNo,
                printVersion,
                orderNo: current.order.orderNo,
                customer: current.order.customerNameSnapshot,
                customerCode: current.order.customer.customerCode,
                bomCode: current.order.bom.bomCode,
                bomSpec: specSummaryOf(
                    current.order.bomModelSnapshot,
                    (current.order.bomSpecSnapshot ?? {}) as Record<string, string>,
                    parseCategoryFields(current.order.bom.category.specSchema),
                ),
                qty: current.originalQty,
                date: formatDateColumn(current.businessDate),
                operator: current.registrar.name,
                remark: this.normalRemarkOf(current),
                printedBy: actor.name,
                printedAt: now.toISOString(),
            };
            const documentHash = createHash('sha256').update(JSON.stringify(document), 'utf8').digest();

            await tx.outboundPrintLog.create({
                data: {
                    id: this.snowflake.next(),
                    shipmentId: current.id,
                    printSeq: printVersion,
                    printedBy: BigInt(actor.id),
                    reason: dto.reason ?? '',
                    documentSnapshot: document as unknown as Prisma.InputJsonValue,
                    documentHash,
                    requestKey: this.idempotency.requestKey(BigInt(actor.id), operationKey, key),
                    printedAt: now,
                },
            });
            const updated = await tx.outboundShipment.update({
                where: { id: current.id },
                data: { state: 'PRINTED', rowVersion: { increment: 1 } },
            });
            await this.writeStateLog(
                tx,
                current,
                reprint ? 'REPRINT' : 'PRINT',
                current.state,
                'PRINTED',
                updated.rowVersion,
                {
                    reason: dto.reason ?? '',
                    actor,
                    now,
                    operationKey,
                    key,
                    detail: { printVersion },
                },
            );

            const row = await tx.outboundShipment.findUnique({ where: { id: current.id }, include: SHIPMENT_INCLUDE });
            const result: OutboundPrintResult = {
                outbound: this.toOutboundRow(row!),
                printVersion,
                document,
            };
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                responseBody: result as unknown as Prisma.InputJsonValue,
                resource: { type: 'outbound', code: shipmentNo },
            });
            return result;
        });
    }

    /**
     * 紧急撤销已打印出库（受保护权限 outbound:emergency-void，幂等）：必须确认
     * 货物尚未离开且纸质单已作废；追加负向冲销、单头置 VOIDED/EMERGENCY。
     * 货物已离开后只能走销售退货，原出库事实永久保留。
     */
    async emergencyVoidOutbound(
        shipmentNo: string,
        dto: { expectedVersion: number; reason: string; goodsNotDeparted: boolean; paperInvalidated: boolean },
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<OutboundRow> {
        const operationKey = emergencyVoidOperationKeyOf(shipmentNo);
        const key = this.idempotency.requireKey(idempotencyKey);
        const requestHash = this.idempotency.digest({ method: 'POST', pathParams: { shipmentNo }, body: dto });

        return this.txRunner.run(async (tx: Tx) => {
            const { replay, placeholderId } = await this.idempotency.beginOrReplay(tx, {
                actorId: BigInt(actor.id),
                operationKey,
                key,
                requestHash,
            });
            if (replay) {
                return replay.body as unknown as OutboundRow;
            }
            if (placeholderId === null) {
                throw new Error('幂等占位缺失');
            }

            const now = new Date();
            const current = await this.lockShipmentForWrite(tx, shipmentNo);
            if (current.rowVersion !== BigInt(dto.expectedVersion)) {
                throw new ConflictException('出库单已被其他人处理，请刷新后重试');
            }
            if (current.state !== 'PRINTED') {
                throw new ConflictException('只有已打印出库单需要紧急撤销');
            }
            if (!dto.goodsNotDeparted || !dto.paperInvalidated) {
                throw new ConflictException('必须确认货物尚未离开且纸质单已作废');
            }
            await this.appendCorrection(tx, current, dto.reason, actor, now);

            const updated = await tx.outboundShipment.update({
                where: { id: current.id },
                data: {
                    state: 'VOIDED',
                    voidMode: 'EMERGENCY',
                    voidedBy: BigInt(actor.id),
                    voidReason: dto.reason,
                    goodsNotDeparted: true,
                    paperInvalidated: true,
                    voidedAt: now,
                    rowVersion: { increment: 1 },
                },
            });
            await this.writeStateLog(tx, current, 'VOID_EMERGENCY', 'PRINTED', 'VOIDED', updated.rowVersion, {
                reason: dto.reason,
                actor,
                now,
                operationKey,
                key,
                detail: { goodsNotDeparted: true, paperInvalidated: true },
            });

            const row = await tx.outboundShipment.findUnique({ where: { id: current.id }, include: SHIPMENT_INCLUDE });
            const outbound = this.toOutboundRow(row!);
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                responseBody: outbound as unknown as Prisma.InputJsonValue,
                resource: { type: 'outbound', code: shipmentNo },
            });
            return outbound;
        });
    }

    /** 追加等额负向冲销流水（引用原正向事件；原事件永不更新或删除） */
    private async appendCorrection(
        tx: Tx,
        shipment: ShipmentRow,
        reason: string,
        actor: AuthUser,
        now: Date,
    ): Promise<void> {
        const normal = await tx.outboundLedger.findFirst({
            where: { shipmentId: shipment.id, entryType: 'NORMAL' },
            orderBy: { id: 'asc' },
        });
        if (!normal) {
            throw new Error(`出库单 ${shipment.shipmentNo} 缺少正向数量事件`);
        }
        await tx.outboundLedger.create({
            data: {
                id: this.snowflake.next(),
                eventNo: `${shipment.shipmentNo}-E2`,
                shipmentId: shipment.id,
                entryType: 'CORRECTION',
                correctionOfId: normal.id,
                qtyDelta: -shipment.originalQty,
                businessDate: shipment.businessDate,
                operatorId: BigInt(actor.id),
                correctionReason: reason,
                requestKey: this.idempotency.requestKey(
                    BigInt(actor.id),
                    `outbound:correction:${shipment.shipmentNo}`,
                    `correction-${now.getTime()}`,
                ),
                createdAt: now,
            },
        });
    }

    /**
     * 按契约锁序锁定单头（db-scheme.md §2/§7.4）：BOM → 订单 → 出库单头。
     * 先无锁读定位 orderId/bomId，再按固定顺序锁定，锁定读返回最新已提交行。
     */
    private async lockShipmentForWrite(tx: Tx, shipmentNo: string): Promise<ShipmentRow> {
        const located = await tx.outboundShipment.findUnique({
            where: { shipmentNo },
            select: { orderId: true },
        });
        if (!located) {
            throw new NotFoundException('出库单不存在');
        }
        const order = await tx.salesOrderTable.findUnique({
            where: { id: located.orderId },
            select: { bomId: true },
        });
        await lockRowsById(tx, 'bom_table', [order!.bomId]);
        await tx.$queryRaw`SELECT id FROM sales_order_table WHERE id = ${located.orderId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM outbound_shipment WHERE shipment_no = ${shipmentNo} FOR UPDATE`;
        const row = await tx.outboundShipment.findUnique({ where: { shipmentNo }, include: SHIPMENT_INCLUDE });
        if (!row) {
            throw new NotFoundException('出库单不存在');
        }
        return row;
    }

    /** 状态机日志（不可变）：before/after 状态与版本同事务落库 */
    private async writeStateLog(
        tx: Tx,
        current: ShipmentRow,
        eventType: 'VOID_PRE_PRINT' | 'PRINT' | 'REPRINT' | 'VOID_EMERGENCY',
        beforeState: string,
        afterState: 'REGISTERED' | 'PRINTED' | 'VOIDED',
        afterVersion: bigint,
        params: {
            reason: string;
            actor: AuthUser;
            now: Date;
            operationKey: string;
            key: string;
            detail?: Record<string, unknown>;
        },
    ): Promise<void> {
        await tx.outboundStateLog.create({
            data: {
                id: this.snowflake.next(),
                shipmentId: current.id,
                operatorId: BigInt(params.actor.id),
                eventType,
                beforeState: beforeState as ShipmentRow['state'],
                afterState,
                beforeVersion: current.rowVersion,
                afterVersion,
                reason: params.reason,
                requestKey: this.idempotency.requestKey(BigInt(params.actor.id), params.operationKey, params.key),
                detailJson: (params.detail ?? {}) as Prisma.InputJsonValue,
                createdAt: params.now,
            },
        });
    }

    /** 当前打印版本（0 表示未打印；展示层推导 SUPERSEDED 不回写日志） */
    private printVersionOf(row: ShipmentRow): number {
        return row.printLogs.reduce((max, log) => Math.max(max, log.printSeq), 0);
    }

    /** 单头备注取正向数量事件的备注（数量事件不可变，随单头展示） */
    private normalRemarkOf(row: ShipmentRow): string {
        return row.ledgers.find(event => event.entryType === 'NORMAL')?.remark ?? '';
    }

    /** 契约 OutboundRow 映射：customer 为下单时快照；state/printVersion/voidReason 按单头与日志派生 */
    private toOutboundRow(row: ShipmentRow): OutboundRow {
        const voided = row.state === 'VOIDED';
        return {
            no: row.shipmentNo,
            orderNo: row.order.orderNo,
            customer: row.order.customerNameSnapshot,
            customerCode: row.order.customer.customerCode,
            bomCode: row.order.bom.bomCode,
            qty: row.originalQty,
            date: formatDateColumn(row.businessDate),
            time: formatBeijingStamp(row.registeredAt),
            operator: row.registrar.name,
            remark: this.normalRemarkOf(row),
            state: row.state === 'REGISTERED' ? 'registered' : row.state === 'PRINTED' ? 'printed' : 'voided',
            version: Number(row.rowVersion),
            printVersion: this.printVersionOf(row),
            ...(voided ? { voidReason: row.voidReason ?? '' } : {}),
        };
    }
}

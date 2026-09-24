import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import type { Tx } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { formatDateColumn, formatBeijingStamp, toDateColumn } from "../common/datetime";
import { bomSpecOf } from "../common/bom-display";
import { lockRowsById } from "../domain/concurrency";
import { computeShippableQty } from "../domain/inventory";
import { recordOpLog } from "../domain/op-log";
import { BusinessSequenceService } from "../sequence/business-sequence.service";
import type { AuthUser } from "../common/types/auth-user";
import type { OutboundShipment } from "../generated/prisma/client";
import type { OutboundPrintDocument, OutboundRow } from "./types";
import type { CreateOutboundDto } from "./dto/create-outbound.dto";
import type { DeleteOutboundDto } from "./dto/delete-outbound.dto";

/** api_idempotency 的 operation_key，与前端 mock 同粒度 */
const CREATE_OPERATION_KEY = "outbound:create";
const voidOperationKeyOf = (no: string): string => `outbound:void:${no}`;
const deleteOperationKeyOf = (no: string): string => `outbound:delete:${no}`;

/** 单头 + 响应映射与打印文档必需的关联（规格摘要取订单冻结快照，不读目录） */
type ShipmentRow = OutboundShipment & {
    order: {
        orderNo: string;
        lifecycleStatus: string;
        customerNameSnapshot: string;
        bomSpecSnapshot: Prisma.JsonValue;
        customer: { customerCode: string };
        bom: { bomCode: string };
    };
    registrar: { name: string };
    ledgers: Array<{ entryType: string; remark: string }>;
};

const SHIPMENT_INCLUDE = {
    order: {
        select: {
            orderNo: true,
            lifecycleStatus: true,
            customerNameSnapshot: true,
            bomSpecSnapshot: true,
            customer: { select: { customerCode: true } },
            bom: { select: { bomCode: true } },
        },
    },
    registrar: { select: { name: true } },
    ledgers: { select: { entryType: true, remark: true } },
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

    /** 出库单列表（契约 outbound:view）：返回 registered/voided 单头，已删除行不返回，新单在前 */
    async listOutbound(): Promise<OutboundRow[]> {
        const rows = await this.prisma.outboundShipment.findMany({
            where: { deletedAt: null },
            orderBy: [{ registeredAt: "desc" }, { id: "desc" }],
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
        const requestHash = this.idempotency.digest({ method: "POST", body: dto });

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
                throw new Error("幂等占位缺失");
            }

            const located = await tx.salesOrderTable.findUnique({
                where: { orderNo: dto.orderNo },
                select: { id: true, bomId: true },
            });
            if (!located) {
                throw new NotFoundException("订单不存在");
            }
            // 锁序（db-scheme.md §2）：BOM → 订单；订单 BOM 引用不可变，定位读与锁定间无竞争
            await lockRowsById(tx, "bom_table", [located.bomId]);
            await tx.$queryRaw`SELECT id FROM sales_order_table WHERE order_no = ${dto.orderNo} FOR UPDATE`;
            const order = await tx.salesOrderTable.findUnique({ where: { orderNo: dto.orderNo } });
            if (!order) {
                throw new NotFoundException("订单不存在");
            }
            if (order.deletedAt !== null) {
                throw new NotFoundException("订单不存在");
            }
            if (order.lifecycleStatus === "CANCELLED") {
                throw new ConflictException("订单已取消，不能登记发货");
            }
            if (order.lifecycleStatus === "ARCHIVED") {
                throw new ConflictException("订单已归档，不能登记发货");
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
            const shipmentNo = await this.sequence.nextCode(tx, "outbound", dto.date);
            await tx.outboundShipment.create({
                data: {
                    id: shipmentId,
                    shipmentNo,
                    orderId: order.id,
                    originalQty: dto.qty,
                    businessDate,
                    state: "REGISTERED",
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
                    entryType: "NORMAL",
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
                    eventType: "REGISTER",
                    beforeState: null,
                    afterState: "REGISTERED",
                    beforeVersion: null,
                    afterVersion: 1n,
                    reason: "",
                    requestKey: this.idempotency.requestKey(BigInt(actor.id), `${CREATE_OPERATION_KEY}:state`, key),
                    detailJson: { qty: dto.qty, orderNo: order.orderNo },
                    createdAt: now,
                },
            });
            await recordOpLog(tx, this.snowflake, actor, {
                action: "ship",
                targetType: "outbound",
                targetId: shipmentId,
                targetCode: shipmentNo,
                detail: { orderNo: order.orderNo, qty: dto.qty, remark: dto.remark },
                now,
            });

            const row = await tx.outboundShipment.findUnique({ where: { id: shipmentId }, include: SHIPMENT_INCLUDE });
            const outbound = this.toOutboundRow(row!);
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                responseBody: outbound as unknown as Prisma.InputJsonValue,
                resource: { type: "outbound", code: shipmentNo },
            });
            return outbound;
        });
    }

    /**
     * 作废出库（契约 outbound:void，幂等）：仅 REGISTERED 可作废（已作废 409）；追加等额
     * 负向冲销流水（引用原正向事件，原事件永不改删）并将单头置 VOIDED，
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
        const requestHash = this.idempotency.digest({ method: "POST", pathParams: { shipmentNo }, body: dto });

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
                throw new Error("幂等占位缺失");
            }

            const now = new Date();
            const current = await this.lockShipmentForWrite(tx, shipmentNo);
            if (current.rowVersion !== BigInt(dto.expectedVersion)) {
                throw new ConflictException("出库单已被其他人处理，请刷新后重试");
            }
            if (current.state !== "REGISTERED") {
                throw new ConflictException("出库单已作废，不能重复作废");
            }
            // 归档单的出库记录是终态审计依据（已发口径随归档冻结），不可作废回退
            await this.assertOrderNotArchived(tx, current, "不可作废");
            await this.appendCorrection(tx, current, dto.reason, actor, now);

            const updated = await tx.outboundShipment.update({
                where: { id: current.id },
                data: {
                    state: "VOIDED",
                    voidedBy: BigInt(actor.id),
                    voidReason: dto.reason,
                    voidedAt: now,
                    rowVersion: { increment: 1 },
                },
            });
            await this.writeStateLog(tx, current, updated.rowVersion, {
                reason: dto.reason,
                actor,
                now,
                operationKey,
                key,
            });
            await recordOpLog(tx, this.snowflake, actor, {
                action: "void_outbound",
                targetType: "outbound",
                targetId: current.id,
                targetCode: shipmentNo,
                detail: { ...this.shipmentSnapshot(current), reason: dto.reason },
                now,
            });

            const row = await tx.outboundShipment.findUnique({ where: { id: current.id }, include: SHIPMENT_INCLUDE });
            const outbound = this.toOutboundRow(row!);
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                responseBody: outbound as unknown as Prisma.InputJsonValue,
                resource: { type: "outbound", code: shipmentNo },
            });
            return outbound;
        });
    }

    /**
     * 删除已作废的出库单（契约 outbound:delete，幂等）：软删除——单头打 deleted_at
     * 标记，列表不再返回；7 天后悔期后由 maintenance 定时物理清理（连带状态日志与
     * NORMAL+CORRECTION 数量流水同删，零和冲销对不改变任何统计）。仅 VOIDED 可删
     * （作废时已追加冲销、订单已发量已恢复）；不写状态日志、不递增 rowVersion——
     * 删除是可见性管理非业务变更；op_log 记 delete_outbound 与删除前快照（含作废
     * 原因，物理清理后审计仍可独立还原）。
     */
    async deleteOutbound(
        shipmentNo: string,
        dto: DeleteOutboundDto,
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<null> {
        const operationKey = deleteOperationKeyOf(shipmentNo);
        const key = this.idempotency.requireKey(idempotencyKey);
        const requestHash = this.idempotency.digest({ method: "POST", pathParams: { shipmentNo }, body: dto });

        return this.txRunner.run(async (tx: Tx) => {
            const { replay, placeholderId } = await this.idempotency.beginOrReplay(tx, {
                actorId: BigInt(actor.id),
                operationKey,
                key,
                requestHash,
            });
            // 删除的契约响应恒为 data:null，重放无需读快照，直接归一返回
            if (replay) {
                return null;
            }
            if (placeholderId === null) {
                throw new Error("幂等占位缺失");
            }

            const now = new Date();
            const current = await this.lockShipmentForWrite(tx, shipmentNo);
            if (current.rowVersion !== BigInt(dto.expectedVersion)) {
                throw new ConflictException("出库单已被其他人处理，请刷新后重试");
            }
            if (current.state !== "VOIDED") {
                throw new ConflictException("仅已作废的出库单可删除，请先作废");
            }
            if (current.deletedAt !== null) {
                throw new ConflictException("该出库单已删除");
            }
            // 含归档前已作废的单：删除后 7 天物理清理会断归档审计链，一律保留
            await this.assertOrderNotArchived(tx, current, "不可删除");

            await tx.outboundShipment.update({
                where: { id: current.id },
                data: { deletedAt: now },
            });
            await recordOpLog(tx, this.snowflake, actor, {
                action: "delete_outbound",
                targetType: "outbound",
                targetId: current.id,
                targetCode: shipmentNo,
                detail: {
                    ...this.shipmentSnapshot(current),
                    voidReason: current.voidReason,
                    deletedBy: actor.name,
                },
                now,
            });
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                responseBody: { deleted: true, shipmentNo },
                resource: { type: "outbound", code: shipmentNo },
            });
            return null;
        });
    }

    /** 单头业务快照：物理清理数量流水后仍能独立还原出库内容 */
    private shipmentSnapshot(row: ShipmentRow) {
        return {
            no: row.shipmentNo,
            orderNo: row.order.orderNo,
            customer: row.order.customerNameSnapshot,
            customerCode: row.order.customer.customerCode,
            bomCode: row.order.bom.bomCode,
            qty: row.originalQty,
            date: formatDateColumn(row.businessDate),
            registeredAt: row.registeredAt.toISOString(),
            registeredBy: row.registrar.name,
            remark: this.normalRemarkOf(row),
            state: row.state === "VOIDED" ? "voided" : "registered",
            version: Number(row.rowVersion),
        };
    }

    /**
     * 打印出库单文档（契约 outbound:print，纯读）：未删除的任意状态（含已作废）可打、可重复，
     * 实时组装不落日志不改单头状态；printedBy/printedAt 反映本次输出时点。
     * 文档快照源：订单冻结快照（不读当前客户/BOM 主数据与物料目录，防漂移），
     * state/voidReason 来自单头，供打印件渲染作废标注。
     */
    async printOutboundDocument(shipmentNo: string, actor: AuthUser): Promise<OutboundPrintDocument> {
        const current = await this.prisma.outboundShipment.findUnique({
            where: { shipmentNo },
            include: SHIPMENT_INCLUDE,
        });
        if (!current || current.deletedAt !== null) {
            throw new NotFoundException("出库单不存在");
        }
        const voided = current.state === "VOIDED";
        return {
            no: current.shipmentNo,
            orderNo: current.order.orderNo,
            customer: current.order.customerNameSnapshot,
            customerCode: current.order.customer.customerCode,
            bomCode: current.order.bom.bomCode,
            bomSpec: bomSpecOf(current.order.bomSpecSnapshot),
            qty: current.originalQty,
            date: formatDateColumn(current.businessDate),
            operator: current.registrar.name,
            remark: this.normalRemarkOf(current),
            state: voided ? "voided" : "registered",
            ...(voided ? { voidReason: current.voidReason ?? "" } : {}),
            printedBy: actor.name,
            printedAt: new Date().toISOString(),
        };
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
            where: { shipmentId: shipment.id, entryType: "NORMAL" },
            orderBy: { id: "asc" },
        });
        if (!normal) {
            throw new Error(`出库单 ${shipment.shipmentNo} 缺少正向数量事件`);
        }
        await tx.outboundLedger.create({
            data: {
                id: this.snowflake.next(),
                eventNo: `${shipment.shipmentNo}-E2`,
                shipmentId: shipment.id,
                entryType: "CORRECTION",
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
     * 归档订单的出库单守卫：作废/删除都会破坏归档终态——作废会回退已发净额
     * （"已发 3/5"变 0/5），删除在后悔期物理清理后断审计链。调用前订单行已被
     * lockShipmentForWrite 按锁序锁定，此处读到的状态无竞态。
     */
    private async assertOrderNotArchived(tx: Tx, shipment: ShipmentRow, action: string): Promise<void> {
        const order = await tx.salesOrderTable.findUnique({
            where: { id: shipment.orderId },
            select: { lifecycleStatus: true },
        });
        if (order?.lifecycleStatus === "ARCHIVED") {
            throw new ConflictException(`所属订单已归档，出库记录为审计依据，${action}`);
        }
    }

    /**
     * 按契约锁序锁定单头（db-scheme.md §2）：BOM → 订单 → 出库单头。
     * 先无锁读定位 orderId/bomId，再按固定顺序锁定，锁定读返回最新已提交行。
     */
    private async lockShipmentForWrite(tx: Tx, shipmentNo: string): Promise<ShipmentRow> {
        const located = await tx.outboundShipment.findUnique({
            where: { shipmentNo },
            select: { orderId: true },
        });
        if (!located) {
            throw new NotFoundException("出库单不存在");
        }
        const order = await tx.salesOrderTable.findUnique({
            where: { id: located.orderId },
            select: { bomId: true },
        });
        await lockRowsById(tx, "bom_table", [order!.bomId]);
        await tx.$queryRaw`SELECT id FROM sales_order_table WHERE id = ${located.orderId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM outbound_shipment WHERE shipment_no = ${shipmentNo} FOR UPDATE`;
        const row = await tx.outboundShipment.findUnique({ where: { shipmentNo }, include: SHIPMENT_INCLUDE });
        if (!row) {
            throw new NotFoundException("出库单不存在");
        }
        return row;
    }

    /** 作废状态机日志（不可变）：REGISTERED→VOIDED 与版本同事务落库 */
    private async writeStateLog(
        tx: Tx,
        current: ShipmentRow,
        afterVersion: bigint,
        params: {
            reason: string;
            actor: AuthUser;
            now: Date;
            operationKey: string;
            key: string;
        },
    ): Promise<void> {
        await tx.outboundStateLog.create({
            data: {
                id: this.snowflake.next(),
                shipmentId: current.id,
                operatorId: BigInt(params.actor.id),
                eventType: "VOID",
                beforeState: "REGISTERED",
                afterState: "VOIDED",
                beforeVersion: current.rowVersion,
                afterVersion,
                reason: params.reason,
                requestKey: this.idempotency.requestKey(BigInt(params.actor.id), params.operationKey, params.key),
                detailJson: {} as Prisma.InputJsonValue,
                createdAt: params.now,
            },
        });
    }

    /** 单头备注取正向数量事件的备注（数量事件不可变，随单头展示） */
    private normalRemarkOf(row: ShipmentRow): string {
        return row.ledgers.find(event => event.entryType === "NORMAL")?.remark ?? "";
    }

    /** 契约 OutboundRow 映射：customer 为下单时快照；state/voidReason 按单头派生 */
    private toOutboundRow(row: ShipmentRow): OutboundRow {
        const voided = row.state === "VOIDED";
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
            state: voided ? "voided" : "registered",
            version: Number(row.rowVersion),
            ...(voided ? { voidReason: row.voidReason ?? "" } : {}),
        };
    }
}

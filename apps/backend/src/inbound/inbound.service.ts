import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import type { Tx } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { formatDateColumn, formatBeijingStamp, toDateColumn } from "../common/datetime";
import { beijingDayWindow } from "../common/beijing-day";
import { PERMISSIONS } from "../constants";
import type { ExpectedVersionDto } from "../common/dto/expected-version.dto";
import { assertVersionMatches, lockRowForWrite, lockRowsById } from "../domain/concurrency";
import { getStockQty } from "../domain/inventory";
import { recordOpLog } from "../domain/op-log";
import type { EntrySnapshotCore } from "../domain/snapshots";
import { BusinessSequenceService } from "../sequence/business-sequence.service";
import type { AuthUser } from "../common/types/auth-user";
import type { InboundLedger, StockAdjustment } from "../generated/prisma/client";
import type { InboundRow, StockAdjustmentRow } from "./types";
import type { CreateInboundDto } from "./dto/create-inbound.dto";
import type { UpdateInboundDto } from "./dto/update-inbound.dto";
import type { CreateStockAdjustmentDto } from "./dto/create-stock-adjustment.dto";

/** api_idempotency 的 operation_key（按 账号+操作 维度幂等）；作废/删除按单号独立域 */
const CREATE_OPERATION_KEY = "inbound:create";
const ADJUST_OPERATION_KEY = "stock-adjustments:create";
const voidOperationKeyOf = (no: string): string => `inbound:void:${no}`;
const deleteOperationKeyOf = (no: string): string => `inbound:delete:${no}`;

/** 入库行 + 响应映射必需的关联 */
type InboundLedgerRow = InboundLedger & {
    bom: { bomCode: string };
    operator: { name: string };
    updater: { name: string };
};

/** 库存调整行 + 响应映射必需的关联 */
type StockAdjustmentRowModel = StockAdjustment & {
    bom: { bomCode: string };
    operator: { name: string };
    relatedInbound: { entryNo: string } | null;
};

@Injectable()
export class InboundService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly snowflake: SnowflakeGenerator,
        private readonly txRunner: TransactionRunner,
        private readonly idempotency: IdempotencyService,
        private readonly sequence: BusinessSequenceService,
    ) {}

    /** 入库台账（契约 inbound:view）：含 active/voided 便于审计，已删除行不返回，新记录在前 */
    async listInbound(): Promise<InboundRow[]> {
        const rows = await this.prisma.inboundLedger.findMany({
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            include: {
                bom: { select: { bomCode: true } },
                operator: { select: { name: true } },
                updater: { select: { name: true } },
            },
        });
        return rows.map(row => this.toInboundRow(row));
    }

    /**
     * 检验入库登记（契约 inbound:register，幂等）：登记人与时间取服务端上下文；
     * 单号 RK+yyMMdd 按业务日期计数。锁 BOM（库存贡献方）后写入，
     * 与修正/作废/出库登记保持同一锁序防死锁。
     */
    async createInbound(
        dto: CreateInboundDto,
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<InboundRow> {
        return this.idempotency.runGuarded(
            {
                actorId: BigInt(actor.id),
                operationKey: CREATE_OPERATION_KEY,
                idempotencyKey,
                digest: { method: "POST", body: dto },
            },
            async (tx: Tx, { idempotencyKey: key }) => {
                const bom = await this.lockBomByCode(tx, dto.bomCode);
                const now = new Date();
                const entryNo = await this.sequence.nextCode(tx, "inbound", dto.date);
                const created = await tx.inboundLedger.create({
                    data: {
                        id: this.snowflake.next(),
                        entryNo,
                        bomId: bom.id,
                        qty: dto.qty,
                        businessDate: toDateColumn(dto.date),
                        operatorId: BigInt(actor.id),
                        remark: dto.remark,
                        status: "ACTIVE",
                        requestKey: this.idempotency.requestKey(BigInt(actor.id), CREATE_OPERATION_KEY, key),
                        updatedBy: BigInt(actor.id),
                        createdAt: now,
                        updatedAt: now,
                    },
                    include: {
                        bom: { select: { bomCode: true } },
                        operator: { select: { name: true } },
                        updater: { select: { name: true } },
                    },
                });

                const row = this.toInboundRow(created);
                await recordOpLog(tx, this.snowflake, actor, {
                    action: "create_inbound",
                    targetType: "inbound",
                    targetId: created.id,
                    targetCode: entryNo,
                    detail: this.entrySnapshot(created),
                    now,
                });
                return {
                    httpStatus: 200,
                    responseBody: row,
                    resource: { type: "inbound", code: entryNo },
                };
            },
        );
    }

    /**
     * 修正当天录入的入库（契约 inbound:edit）：“当天”按 created_at 的北京自然日
     * 半开窗口判定（db-scheme.md §7.1），不按业务日期——今天补录昨天业务日期
     * 的记录今天仍可纠错。锁序：id 升序锁旧、新 BOM → 入库行；改数量/换 BOM
     * 后任一 BOM 库存非负；原登记人与 created_at 不变；before/after 写不可变日志。
     */
    async updateInbound(entryNo: string, dto: UpdateInboundDto, actor: AuthUser): Promise<InboundRow> {
        return this.txRunner.run(async (tx: Tx) => {
            const now = new Date();
            const { row: current, nextBomId } = await this.lockEntryForWrite(tx, entryNo, dto.bomCode);
            this.assertEditableToday(current, "edit", actor);
            assertVersionMatches(current.rowVersion, dto.expectedVersion, "入库记录已被其他人修改，请刷新后重试");

            if (current.bomId !== nextBomId) {
                // 换 BOM：旧 BOM 失去本条贡献后、新 BOM 并入后都必须保持非负
                const oldStock = await getStockQty(tx, current.bomId);
                if (oldStock - current.qty < 0) {
                    throw new ConflictException("修正后库存将小于 0，请先核对相关出库记录");
                }
            } else if (dto.qty !== current.qty) {
                const stock = await getStockQty(tx, current.bomId);
                if (stock - current.qty + dto.qty < 0) {
                    throw new ConflictException("修正后库存将小于 0，请先核对相关出库记录");
                }
            }

            const updated = await tx.inboundLedger.update({
                where: { id: current.id },
                data: {
                    bomId: nextBomId,
                    qty: dto.qty,
                    businessDate: toDateColumn(dto.date),
                    remark: dto.remark,
                    updatedBy: BigInt(actor.id),
                    rowVersion: { increment: 1 },
                },
                include: {
                    bom: { select: { bomCode: true } },
                    operator: { select: { name: true } },
                    updater: { select: { name: true } },
                },
            });
            await tx.inboundChangeLog.create({
                data: {
                    id: this.snowflake.next(),
                    inboundId: current.id,
                    operatorId: BigInt(actor.id),
                    eventType: "UPDATE",
                    beforeVersion: current.rowVersion,
                    afterVersion: updated.rowVersion,
                    reason: dto.reason,
                    requestKey: null,
                    beforeJson: this.entrySnapshot(current),
                    afterJson: this.entrySnapshot(updated),
                    createdAt: now,
                },
            });
            return this.toInboundRow(updated);
        });
    }

    /**
     * 作废当天录入的入库（契约 inbound:edit，幂等）：非物理删除，作废后不计库存；
     * 作废后该 BOM 库存非负；before/after 写不可变日志（request_key 必填）。
     */
    async voidInbound(
        entryNo: string,
        dto: { expectedVersion: number; reason: string },
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<InboundRow> {
        const operationKey = voidOperationKeyOf(entryNo);
        return this.idempotency.runGuarded(
            {
                actorId: BigInt(actor.id),
                operationKey,
                idempotencyKey,
                digest: { method: "POST", pathParams: { entryNo }, body: dto },
            },
            async (tx: Tx, { idempotencyKey: key }) => {
                const now = new Date();
                const { row: current } = await this.lockEntryForWrite(tx, entryNo);
                this.assertEditableToday(current, "void", actor);
                assertVersionMatches(current.rowVersion, dto.expectedVersion, "入库记录已被其他人修改，请刷新后重试");
                const stock = await getStockQty(tx, current.bomId);
                if (stock - current.qty < 0) {
                    throw new ConflictException(
                        "这笔入库作废后库存不足。请先到「成品出库」处理该成品的有效出库单，或核对库存调整",
                    );
                }

                const updated = await tx.inboundLedger.update({
                    where: { id: current.id },
                    data: {
                        status: "VOIDED",
                        updatedBy: BigInt(actor.id),
                        rowVersion: { increment: 1 },
                    },
                    include: {
                        bom: { select: { bomCode: true } },
                        operator: { select: { name: true } },
                        updater: { select: { name: true } },
                    },
                });
                await tx.inboundChangeLog.create({
                    data: {
                        id: this.snowflake.next(),
                        inboundId: current.id,
                        operatorId: BigInt(actor.id),
                        eventType: "VOID",
                        beforeVersion: current.rowVersion,
                        afterVersion: updated.rowVersion,
                        reason: dto.reason,
                        requestKey: this.idempotency.requestKey(BigInt(actor.id), operationKey, key),
                        beforeJson: this.entrySnapshot(current),
                        afterJson: this.entrySnapshot(updated),
                        createdAt: now,
                    },
                });
                await recordOpLog(tx, this.snowflake, actor, {
                    action: "void_inbound",
                    targetType: "inbound",
                    targetId: current.id,
                    targetCode: entryNo,
                    detail: {
                        before: this.entrySnapshot(current),
                        after: this.entrySnapshot(updated),
                        reason: dto.reason,
                    },
                    now,
                });

                const row = this.toInboundRow(updated);
                return {
                    httpStatus: 200,
                    responseBody: row,
                    resource: { type: "inbound", code: entryNo },
                };
            },
        );
    }

    /**
     * 删除已作废的入库（契约 inbound:delete，幂等）：软删除——行打 deleted_at 标记，
     * 列表不再返回；7 天后悔期后由 maintenance 定时物理清理（连带变更日志同删）。
     * 仅 VOIDED 可删（作废时库存已扣回，直接删 ACTIVE 单会破坏库存）；被库存调整单
     * 引用的单 409（保证物理清理 FK 安全）；不写变更日志、不递增 rowVersion——删除
     * 是可见性管理非业务变更，版本链止于 VOID；op_log 记 delete_inbound 与删除前
     * 快照（含作废原因，物理清理后审计仍可独立还原）。
     */
    async deleteInbound(
        entryNo: string,
        dto: ExpectedVersionDto,
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<null> {
        const operationKey = deleteOperationKeyOf(entryNo);
        // 删除的契约响应恒为 data:null：重放与成功均归一返回 null（runGuardedVoid）
        return this.idempotency.runGuardedVoid(
            {
                actorId: BigInt(actor.id),
                operationKey,
                idempotencyKey,
                digest: { method: "POST", pathParams: { entryNo }, body: dto },
            },
            async (tx: Tx) => {
                const now = new Date();
                const { row: current } = await this.lockEntryForWrite(tx, entryNo);
                assertVersionMatches(current.rowVersion, dto.expectedVersion, "入库记录已被其他人修改，请刷新后重试");
                if (current.status !== "VOIDED") {
                    throw new ConflictException("仅已作废的入库记录可删除，请先作废");
                }
                const adjustmentRefs = await tx.stockAdjustment.count({ where: { relatedInboundId: current.id } });
                if (adjustmentRefs > 0) {
                    throw new ConflictException("存在关联的库存调整单，不可删除");
                }

                await tx.inboundLedger.update({
                    where: { id: current.id },
                    data: { deletedAt: now },
                });
                await recordOpLog(tx, this.snowflake, actor, {
                    action: "delete_inbound",
                    targetType: "inbound",
                    targetId: current.id,
                    targetCode: entryNo,
                    detail: {
                        ...this.entrySnapshot(current),
                        voidReason: await this.lastVoidReasonOf(tx, current.id),
                        deletedBy: actor.name,
                    },
                    now,
                });
                return {
                    httpStatus: 200,
                    responseBody: { deleted: true, entryNo },
                    resource: { type: "inbound", code: entryNo },
                };
            },
        );
    }

    /** 该单最后一条 VOID 变更日志的原因（删除快照冻结作废原因，清理后仍可审计） */
    private async lastVoidReasonOf(tx: Tx, inboundId: bigint): Promise<string | null> {
        const log = await tx.inboundChangeLog.findFirst({
            where: { inboundId, eventType: "VOID" },
            orderBy: { createdAt: "desc" },
            select: { reason: true },
        });
        return log?.reason ?? null;
    }

    /** 不可变库存调整列表（契约 inbound:view） */
    async listStockAdjustments(): Promise<StockAdjustmentRow[]> {
        const rows = await this.prisma.stockAdjustment.findMany({
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            include: {
                bom: { select: { bomCode: true } },
                operator: { select: { name: true } },
                relatedInbound: { select: { entryNo: true } },
            },
        });
        return rows.map(row => this.toAdjustmentRow(row));
    }

    /**
     * 新增跨日库存调整（受保护权限 inbound:adjust，幂等）：历史入库禁止原地修改，
     * 出错只能追加调整单；qty_delta 非零有符号（非零由 DTO 校验），负向调整后
     * 库存不得小于 0；关联原入库单时 BOM 必须一致。
     */
    async createStockAdjustment(
        dto: CreateStockAdjustmentDto,
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<StockAdjustmentRow> {
        return this.idempotency.runGuarded(
            {
                actorId: BigInt(actor.id),
                operationKey: ADJUST_OPERATION_KEY,
                idempotencyKey,
                digest: { method: "POST", body: dto },
            },
            async (tx: Tx, { idempotencyKey: key }) => {
                const bom = await this.lockBomByCode(tx, dto.bomCode);
                let relatedInboundId: bigint | null = null;
                if (dto.relatedInboundNo) {
                    // 已软删除的入库单不可再被新调整单关联——否则清理任务会因引用永久跳过该行
                    const related = await tx.inboundLedger.findFirst({
                        where: { entryNo: dto.relatedInboundNo },
                        select: { id: true, bomId: true },
                    });
                    if (!related) {
                        throw new NotFoundException("关联入库单不存在或已删除");
                    }
                    if (related.bomId !== bom.id) {
                        throw new ConflictException("库存调整与关联入库单的 BOM 必须一致");
                    }
                    relatedInboundId = related.id;
                }
                const stock = await getStockQty(tx, bom.id);
                if (stock + dto.qtyDelta < 0) {
                    throw new ConflictException("调整后库存不能小于 0");
                }

                const now = new Date();
                const adjustmentNo = await this.sequence.nextCode(tx, "adjust", dto.date);
                const created = await tx.stockAdjustment.create({
                    data: {
                        id: this.snowflake.next(),
                        adjustmentNo,
                        bomId: bom.id,
                        qtyDelta: dto.qtyDelta,
                        businessDate: toDateColumn(dto.date),
                        relatedInboundId,
                        operatorId: BigInt(actor.id),
                        reason: dto.reason,
                        requestKey: this.idempotency.requestKey(BigInt(actor.id), ADJUST_OPERATION_KEY, key),
                        createdAt: now,
                    },
                    include: {
                        bom: { select: { bomCode: true } },
                        operator: { select: { name: true } },
                        relatedInbound: { select: { entryNo: true } },
                    },
                });

                const row = this.toAdjustmentRow(created);
                return {
                    httpStatus: 200,
                    responseBody: row,
                    resource: { type: "stock-adjustment", code: adjustmentNo },
                };
            },
        );
    }

    /** 锁定 BOM 行并返回最小行（含 id）；不存在抛 404 */
    private lockBomByCode(tx: Tx, bomCode: string): Promise<{ id: bigint }> {
        return lockRowForWrite(
            tx,
            "bom_table",
            bomCode,
            inner => inner.bomTable.findUnique({ where: { bomCode }, select: { id: true } }),
            "成品不存在",
        );
    }

    /** 编码定位 BOM id（不锁定；调用方应已按锁序持有该 BOM 行锁） */
    private async resolveBomIdByCode(tx: Tx, bomCode: string): Promise<bigint> {
        const bom = await tx.bomTable.findUnique({ where: { bomCode }, select: { id: true } });
        if (!bom) {
            throw new NotFoundException("成品不存在");
        }
        return bom.id;
    }

    /**
     * 按契约锁序锁定入库行（db-scheme.md §2）：id 升序锁修改前后的 BOM，再锁入库行。
     * 先无锁读定位 bomId（修改 BOM 需要新旧两个），BOM 引用漂移不构成竞争
     * （锁定读返回最新已提交行，校验都在锁内完成）。
     */
    private async lockEntryForWrite(
        tx: Tx,
        entryNo: string,
        nextBomCode?: string,
    ): Promise<{ row: InboundLedgerRow; nextBomId: bigint }> {
        const located = await tx.inboundLedger.findUnique({
            where: { entryNo },
            select: { id: true, bomId: true },
        });
        if (!located) {
            throw new NotFoundException("入库记录不存在");
        }
        const nextBomId = nextBomCode ? await this.resolveBomIdByCode(tx, nextBomCode) : located.bomId;
        // id 升序去重由 lockRowsById 统一完成
        await lockRowsById(tx, "bom_table", [located.bomId, nextBomId]);
        const row = await lockRowForWrite(
            tx,
            "inbound_ledger",
            entryNo,
            inner =>
                inner.inboundLedger.findUnique({
                    where: { entryNo },
                    include: {
                        bom: { select: { bomCode: true } },
                        operator: { select: { name: true } },
                        updater: { select: { name: true } },
                    },
                }),
            "入库记录不存在",
        );
        return { row, nextBomId };
    }

    /**
     * 当天窗口与状态校验：created_at 落在北京自然日内才可修正/作废（db-scheme.md §7.1）。
     * 例外：持 inbound:void-any-day（或超管）可作废任意天数的记录——跨天修正仍走库存调整，
     * 不放开；库存非负校验对跨天作废同样生效（数据一致性不得绕过）。
     */
    private assertEditableToday(row: InboundLedgerRow, mode: "edit" | "void", actor: AuthUser): void {
        if (row.status === "VOIDED") {
            throw new ConflictException("已作废入库记录不可再次修改");
        }
        const { start, nextStart } = beijingDayWindow();
        if (row.createdAt >= start && row.createdAt < nextStart) {
            return;
        }
        // 授权分支按 mode 判别而非展示文案：措辞调整不会静默改变权限语义
        const mayCrossDay =
            mode === "void" && (actor.isSuper || actor.permissions.has(PERMISSIONS.INBOUND_VOID_ANY_DAY));
        if (mayCrossDay) {
            return;
        }
        throw new ConflictException(
            mode === "void"
                ? "只能作废北京时间当天录入的入库记录，跨日作废需超级管理员"
                : "只能修正北京时间当天录入的入库记录",
        );
    }

    /** 变更日志快照：行内业务字段（before/after 同构，便于审计比对） */
    private entrySnapshot(row: InboundLedgerRow): EntrySnapshotCore {
        return {
            no: row.entryNo,
            bomCode: row.bom.bomCode,
            qty: row.qty,
            date: formatDateColumn(row.businessDate),
            remark: row.remark,
            status: row.status,
            version: Number(row.rowVersion),
        };
    }

    /** 契约 InboundRow 映射：date 为 DATE 列 yyyy-MM-dd；time 为北京展示戳；修正字段仅改后返回 */
    private toInboundRow(row: InboundLedgerRow): InboundRow {
        const modified = Number(row.rowVersion) > 1;
        return {
            no: row.entryNo,
            bomCode: row.bom.bomCode,
            qty: row.qty,
            date: formatDateColumn(row.businessDate),
            time: formatBeijingStamp(row.createdAt),
            inspector: row.operator.name,
            remark: row.remark,
            status: row.status === "VOIDED" ? "voided" : "active",
            version: Number(row.rowVersion),
            createdAt: row.createdAt.toISOString(),
            ...(modified ? { updatedBy: row.updater.name, updatedAt: row.updatedAt.toISOString() } : {}),
        };
    }

    /** 契约 StockAdjustmentRow 映射 */
    private toAdjustmentRow(row: StockAdjustmentRowModel): StockAdjustmentRow {
        return {
            no: row.adjustmentNo,
            bomCode: row.bom.bomCode,
            qtyDelta: row.qtyDelta,
            date: formatDateColumn(row.businessDate),
            time: formatBeijingStamp(row.createdAt),
            operator: row.operator.name,
            reason: row.reason,
            ...(row.relatedInbound ? { relatedInboundNo: row.relatedInbound.entryNo } : {}),
        };
    }
}

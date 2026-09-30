import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import type { Tx } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { formatDateColumn, toDateColumn } from "../common/datetime";
import { bomItemsSnapshotOf } from "../common/bom-display";
import { lockRowsById } from "../domain/concurrency";
import { recordOpLog } from "../domain/op-log";
import { BusinessSequenceService } from "../sequence/business-sequence.service";
import type { AuthUser } from "../common/types/auth-user";
import type { BomTable, SalesOrderTable } from "../generated/prisma/client";
import type { Order } from "./types";
import type { CreateOrderDto } from "./dto/create-order.dto";
import type { UpdateOrderDto } from "./dto/update-order.dto";
import type { ArchiveOrderDto } from "./dto/archive-order.dto";
import type { DeleteOrderDto } from "./dto/delete-order.dto";

/** api_idempotency 的 operation_key；归档/删除按订单号独立域，与前端 mock 同粒度 */
const CREATE_OPERATION_KEY = "orders:create";
const archiveOperationKeyOf = (orderNo: string): string => `orders:archive:${orderNo}`;
const deleteOperationKeyOf = (orderNo: string): string => `orders:delete:${orderNo}`;

/** 订单行 + 响应映射必需的关联（archiver 仅归档后有值；creator 供审计展示） */
type OrderRow = SalesOrderTable & {
    customer: { customerCode: string };
    bom: { bomCode: string };
    creator: { name: string };
    archiver: { name: string } | null;
};

@Injectable()
export class OrdersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly snowflake: SnowflakeGenerator,
        private readonly txRunner: TransactionRunner,
        private readonly idempotency: IdempotencyService,
        private readonly sequence: BusinessSequenceService,
    ) {}

    /**
     * 销售订单列表（契约 orders:view）：归档订单仍返回用于历史审计，前端
     * 按生命周期分流到归档订单页；outbound 为有效出库净额，经 v_order_outbound_qty
     * 统一聚合口径（db-scheme.md §7.2：无流水的订单不在视图，缺行按 0 理解）。
     */
    async listOrders(): Promise<Order[]> {
        const rows = await this.prisma.salesOrderTable.findMany({
            where: { deletedAt: null },
            orderBy: { orderNo: "asc" },
            include: {
                customer: { select: { customerCode: true } },
                bom: { select: { bomCode: true } },
                creator: { select: { name: true } },
                archiver: { select: { name: true } },
            },
        });
        const outboundRows = await this.prisma.$queryRaw<Array<{ order_id: bigint; outbound_qty: bigint }>>(
            Prisma.sql`SELECT order_id, outbound_qty FROM v_order_outbound_qty`,
        );
        const outboundMap = new Map(outboundRows.map(row => [row.order_id, Number(row.outbound_qty)]));
        return rows.map(row => this.toOrder(row, outboundMap.get(row.id) ?? 0));
    }

    /**
     * 新建销售订单：客户名称与 BOM 快照由服务端查询冻结（db-scheme.md §6.1）；
     * 订单号按 orderDate 每日事务取号。锁序：BOM → 订单（创建时仅 BOM 行锁，
     * 与编辑/出库登记保持同一顺序防死锁）。
     */
    async createOrder(dto: CreateOrderDto, actor: AuthUser, idempotencyKey: string | undefined): Promise<Order> {
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
                return replay.body as unknown as Order;
            }
            if (placeholderId === null) {
                throw new Error("幂等占位缺失");
            }

            const bom = await this.lockBomByCode(tx, dto.bomCode);
            const customer = await tx.customTable.findUnique({ where: { customerCode: dto.customerCode } });
            if (!customer) {
                throw new NotFoundException("客户不存在");
            }
            // BOM 快照冻结（db-scheme.md §6.1）：明细取建档冻结行（position 排序），
            // modelCode/spec 由其派生；下单后目录变更不影响本订单与打印
            const bomSnapshot = bomItemsSnapshotOf(
                await tx.bomItem.findMany({ where: { bomId: bom.id }, orderBy: { position: "asc" } }),
            );

            const now = new Date();
            const id = this.snowflake.next();
            const orderNo = await this.sequence.nextCode(tx, "order", dto.orderDate);
            const created = await tx.salesOrderTable.create({
                data: {
                    id,
                    orderNo,
                    customerId: customer.id,
                    bomId: bom.id,
                    qty: dto.qty,
                    orderDate: toDateColumn(dto.orderDate),
                    deliverDate: toDateColumn(dto.deliverDate),
                    remark: dto.remark,
                    customerNameSnapshot: customer.name,
                    bomNameSnapshot: bom.category.name,
                    bomModelSnapshot: bomSnapshot.modelCode,
                    bomSpecSnapshot: bomSnapshot as unknown as Prisma.InputJsonValue,
                    requestKey: this.idempotency.requestKey(BigInt(actor.id), CREATE_OPERATION_KEY, key),
                    createdBy: BigInt(actor.id),
                    updatedBy: BigInt(actor.id),
                    createdAt: now,
                },
            });
            await tx.salesOrderChangeLog.create({
                data: {
                    id: this.snowflake.next(),
                    orderId: id,
                    operatorId: BigInt(actor.id),
                    eventType: "CREATE",
                    afterVersion: created.rowVersion,
                    createdAt: now,
                    requestKey: this.idempotency.requestKey(BigInt(actor.id), CREATE_OPERATION_KEY, key),
                    afterJson: this.orderSnapshot(created),
                },
            });
            await recordOpLog(tx, this.snowflake, actor, {
                action: "create_order",
                targetType: "order",
                targetId: id,
                targetCode: orderNo,
                // 完整快照对齐 archive_order 写法（系统日志页的创建卡片直接展示）；
                // bomRemark 取 BOM 行建档备注随日志冻结，与 BOM 冻结快照同自足口径
                detail: {
                    ...(this.orderSnapshot(created) as Record<string, unknown>),
                    customer: customer.name,
                    customerCode: customer.customerCode,
                    bomCode: bom.bomCode,
                    bomRemark: bom.remark,
                } as unknown as Prisma.InputJsonValue,
                now,
            });

            const order = this.toOrder(
                {
                    ...created,
                    customer: { customerCode: customer.customerCode },
                    bom: { bomCode: bom.bomCode },
                    creator: { name: actor.name },
                    archiver: null,
                },
                0,
            );
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                responseBody: order as unknown as Prisma.InputJsonValue,
                resource: { type: "order", code: orderNo },
            });
            return order;
        });
    }

    /**
     * 修改销售订单：乐观锁 + 已归档不可改；发过货（有效出库净额 > 0）
     * 的订单数量与交货日期锁定，仅可改备注（db-scheme.md §6.1）。锁序：BOM → 订单。
     */
    async updateOrder(orderNo: string, dto: UpdateOrderDto, actor: AuthUser): Promise<Order> {
        if (dto.qty === undefined && dto.deliverDate === undefined && dto.remark === undefined) {
            throw new BadRequestException("至少修改数量、交货日期或备注之一");
        }
        return this.txRunner.run(async (tx: Tx) => {
            const now = new Date();
            const current = await this.lockOrderForWrite(tx, orderNo);
            if (current.rowVersion !== BigInt(dto.expectedVersion)) {
                throw new ConflictException("订单已被其他人修改，请刷新后重试");
            }
            if (current.lifecycleStatus === "ARCHIVED") {
                throw new ConflictException("订单已归档，不可修改");
            }

            const outbound = await this.outboundNetOf(tx, current.id);
            if (outbound > 0 && (dto.qty !== undefined || dto.deliverDate !== undefined)) {
                throw new ConflictException("订单已有出库记录，数量与交货日期不可修改，仅可修改备注");
            }
            if (dto.qty !== undefined && dto.qty < outbound) {
                throw new ConflictException(`新数量不得小于该订单有效出库净额（当前已发 ${outbound}）`);
            }

            const updated = await tx.salesOrderTable.update({
                where: { id: current.id },
                data: {
                    ...(dto.qty !== undefined ? { qty: dto.qty } : {}),
                    ...(dto.deliverDate !== undefined ? { deliverDate: toDateColumn(dto.deliverDate) } : {}),
                    ...(dto.remark !== undefined ? { remark: dto.remark } : {}),
                    updatedBy: BigInt(actor.id),
                    rowVersion: { increment: 1 },
                },
                include: {
                    customer: { select: { customerCode: true } },
                    bom: { select: { bomCode: true } },
                    creator: { select: { name: true } },
                    archiver: { select: { name: true } },
                },
            });
            await tx.salesOrderChangeLog.create({
                data: {
                    id: this.snowflake.next(),
                    orderId: current.id,
                    operatorId: BigInt(actor.id),
                    eventType: "UPDATE",
                    beforeVersion: current.rowVersion,
                    afterVersion: updated.rowVersion,
                    createdAt: now,
                    reason: "修改销售订单",
                    beforeJson: this.orderSnapshot(current),
                    afterJson: this.orderSnapshot(updated),
                },
            });
            return this.toOrder(updated, outbound);
        });
    }

    /**
     * 归档订单（契约 orders:archive，幂等，仅超级管理员，db-scheme.md §6.1）：
     * 收尾已完成/部分发货的订单，使其退出活跃视图仅供查询。终态不可恢复；
     * 一件未发的订单不可归档——手误订单走删除。存在未作废出库单时直接放行
     * （已发数量保留），归档后其出库单不可作废/删除。归档人/时间/备注（选填）
     * 随行落库供审计，change_log 记 ARCHIVE 事件（操作人与时间），op_log 另记
     * 里程碑快照。
     */
    async archiveOrder(
        orderNo: string,
        dto: ArchiveOrderDto,
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<Order> {
        const operationKey = archiveOperationKeyOf(orderNo);
        const key = this.idempotency.requireKey(idempotencyKey);
        const requestHash = this.idempotency.digest({ method: "POST", pathParams: { orderNo }, body: dto });

        return this.txRunner.run(async (tx: Tx) => {
            const { replay, placeholderId } = await this.idempotency.beginOrReplay(tx, {
                actorId: BigInt(actor.id),
                operationKey,
                key,
                requestHash,
            });
            if (replay) {
                return replay.body as unknown as Order;
            }
            if (placeholderId === null) {
                throw new Error("幂等占位缺失");
            }

            const now = new Date();
            const current = await this.lockOrderForWrite(tx, orderNo);
            if (current.rowVersion !== BigInt(dto.expectedVersion)) {
                throw new ConflictException("订单已被其他人修改，请刷新后重试");
            }
            if (current.lifecycleStatus === "ARCHIVED") {
                throw new ConflictException("订单已归档");
            }
            const outbound = await this.outboundNetOf(tx, current.id);
            if (outbound === 0) {
                // 一件未发不归档：手误的活跃单走删除
                throw new ConflictException("订单尚未发货，无需归档；手误订单请删除");
            }

            const updated = await tx.salesOrderTable.update({
                where: { id: current.id },
                data: {
                    lifecycleStatus: "ARCHIVED",
                    archivedAt: now,
                    archivedBy: BigInt(actor.id),
                    archiveReason: dto.reason?.length ? dto.reason : null,
                    updatedBy: BigInt(actor.id),
                    rowVersion: { increment: 1 },
                },
                include: {
                    customer: { select: { customerCode: true } },
                    bom: { select: { bomCode: true } },
                    creator: { select: { name: true } },
                    archiver: { select: { name: true } },
                },
            });
            await tx.salesOrderChangeLog.create({
                data: {
                    id: this.snowflake.next(),
                    orderId: current.id,
                    operatorId: BigInt(actor.id),
                    eventType: "ARCHIVE",
                    beforeVersion: current.rowVersion,
                    afterVersion: updated.rowVersion,
                    createdAt: now,
                    reason: dto.reason?.length ? dto.reason : "",
                    requestKey: this.idempotency.requestKey(BigInt(actor.id), operationKey, key),
                    beforeJson: this.orderSnapshot(current),
                    afterJson: this.orderSnapshot(updated),
                },
            });
            await recordOpLog(tx, this.snowflake, actor, {
                action: "archive_order",
                targetType: "order",
                targetId: current.id,
                targetCode: current.orderNo,
                detail: {
                    ...(this.orderSnapshot(updated) as Record<string, unknown>),
                    customer: updated.customerNameSnapshot,
                    customerCode: updated.customer.customerCode,
                    bomCode: updated.bom.bomCode,
                    archivedBy: updated.archiver?.name ?? null,
                    // 归档原因入快照：系统日志页 reason 展示依赖 detail（行级无 reason 列）
                    reason: dto.reason?.length ? dto.reason : null,
                } as unknown as Prisma.InputJsonValue,
                now,
            });

            const order = this.toOrder(updated, await this.outboundNetOf(tx, current.id));
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                responseBody: order as unknown as Prisma.InputJsonValue,
                resource: { type: "order", code: orderNo },
            });
            return order;
        });
    }

    /**
     * 删除净发货为零且没有可见出库单的订单：先软删除以保留仍在 7 天后悔期内的
     * 出库单外键，待其物理清理后由维护任务清理订单与变更日志。
     */
    async deleteOrder(
        orderNo: string,
        dto: DeleteOrderDto,
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<null> {
        const operationKey = deleteOperationKeyOf(orderNo);
        const key = this.idempotency.requireKey(idempotencyKey);
        const requestHash = this.idempotency.digest({ method: "POST", pathParams: { orderNo }, body: dto });

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
            const current = await this.lockOrderForWrite(tx, orderNo);
            if (current.rowVersion !== BigInt(dto.expectedVersion)) {
                throw new ConflictException("订单已被其他人修改，请刷新后重试");
            }
            if (current.lifecycleStatus === "ARCHIVED") {
                throw new ConflictException("订单已归档，不可删除");
            }
            const outbound = await this.outboundNetOf(tx, current.id);
            if (outbound > 0) {
                throw new ConflictException("订单已有发货记录，不可删除");
            }
            const shipmentRefs = await tx.outboundShipment.count({
                where: { orderId: current.id, deletedAt: null },
            });
            if (shipmentRefs > 0) {
                throw new ConflictException("请先作废并删除关联出库单，再删除订单");
            }

            await tx.salesOrderTable.update({
                where: { id: current.id },
                data: { deletedAt: now, updatedBy: BigInt(actor.id), updatedAt: now },
            });
            // op_log 快照：行内字段 + 关联编码（客户/BOM），审计可独立还原删除前形态；
            // BOM 行此刻未删（删订单不动 BOM），补读建档备注一并冻结
            const snapshot = this.orderSnapshot(current) as Record<string, unknown>;
            const bomRemark = await tx.bomTable.findUnique({
                where: { id: current.bomId },
                select: { remark: true },
            });
            await recordOpLog(tx, this.snowflake, actor, {
                action: "delete_order",
                targetType: "order",
                targetId: current.id,
                targetCode: current.orderNo,
                detail: {
                    ...snapshot,
                    customer: current.customerNameSnapshot,
                    customerCode: current.customer.customerCode,
                    bomCode: current.bom.bomCode,
                    bomRemark: bomRemark?.remark ?? "",
                    deletedAt: now.toISOString(),
                } as unknown as Prisma.InputJsonValue,
                now,
            });
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                // JSON 列不接受 null 占位；重放路径已归一为 null，此快照仅审计兜底
                responseBody: { deleted: true, orderNo: current.orderNo },
                resource: { type: "order", code: current.orderNo },
            });
            return null;
        });
    }

    /** 订单有效出库净额：v_order_outbound_qty 统一口径，无流水视为 0（db-scheme.md §7.2） */
    private async outboundNetOf(tx: Tx, orderId: bigint): Promise<number> {
        const rows = await tx.$queryRaw<Array<{ outbound_qty: bigint }>>(
            Prisma.sql`SELECT outbound_qty FROM v_order_outbound_qty WHERE order_id = ${orderId}`,
        );
        return rows[0] ? Number(rows[0].outbound_qty) : 0;
    }

    /** 锁定 BOM 行并携带品类（快照名称取品类名）；不存在抛 404 */
    private async lockBomByCode(tx: Tx, bomCode: string): Promise<BomTable & { category: { name: string } }> {
        await tx.$queryRaw`SELECT id FROM bom_table WHERE bom_code = ${bomCode} FOR UPDATE`;
        const bom = await tx.bomTable.findUnique({
            where: { bomCode },
            include: { category: { select: { name: true } } },
        });
        if (!bom) {
            throw new NotFoundException("BOM 不存在");
        }
        return bom;
    }

    /**
     * 按契约锁序锁定订单行（db-scheme.md §2：先 BOM 后订单）。订单的 BOM 引用不可变
     * （编辑不接受换 BOM），先无锁读定位 bomId 再锁 BOM、锁订单，两次读之间 BOM 引用
     * 漂移不构成竞争；READ COMMITTED 下锁定读返回最新已提交行。
     */
    private async lockOrderForWrite(tx: Tx, orderNo: string): Promise<OrderRow> {
        const located = await tx.salesOrderTable.findUnique({
            where: { orderNo },
            select: { id: true, bomId: true },
        });
        if (!located) {
            throw new NotFoundException("订单不存在");
        }
        await lockRowsById(tx, "bom_table", [located.bomId]);
        await tx.$queryRaw`SELECT id FROM sales_order_table WHERE order_no = ${orderNo} FOR UPDATE`;
        const order = await tx.salesOrderTable.findUnique({
            where: { orderNo },
            include: {
                customer: { select: { customerCode: true } },
                bom: { select: { bomCode: true } },
                creator: { select: { name: true } },
                archiver: { select: { name: true } },
            },
        });
        if (!order) {
            throw new NotFoundException("订单不存在");
        }
        if (order.deletedAt !== null) {
            throw new NotFoundException("订单不存在");
        }
        return order;
    }

    /** 变更日志快照：行内业务字段（before/after 同构，便于审计比对）。
        含归档时间与原因及 BOM 冻结快照：订单删除后 changeLog 与 BOM 行均可能
        不复存在，删除事件的 op_log 是唯一留存，须能独立还原终态语境与建档时的成品形态 */
    private orderSnapshot(order: SalesOrderTable): Prisma.InputJsonValue {
        return {
            orderNo: order.orderNo,
            qty: order.qty,
            orderDate: formatDateColumn(order.orderDate),
            deliverDate: formatDateColumn(order.deliverDate),
            remark: order.remark,
            lifecycleStatus: order.lifecycleStatus,
            archivedAt: order.archivedAt ? order.archivedAt.toISOString() : null,
            archiveReason: order.archiveReason,
            bomName: order.bomNameSnapshot,
            bomModel: order.bomModelSnapshot,
            bomSpec: order.bomSpecSnapshot,
            rowVersion: Number(order.rowVersion),
        };
    }

    /** 契约 Order 映射：version 序列化为 number；日期列 yyyy-MM-dd；createdAt 为 ISO 时刻
        （前端 formatDateTime 展示）；归档字段仅终态且有值时返回 */
    private toOrder(row: OrderRow, outbound: number): Order {
        const archived = row.lifecycleStatus === "ARCHIVED";
        return {
            version: Number(row.rowVersion),
            orderNo: row.orderNo,
            customer: row.customerNameSnapshot,
            customerCode: row.customer.customerCode,
            bomCode: row.bom.bomCode,
            qty: row.qty,
            outbound,
            orderDate: formatDateColumn(row.orderDate),
            deliverDate: formatDateColumn(row.deliverDate),
            remark: row.remark,
            createdBy: row.creator.name,
            createdAt: row.createdAt.toISOString(),
            lifecycleStatus: row.lifecycleStatus === "ACTIVE" ? "active" : "archived",
            ...(archived
                ? {
                      archivedAt: (row.archivedAt ?? new Date(0)).toISOString(),
                      archivedBy: row.archiver?.name ?? "",
                      archiveReason: row.archiveReason ?? "",
                  }
                : {}),
        };
    }
}

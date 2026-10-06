import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import type { Tx } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { formatDateColumn, toDateColumn } from "../common/datetime";
import { bomItemsSnapshotOf } from "../common/bom-display";
import type { ExpectedVersionDto } from "../common/dto/expected-version.dto";
import { assertVersionMatches, lockRowForWrite, lockRowsById } from "../domain/concurrency";
import { outboundNetOf, outboundQtyByOrderMap, visibleShipmentCountOf } from "../domain/inventory";
import { recordOpLog } from "../domain/op-log";
import type { OrderSnapshotCore } from "../domain/snapshots";
import { BusinessSequenceService } from "../sequence/business-sequence.service";
import type { AuthUser } from "../common/types/auth-user";
import type { BomTable, CustomTable, SalesOrderTable } from "../generated/prisma/client";
import type { Order } from "./types";
import type { CreateOrderDto } from "./dto/create-order.dto";
import type { UpdateOrderDto } from "./dto/update-order.dto";
import type { ArchiveOrderDto } from "./dto/archive-order.dto";
import type { UnarchiveOrderDto } from "./dto/unarchive-order.dto";

/** api_idempotency 的 operation_key；归档/删除按订单号独立域，与前端 mock 同粒度 */
const CREATE_OPERATION_KEY = "orders:create";
const archiveOperationKeyOf = (orderNo: string): string => `orders:archive:${orderNo}`;
const unarchiveOperationKeyOf = (orderNo: string): string => `orders:unarchive:${orderNo}`;
const deleteOperationKeyOf = (orderNo: string): string => `orders:delete:${orderNo}`;

/** 订单行 + 响应映射必需的关联（archiver 仅归档后有值，account 供回退入口判等；
 * creator 供审计展示） */
type OrderRow = SalesOrderTable & {
    customer: { customerCode: string };
    bom: { bomCode: string };
    creator: { name: string };
    archiver: { name: string; account: string } | null;
};

/**
 * 响应映射（toOrder）所需的订单投影：列表查询显式 select 仅取这些列
 * （冻结快照 JSON 等重列只在写路径整行读出时存在），整行 OrderRow 天然满足本类型。
 */
type OrderProjection = Pick<
    SalesOrderTable,
    | "id"
    | "rowVersion"
    | "orderNo"
    | "customerNameSnapshot"
    | "qty"
    | "orderDate"
    | "deliverDate"
    | "remark"
    | "createdAt"
    | "lifecycleStatus"
    | "archivedAt"
    | "archiveReason"
> & {
    customer: { customerCode: string };
    bom: { bomCode: string };
    creator: { name: string };
    archiver: { name: string; account: string } | null;
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
        const [rows, outboundMap] = await Promise.all([
            this.prisma.salesOrderTable.findMany({
                orderBy: { orderNo: "asc" },
                select: {
                    id: true,
                    rowVersion: true,
                    orderNo: true,
                    customerNameSnapshot: true,
                    qty: true,
                    orderDate: true,
                    deliverDate: true,
                    remark: true,
                    createdAt: true,
                    lifecycleStatus: true,
                    archivedAt: true,
                    archiveReason: true,
                    customer: { select: { customerCode: true } },
                    bom: { select: { bomCode: true } },
                    creator: { select: { name: true } },
                    archiver: { select: { name: true, account: true } },
                },
            }),
            outboundQtyByOrderMap(this.prisma),
        ]);
        return rows.map(row => this.toOrder(row, outboundMap.get(row.id) ?? 0));
    }

    /**
     * 新建销售订单：客户名称与 BOM 快照由服务端查询冻结（db-scheme.md §6.1）；
     * 订单号按 orderDate 每日事务取号。锁序：BOM → 订单（创建时仅 BOM 行锁，
     * 与编辑/出库登记保持同一顺序防死锁）。
     */
    async createOrder(dto: CreateOrderDto, actor: AuthUser, idempotencyKey: string | undefined): Promise<Order> {
        return this.idempotency.runGuarded(
            {
                actorId: BigInt(actor.id),
                operationKey: CREATE_OPERATION_KEY,
                idempotencyKey,
                digest: { method: "POST", body: dto },
            },
            async (tx: Tx, { idempotencyKey: key }) => {
                const bom = await this.lockBomByCode(tx, dto.bomCode);
                const customer = await tx.customTable.findUnique({ where: { customerCode: dto.customerCode } });
                if (!customer) {
                    throw new NotFoundException("客户不存在");
                }
                // BOM 快照冻结（db-scheme.md §6.1）：明细取建档冻结行（position 排序），
                // modelCode/spec 由其派生；下单后目录变更不影响本订单与打印
                const bomSnapshot = await this.freezeBomSnapshot(tx, bom.id);

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
                        afterJson: this.orderSnapshot({
                            ...created,
                            customer: { customerCode: customer.customerCode },
                            bom: { bomCode: bom.bomCode },
                        }),
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
                        ...this.orderSnapshot(created),
                        customer: customer.name,
                        customerCode: customer.customerCode,
                        bomCode: bom.bomCode,
                        bomRemark: bom.remark,
                    },
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
                return {
                    httpStatus: 200,
                    responseBody: order,
                    resource: { type: "order", code: orderNo },
                };
            },
        );
    }

    /**
     * 修改销售订单：乐观锁 + 已归档不可改；发过货（有效出库净额 > 0）
     * 的订单数量与交货日期锁定，仅可改备注（db-scheme.md §6.1）。
     * 客户与 BOM 仅在净出库为 0 且无未删除出库单（与删除同口径）时可改，
     * 改 BOM 重冻建档快照、改客户刷新名称快照；同值上送视为未变更，
     * 不触发守卫也不重冻。锁序：BOM → 订单（换 BOM 时新旧 BOM id 升序同锁）。
     */
    async updateOrder(orderNo: string, dto: UpdateOrderDto, actor: AuthUser): Promise<Order> {
        if (
            dto.customerCode === undefined &&
            dto.bomCode === undefined &&
            dto.qty === undefined &&
            dto.deliverDate === undefined &&
            dto.remark === undefined
        ) {
            throw new BadRequestException("至少修改客户、BOM、数量、交货日期或备注之一");
        }
        return this.txRunner.run(async (tx: Tx) => {
            const now = new Date();
            // 换 BOM 的新行已在锁序内锁定并按 id 重读（含品类）；漂移校验收口在锁内
            const { row: current, nextBom } = await this.lockOrderForWrite(tx, orderNo, dto.bomCode);
            assertVersionMatches(current.rowVersion, dto.expectedVersion, "订单已被其他人修改，请刷新后重试");
            if (current.lifecycleStatus === "ARCHIVED") {
                throw new ConflictException("订单已归档，不可修改");
            }

            // 是否真实变更一律以锁定行当前关联码比对：同值 = 无变更，不触发下述守卫
            const bomChanged = dto.bomCode !== undefined && dto.bomCode !== current.bom.bomCode;
            const customerChanged =
                dto.customerCode !== undefined && dto.customerCode !== current.customer.customerCode;

            const outbound = await outboundNetOf(tx, current.id);
            if (bomChanged || customerChanged) {
                if (outbound > 0) {
                    throw new ConflictException("订单已有出库记录，客户与 BOM 不可修改，仅可修改备注");
                }
                // 可见出库单（含已作废未删除）同理阻止：口径与删除一致（visibleShipmentCountOf）
                if ((await visibleShipmentCountOf(tx, current.id)) > 0) {
                    throw new ConflictException("请先作废并删除关联出库单，再修改客户与 BOM");
                }
            }
            if (outbound > 0 && (dto.qty !== undefined || dto.deliverDate !== undefined)) {
                throw new ConflictException("订单已有出库记录，数量与交货日期不可修改，仅可修改备注");
            }
            if (dto.qty !== undefined && dto.qty < outbound) {
                throw new ConflictException(`新数量不得小于该订单有效出库净额（当前已发 ${outbound}）`);
            }

            // 快照按新 BOM 建档重冻（与 createOrder 同口径）；客户解析在守卫后（同值不重冻）
            const nextBomSnapshot = bomChanged ? await this.freezeBomSnapshot(tx, nextBom!.id) : undefined;
            let nextCustomer: CustomTable | undefined;
            if (customerChanged) {
                const customer = await tx.customTable.findUnique({ where: { customerCode: dto.customerCode! } });
                if (!customer) {
                    throw new NotFoundException("客户不存在");
                }
                nextCustomer = customer;
            }

            const updated = await tx.salesOrderTable.update({
                where: { id: current.id },
                data: {
                    ...(bomChanged
                        ? {
                              bomId: nextBom!.id,
                              bomNameSnapshot: nextBom!.category.name,
                              bomModelSnapshot: nextBomSnapshot!.modelCode,
                              bomSpecSnapshot: nextBomSnapshot as unknown as Prisma.InputJsonValue,
                          }
                        : {}),
                    ...(customerChanged
                        ? { customerId: nextCustomer!.id, customerNameSnapshot: nextCustomer!.name }
                        : {}),
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
                    archiver: { select: { name: true, account: true } },
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
     * 收尾已完成/部分发货的订单，使其退出活跃视图仅供查询。归档后仅归档操作人
     * 本人可回退（unarchiveOrder）；一件未发的订单不可归档——手误订单走删除。
     * 存在未作废出库单时直接放行（已发数量保留），归档后其出库单不可作废/删除。
     * 归档人/时间/备注（选填）随行落库供审计，change_log 记 ARCHIVE 事件
     * （操作人与时间），op_log 另记里程碑快照。
     */
    async archiveOrder(
        orderNo: string,
        dto: ArchiveOrderDto,
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<Order> {
        const operationKey = archiveOperationKeyOf(orderNo);
        return this.idempotency.runGuarded(
            {
                actorId: BigInt(actor.id),
                operationKey,
                idempotencyKey,
                digest: { method: "POST", pathParams: { orderNo }, body: dto },
            },
            async (tx: Tx, { idempotencyKey: key }) => {
                const now = new Date();
                const { row: current } = await this.lockOrderForWrite(tx, orderNo);
                assertVersionMatches(current.rowVersion, dto.expectedVersion, "订单已被其他人修改，请刷新后重试");
                if (current.lifecycleStatus === "ARCHIVED") {
                    throw new ConflictException("订单已归档");
                }
                const outbound = await outboundNetOf(tx, current.id);
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
                        archiver: { select: { name: true, account: true } },
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
                        ...this.orderSnapshot(updated),
                        customer: updated.customerNameSnapshot,
                        customerCode: updated.customer.customerCode,
                        bomCode: updated.bom.bomCode,
                        archivedBy: updated.archiver?.name ?? null,
                        // 归档原因入快照：系统日志页 reason 展示依赖 detail（行级无 reason 列）
                        reason: dto.reason?.length ? dto.reason : null,
                    },
                    now,
                });

                // 归档不改变出库净额，直接复用锁定后已算出的口径
                const order = this.toOrder(updated, outbound);
                return {
                    httpStatus: 200,
                    responseBody: order,
                    resource: { type: "order", code: orderNo },
                };
            },
        );
    }

    /**
     * 回退归档（契约 orders:unarchive，幂等，仅超级管理员且仅归档操作人本人，
     * db-scheme.md §6.1）：误归档的订单退回 ACTIVE，返回销售订单页恢复编辑/发货。
     * 归档人判等在服务层强校验（archived_by 与操作人判等，超管同样受限——
     * PermissionsGuard 对 super 短路，此处是唯一闸口）。归档三要素由
     * ck_sales_order_archive 约束随回退一并清空，归档语境由 ARCHIVE/UNARCHIVE
     * 变更日志快照保留；回退备注（选填）随行落库。回退后出库单恢复可作废/删除，
     * 可发量分配重新纳入该订单；再次归档时新归档人接替回退权。
     */
    async unarchiveOrder(
        orderNo: string,
        dto: UnarchiveOrderDto,
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<Order> {
        const operationKey = unarchiveOperationKeyOf(orderNo);
        return this.idempotency.runGuarded(
            {
                actorId: BigInt(actor.id),
                operationKey,
                idempotencyKey,
                digest: { method: "POST", pathParams: { orderNo }, body: dto },
            },
            async (tx: Tx, { idempotencyKey: key }) => {
                const now = new Date();
                const { row: current } = await this.lockOrderForWrite(tx, orderNo);
                assertVersionMatches(current.rowVersion, dto.expectedVersion, "订单已被其他人修改，请刷新后重试");
                if (current.lifecycleStatus !== "ARCHIVED") {
                    throw new ConflictException("订单未归档，无需回退");
                }
                if (current.archivedBy === null || current.archivedBy !== BigInt(actor.id)) {
                    throw new ForbiddenException("只有归档人本人可以回退归档");
                }

                const outbound = await outboundNetOf(tx, current.id);
                const updated = await tx.salesOrderTable.update({
                    where: { id: current.id },
                    data: {
                        lifecycleStatus: "ACTIVE",
                        // 归档三要素随回退清空（ck_sales_order_archive 强制），语境留档日志快照
                        archivedAt: null,
                        archivedBy: null,
                        archiveReason: null,
                        updatedBy: BigInt(actor.id),
                        rowVersion: { increment: 1 },
                    },
                    include: {
                        customer: { select: { customerCode: true } },
                        bom: { select: { bomCode: true } },
                        creator: { select: { name: true } },
                        archiver: { select: { name: true, account: true } },
                    },
                });
                await tx.salesOrderChangeLog.create({
                    data: {
                        id: this.snowflake.next(),
                        orderId: current.id,
                        operatorId: BigInt(actor.id),
                        eventType: "UNARCHIVE",
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
                    action: "unarchive_order",
                    targetType: "order",
                    targetId: current.id,
                    targetCode: current.orderNo,
                    detail: {
                        ...this.orderSnapshot(updated),
                        customer: updated.customerNameSnapshot,
                        customerCode: updated.customer.customerCode,
                        bomCode: updated.bom.bomCode,
                        unarchivedBy: actor.name,
                        // 回退原因入快照：系统日志页 reason 展示依赖 detail（行级无 reason 列）
                        reason: dto.reason?.length ? dto.reason : null,
                    },
                    now,
                });

                // 回退不改变出库净额，直接复用锁定后已算出的口径
                return {
                    httpStatus: 200,
                    responseBody: this.toOrder(updated, outbound),
                    resource: { type: "order", code: orderNo },
                };
            },
        );
    }

    /**
     * 删除净发货为零且没有可见出库单的订单：先软删除以保留仍在 7 天后悔期内的
     * 出库单外键，待其物理清理后由维护任务清理订单与变更日志。
     */
    async deleteOrder(
        orderNo: string,
        dto: ExpectedVersionDto,
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<null> {
        const operationKey = deleteOperationKeyOf(orderNo);
        // 删除的契约响应恒为 data:null：重放与成功均归一返回 null（runGuardedVoid）
        return this.idempotency.runGuardedVoid(
            {
                actorId: BigInt(actor.id),
                operationKey,
                idempotencyKey,
                digest: { method: "POST", pathParams: { orderNo }, body: dto },
            },
            async (tx: Tx) => {
                const now = new Date();
                const { row: current } = await this.lockOrderForWrite(tx, orderNo);
                assertVersionMatches(current.rowVersion, dto.expectedVersion, "订单已被其他人修改，请刷新后重试");
                if (current.lifecycleStatus === "ARCHIVED") {
                    throw new ConflictException("订单已归档，不可删除");
                }
                const outbound = await outboundNetOf(tx, current.id);
                if (outbound > 0) {
                    throw new ConflictException("订单已有发货记录，不可删除");
                }
                if ((await visibleShipmentCountOf(tx, current.id)) > 0) {
                    throw new ConflictException("请先作废并删除关联出库单，再删除订单");
                }

                await tx.salesOrderTable.update({
                    where: { id: current.id },
                    data: { deletedAt: now, updatedBy: BigInt(actor.id) },
                });
                // op_log 快照：行内字段 + 关联编码（客户/BOM），审计可独立还原删除前形态；
                // BOM 行此刻未删（删订单不动 BOM），补读建档备注一并冻结
                const snapshot = this.orderSnapshot(current);
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
                    },
                    now,
                });
                // JSON 列不接受 null 占位；重放路径已归一为 null，此快照仅审计兜底
                return {
                    httpStatus: 200,
                    responseBody: { deleted: true, orderNo: current.orderNo },
                    resource: { type: "order", code: current.orderNo },
                };
            },
        );
    }

    /** 锁定 BOM 行并携带品类（快照名称取品类名）；不存在抛 404（序列收口于 lockRowForWrite） */
    private lockBomByCode(tx: Tx, bomCode: string): Promise<BomTable & { category: { name: string } }> {
        return lockRowForWrite(
            tx,
            "bom_table",
            bomCode,
            inner =>
                inner.bomTable.findUnique({
                    where: { bomCode },
                    include: { category: { select: { name: true } } },
                }),
            "BOM 不存在",
        );
    }

    /** BOM 快照冻结：明细取建档冻结行（position 排序），modelCode/spec 由其派生——
     *  新建与编辑换 BOM 重冻共用同一配方，避免两处快照形态漂移 */
    private async freezeBomSnapshot(tx: Tx, bomId: bigint) {
        return bomItemsSnapshotOf(await tx.bomItem.findMany({ where: { bomId }, orderBy: { position: "asc" } }));
    }

    /**
     * 按契约锁序锁定订单行（db-scheme.md §2）：id 升序锁修改前后的 BOM，再锁订单行。
     * 先无锁读定位 bomId 并预检新 BOM（换 BOM 需要新旧两个），锁定读返回最新已提交行；
     * 新 BOM 在锁定后按 id 重读（含品类，供快照重冻）。定位与锁定之间订单的 BOM 引用
     * 漂移说明锁集不完整，统一在此拦截——编辑/归档/删除共享该锁集一致性校验。
     */
    private async lockOrderForWrite(
        tx: Tx,
        orderNo: string,
        nextBomCode?: string,
    ): Promise<{ row: OrderRow; nextBom?: BomTable & { category: { name: string } } }> {
        const located = await tx.salesOrderTable.findUnique({
            where: { orderNo },
            select: { id: true, bomId: true },
        });
        if (!located) {
            throw new NotFoundException("订单不存在");
        }
        const peeked = nextBomCode
            ? await tx.bomTable.findUnique({ where: { bomCode: nextBomCode }, select: { id: true } })
            : undefined;
        if (nextBomCode && !peeked) {
            throw new NotFoundException("BOM 不存在");
        }
        // id 升序去重由 lockRowsById 统一完成（新旧同锁防死锁）
        await lockRowsById(tx, "bom_table", [located.bomId, ...(peeked ? [peeked.id] : [])]);
        let nextBom: (BomTable & { category: { name: string } }) | undefined;
        if (peeked) {
            const resolved = await tx.bomTable.findUnique({
                where: { id: peeked.id },
                include: { category: { select: { name: true } } },
            });
            if (!resolved) {
                // 预检与锁定之间被软删（全局软删注入对已删行不可见）
                throw new NotFoundException("BOM 不存在");
            }
            nextBom = resolved;
        }
        const row = await lockRowForWrite(
            tx,
            "sales_order_table",
            orderNo,
            inner =>
                inner.salesOrderTable.findUnique({
                    where: { orderNo },
                    include: {
                        customer: { select: { customerCode: true } },
                        bom: { select: { bomCode: true } },
                        creator: { select: { name: true } },
                        archiver: { select: { name: true, account: true } },
                    },
                }),
            "订单不存在",
        );
        if (row.bomId !== located.bomId) {
            throw new ConflictException("订单已被其他人修改，请刷新后重试");
        }
        return { row, nextBom };
    }

    /** 变更日志快照：行内业务字段（before/after 同构，便于审计比对）。
        含归档时间与原因、客户名称与编码及 BOM 冻结快照：客户在编辑换客户时重冻，
        BOM 在编辑换 BOM 时重冻；订单删除后 changeLog 与 BOM 行均可能不复存在，
        删除事件的 op_log 是唯一留存，须能独立还原终态语境与建档时的成品形态。
        customerCode 取自关联（无关联的调用点显式补传，如 createOrder 的 create 返回行）；
        bomCode 同理——同品类换 BOM 时 bomName/bomModel 可能不变，审计行靠编码可见 */
    private orderSnapshot(
        order: SalesOrderTable & { customer?: { customerCode: string }; bom?: { bomCode: string } },
    ): OrderSnapshotCore {
        return {
            orderNo: order.orderNo,
            qty: order.qty,
            orderDate: formatDateColumn(order.orderDate),
            deliverDate: formatDateColumn(order.deliverDate),
            remark: order.remark,
            lifecycleStatus: order.lifecycleStatus,
            archivedAt: order.archivedAt ? order.archivedAt.toISOString() : null,
            archiveReason: order.archiveReason,
            customer: order.customerNameSnapshot,
            customerCode: order.customer?.customerCode ?? "",
            bomCode: order.bom?.bomCode ?? "",
            bomName: order.bomNameSnapshot,
            bomModel: order.bomModelSnapshot,
            bomSpec: order.bomSpecSnapshot,
            rowVersion: Number(order.rowVersion),
        };
    }

    /** 契约 Order 映射：version 序列化为 number；日期列 yyyy-MM-dd；createdAt 为 ISO 时刻
        （前端 formatDateTime 展示）；归档字段仅终态且有值时返回；archivedByAccount
        供前端回退入口判等（账号唯一且不可改，禁止用姓名反查） */
    private toOrder(row: OrderProjection, outbound: number): Order {
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
                      archivedByAccount: row.archiver?.account ?? "",
                      archiveReason: row.archiveReason ?? "",
                  }
                : {}),
        };
    }
}

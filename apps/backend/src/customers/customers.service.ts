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
import { maskPhone } from "../common/phone";
import { formatDateColumn } from "../common/datetime";
import { beijingDayKey } from "../common/beijing-day";
import { recordOpLog } from "../domain/op-log";
import { BusinessSequenceService } from "../sequence/business-sequence.service";
import type { AuthUser } from "../common/types/auth-user";
import type { CustomTable, SysUser } from "../generated/prisma/client";
import type { Customer, CustomerOwnerOption, CustomerPhone } from "./types";
import type { CreateCustomerDto } from "./dto/create-customer.dto";
import type { UpdateCustomerDto } from "./dto/update-customer.dto";

/** api_idempotency 的 operation_key：同用户 + 操作 + key 唯一（db-scheme.md §1.3） */
const CREATE_OPERATION_KEY = "customers:create";

/** 负责人移交历史 reason（契约 UpdateCustomerInput 未提供原因字段，用固定描述） */
const OWNER_CHANGE_REASON = "编辑客户档案变更负责人";

/** 日历月平移（与 MySQL INTERVAL n MONTH / date-fns addMonths 同语义：月末 clamp 到目标月最后一天） */
function addCalendarMonths(utcMidnight: Date, months: number): Date {
    const day = utcMidnight.getUTCDate();
    const result = new Date(Date.UTC(utcMidnight.getUTCFullYear(), utcMidnight.getUTCMonth() + months, 1));
    const daysInTargetMonth = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
    result.setUTCDate(Math.min(day, daysInTargetMonth));
    return result;
}

/** 客户行 + 负责人关联（owner 为响应映射必需的 join 结果） */
type CustomerRow = CustomTable & { owner: Pick<SysUser, "id" | "name" | "account"> };

@Injectable()
export class CustomersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly snowflake: SnowflakeGenerator,
        private readonly txRunner: TransactionRunner,
        private readonly idempotency: IdempotencyService,
        private readonly sequence: BusinessSequenceService,
    ) {}

    /**
     * 客户档案列表（契约 customers:view）：手机号只回掩码；合作状态不落库，
     * 以「近 6 个日历月（含边界）存在活动订单」派生（db-scheme.md §4.1），
     * 全部客户一次 groupBy 取数避免 N+1。
     */
    async listCustomers(): Promise<Customer[]> {
        const rows = await this.prisma.customTable.findMany({
            orderBy: { customerCode: "asc" },
            include: { owner: { select: { id: true, name: true, account: true } } },
        });
        const cooperatingIds = await this.cooperatingCustomerIds(this.prisma);
        return rows.map(row => this.toCustomer(row, cooperatingIds.has(row.id)));
    }

    /** 启用中的销售与超级管理员即合法负责人候选（db-scheme.md §4.1）；只回展示字段 */
    async listOwnerOptions(): Promise<CustomerOwnerOption[]> {
        return this.prisma.sysUser.findMany({
            where: { roleCode: { in: ["sales", "super"] }, status: true },
            orderBy: { account: "asc" },
            select: { name: true, account: true },
        });
    }

    /**
     * 完整手机号（db-scheme.md §4.1：普通响应只回掩码，完整号仅此口子）：
     * 超管可取任意客户，销售仅限自己负责的客户（负责人只有 sales/super，其余角色天然不匹配）。
     */
    async revealPhone(code: string, actor: AuthUser): Promise<CustomerPhone> {
        const row = await this.prisma.customTable.findUnique({
            where: { customerCode: code },
            select: { contactPhone: true, ownerId: true },
        });
        if (!row) {
            throw new NotFoundException("客户不存在");
        }
        if (!actor.isSuper && row.ownerId !== BigInt(actor.id)) {
            throw new ForbiddenException("只有超级管理员或客户负责人可获取完整手机号");
        }
        return { phone: row.contactPhone };
    }

    /**
     * 新建客户档案：客户编码全局事务取号（CUS-0001 起）；负责人锁定并确认为
     * 启用中的销售或超级管理员；创建写 op_log 与业务行同事务（db-scheme.md §8）。
     */
    async createCustomer(
        dto: CreateCustomerDto,
        actor: AuthUser,
        idempotencyKey: string | undefined,
    ): Promise<Customer> {
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
                return replay.body as unknown as Customer;
            }
            if (placeholderId === null) {
                throw new Error("幂等占位缺失");
            }

            const owner = await this.lockOwnerByAccount(tx, dto.ownerAccount);
            const now = new Date();
            const id = this.snowflake.next();
            const customerCode = await this.sequence.nextCode(tx, "customer", "");
            const created = await tx.customTable.create({
                data: {
                    id,
                    customerCode,
                    name: dto.name,
                    contactPerson: dto.contact,
                    contactPhone: dto.phone,
                    // 省市/地址可空：空串规范化为 NULL（db-scheme.md §1.1 无值统一 NULL）
                    province: dto.province || null,
                    city: dto.city || null,
                    district: dto.district || null,
                    town: dto.town || null,
                    address: dto.address || null,
                    ownerId: owner.id,
                    payTerms: dto.payTerms,
                    requestKey: this.idempotency.requestKey(BigInt(actor.id), CREATE_OPERATION_KEY, key),
                    createdBy: BigInt(actor.id),
                    updatedBy: BigInt(actor.id),
                    createdAt: now,
                },
            });
            await recordOpLog(tx, this.snowflake, actor, {
                action: "create_customer",
                targetType: "customer",
                targetId: id,
                targetCode: customerCode,
                detail: { name: dto.name, ownerAccount: dto.ownerAccount },
                now,
            });

            const customer = this.toCustomer({ ...created, owner }, false);
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                responseBody: customer as unknown as Prisma.InputJsonValue,
                resource: { type: "customer", code: customerCode },
            });
            return customer;
        });
    }

    /**
     * 编辑客户档案（不可删除）：乐观锁比对 row_version；负责人变化锁定新负责人
     * 并写移交历史（db-scheme.md §4.2）；phone 空串表示保留原号码。
     */
    async updateCustomer(code: string, dto: UpdateCustomerDto, actor: AuthUser): Promise<Customer> {
        return this.txRunner.run(async (tx: Tx) => {
            const now = new Date();
            const current = await this.lockByCode(tx, code);
            if (current.rowVersion !== BigInt(dto.expectedVersion)) {
                throw new ConflictException("客户信息已被其他人修改，请刷新后重试");
            }

            let ownerId = current.ownerId;
            if (dto.ownerAccount !== current.owner.account) {
                const nextOwner = await this.lockOwnerByAccount(tx, dto.ownerAccount);
                ownerId = nextOwner.id;
            }

            const updated = await tx.customTable.update({
                where: { id: current.id },
                data: {
                    name: dto.name,
                    contactPerson: dto.contact,
                    // 空串 = 保留原号码（响应只见掩码，改号须提交完整 11 位）
                    contactPhone: dto.phone ? dto.phone : current.contactPhone,
                    // 省市/地址可空：空串规范化为 NULL（db-scheme.md §1.1 无值统一 NULL）
                    province: dto.province || null,
                    city: dto.city || null,
                    district: dto.district || null,
                    town: dto.town || null,
                    address: dto.address || null,
                    ownerId,
                    payTerms: dto.payTerms,
                    updatedBy: BigInt(actor.id),
                    rowVersion: { increment: 1 },
                },
                include: { owner: { select: { id: true, name: true, account: true } } },
            });

            if (ownerId !== current.ownerId) {
                await tx.customerOwnerHistory.create({
                    data: {
                        id: this.snowflake.next(),
                        batchId: this.snowflake.next(),
                        customerId: current.id,
                        fromOwnerId: current.ownerId,
                        toOwnerId: ownerId,
                        operatorId: BigInt(actor.id),
                        reason: OWNER_CHANGE_REASON,
                        createdAt: now,
                    },
                });
            }

            const cooperating = await tx.salesOrderTable.findFirst({
                where: {
                    customerId: current.id,
                    lifecycleStatus: "ACTIVE",
                    orderDate: { gte: this.cooperationWindowStart() },
                },
                select: { id: true },
            });
            return this.toCustomer(updated, cooperating !== null);
        });
    }

    /** 合作窗口起点：北京今日减 6 个日历月（含边界）；DATE 列比较用 UTC 午夜表示 */
    private cooperationWindowStart(): Date {
        const [year, month, day] = beijingDayKey()
            .split("-")
            .map(part => Number.parseInt(part, 10));
        return addCalendarMonths(new Date(Date.UTC(year!, month! - 1, day!)), -6);
    }

    /** 近 6 个日历月存在活动订单的客户 id 集合；PrismaService 与事务 Tx 均可传入 */
    private async cooperatingCustomerIds(db: Pick<PrismaService, "salesOrderTable">): Promise<Set<bigint>> {
        const rows = await db.salesOrderTable.groupBy({
            by: ["customerId"],
            where: { lifecycleStatus: "ACTIVE", orderDate: { gte: this.cooperationWindowStart() } },
        });
        return new Set(rows.map(row => row.customerId));
    }

    /** 锁定并确认负责人为启用中的销售或超级管理员（db-scheme.md §4.1：资格校验在事务内完成） */
    private async lockOwnerByAccount(tx: Tx, account: string): Promise<Pick<SysUser, "id" | "name" | "account">> {
        await tx.$queryRaw`SELECT id FROM sys_user WHERE account = ${account} FOR UPDATE`;
        const owner = await tx.sysUser.findUnique({ where: { account } });
        if (!owner) {
            throw new NotFoundException("负责人账号不存在");
        }
        if (!["sales", "super"].includes(owner.roleCode) || !owner.status) {
            throw new BadRequestException("客户负责人必须是启用中的销售或超级管理员账号");
        }
        return owner;
    }

    /** 锁定目标客户行并携带当前负责人；不存在抛 404 */
    private async lockByCode(tx: Tx, code: string): Promise<CustomerRow> {
        await tx.$queryRaw`SELECT id FROM custom_table WHERE customer_code = ${code} FOR UPDATE`;
        const customer = await tx.customTable.findUnique({
            where: { customerCode: code },
            include: { owner: { select: { id: true, name: true, account: true } } },
        });
        if (!customer) {
            throw new NotFoundException("客户不存在");
        }
        return customer;
    }

    /** 契约 Customer 映射：version 序列化为 number，日期列 yyyy-MM-dd，手机号掩码 */
    private toCustomer(row: CustomerRow, cooperating: boolean): Customer {
        return {
            version: Number(row.rowVersion),
            code: row.customerCode,
            name: row.name,
            contact: row.contactPerson,
            phone: maskPhone(row.contactPhone),
            province: row.province ?? "",
            city: row.city ?? "",
            district: row.district ?? "",
            town: row.town ?? "",
            address: row.address ?? "",
            cooperation: cooperating ? "合作中" : "待跟进",
            owner: row.owner.name,
            ownerAccount: row.owner.account,
            payTerms: row.payTerms,
            created: formatDateColumn(row.createdAt),
        };
    }
}

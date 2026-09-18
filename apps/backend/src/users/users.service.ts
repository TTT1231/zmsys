import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionRunner } from '../prisma/transaction.runner';
import type { Tx } from '../prisma/transaction.runner';
import { SnowflakeGenerator } from '../common/snowflake';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { toWbUser, userSnapshot } from '../access-control/wb-user';
import type { WbUser } from '../access-control/types';
import { SUPER_ROLE_CODE } from '../constants';
import type { AuthUser } from '../common/types/auth-user';
import type { SysUser } from '../generated/prisma/client';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { SetUserStatusDto } from './dto/set-user-status.dto';

/** 契约初始密码：新增用户统一 123456，数据库只保存强哈希（db-scheme.md §0.6） */
const INITIAL_PASSWORD = '123456';

/** api_idempotency 的 operation_key：同用户 + 操作 + key 唯一（db-scheme.md §1.3） */
const CREATE_OPERATION_KEY = 'users:create';

/** 编辑与启停共用的离岗移交可选字段 */
interface TransferFields {
    replacementOwnerAccount?: string;
    transferReason?: string;
}

/** 锁定并按 id 升序返回目标销售仍负责的全部客户（READ COMMITTED 下锁定读后普通读见最新行） */
async function lockOwnedCustomers(tx: Tx, ownerId: bigint) {
    await tx.$queryRaw`SELECT id FROM custom_table WHERE owner_id = ${ownerId} ORDER BY id FOR UPDATE`;
    return tx.customTable.findMany({ where: { ownerId }, orderBy: { id: 'asc' } });
}

@Injectable()
export class UsersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly snowflake: SnowflakeGenerator,
        private readonly txRunner: TransactionRunner,
        private readonly idempotency: IdempotencyService,
    ) {}

    async listUsers(): Promise<WbUser[]> {
        const users = await this.prisma.sysUser.findMany({ orderBy: { account: 'asc' } });
        return users.map(user => toWbUser(user));
    }

    /**
     * 新增普通用户（不得新增 super，DTO 已限白名单）：初始密码哈希在事务外计算——
     * 事务回调必须可重入且尽量只含数据库写入；幂等占位与用户、日志同事务提交/回滚。
     * 响应快照只存 WbUser 本体：信封由 TransformInterceptor 统一包裹，重放形态一致。
     */
    async createUser(dto: CreateUserDto, actor: AuthUser, idempotencyKey: string | undefined): Promise<WbUser> {
        const key = this.idempotency.requireKey(idempotencyKey);
        const requestHash = this.idempotency.digest({ method: 'POST', body: dto });
        const passwordHash = await bcrypt.hash(INITIAL_PASSWORD, 10);

        return this.txRunner.run(async (tx: Tx) => {
            const { replay, placeholderId } = await this.idempotency.beginOrReplay(tx, {
                actorId: BigInt(actor.id),
                operationKey: CREATE_OPERATION_KEY,
                key,
                requestHash,
            });
            if (replay) {
                // 占位时存的是成功响应数据本体，直接原样返回
                return replay.body as unknown as WbUser;
            }
            if (placeholderId === null) {
                // BeginResult 契约：replay 为空时占位必然存在；走到这里即基础设施缺陷
                throw new Error('幂等占位缺失');
            }

            const existing = await tx.sysUser.findUnique({ where: { account: dto.account } });
            if (existing) {
                throw new ConflictException('账号已存在');
            }
            const now = new Date();
            const id = this.snowflake.next();
            let user: SysUser;
            try {
                user = await tx.sysUser.create({
                    data: {
                        id,
                        account: dto.account,
                        name: dto.name,
                        roleCode: dto.role,
                        passwordHash,
                        createdAt: now,
                    },
                });
            } catch (error) {
                // 并发创建同账号：预检查之外的唯一约束兜底，映射为 409
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                    throw new ConflictException('账号已存在');
                }
                throw error;
            }
            await tx.sysUserChangeLog.create({
                data: {
                    id: this.snowflake.next(),
                    userId: id,
                    operatorId: BigInt(actor.id),
                    eventType: 'CREATE',
                    createdAt: now,
                    afterVersion: user.rowVersion,
                    reason: '新增用户（初始密码为契约默认值）',
                    afterJson: userSnapshot(user),
                },
            });

            const wbUser = toWbUser(user);
            await this.idempotency.complete(tx, {
                id: placeholderId,
                httpStatus: 200,
                responseBody: wbUser as unknown as Prisma.InputJsonValue,
                resource: { type: 'user', code: user.account },
            });
            return wbUser;
        });
    }

    /**
     * 编辑姓名或角色：account 不可改；乐观锁比对 row_version；
     * 角色变更递增 token_version 使旧 JWT 立即失效并重新鉴权。
     */
    async updateUser(account: string, dto: UpdateUserDto, actor: AuthUser): Promise<WbUser> {
        return this.txRunner.run(async (tx: Tx) => {
            const now = new Date();
            const current = await this.lockByAccount(tx, account);
            if (current.rowVersion !== BigInt(dto.expectedVersion)) {
                throw new ConflictException('用户信息已被其他人修改，请刷新后重试');
            }
            if (current.roleCode === SUPER_ROLE_CODE && dto.role !== SUPER_ROLE_CODE) {
                throw new BadRequestException('内置超级管理员角色不可修改');
            }
            if (current.roleCode !== SUPER_ROLE_CODE && dto.role === SUPER_ROLE_CODE) {
                throw new BadRequestException('不得通过接口授予超级管理员角色');
            }

            const roleChanged = current.roleCode !== dto.role;
            const transferred =
                roleChanged && current.roleCode === 'sales'
                    ? await this.transferCustomersIfNeeded(tx, current, dto, actor)
                    : 0;

            const updated = await tx.sysUser.update({
                where: { id: current.id },
                data: {
                    name: dto.name,
                    roleCode: dto.role,
                    ...(roleChanged ? { tokenVersion: { increment: 1 } } : {}),
                    rowVersion: { increment: 1 },
                },
            });
            const transferNote = transferred > 0 ? `；离岗移交 ${transferred} 个客户` : '';
            await tx.sysUserChangeLog.create({
                data: {
                    id: this.snowflake.next(),
                    userId: current.id,
                    operatorId: BigInt(actor.id),
                    eventType: roleChanged ? 'ROLE_CHANGE' : 'PROFILE_UPDATE',
                    createdAt: now,
                    beforeVersion: current.rowVersion,
                    afterVersion: updated.rowVersion,
                    reason: roleChanged
                        ? `角色由 ${current.roleCode} 调整为 ${dto.role}${transferNote}`
                        : `管理员修改姓名${transferNote}`,
                    beforeJson: userSnapshot(current),
                    afterJson: userSnapshot(updated),
                },
            });
            return toWbUser(updated);
        });
    }

    /**
     * 启用/停用：super 不可停用；停用递增 token_version，旧 JWT 下一次请求即被拒绝。
     * 状态未变化时按幂等语义直接返回现状（不烧版本、不写噪音日志）。
     */
    async setUserStatus(account: string, dto: SetUserStatusDto, actor: AuthUser): Promise<WbUser> {
        return this.txRunner.run(async (tx: Tx) => {
            const now = new Date();
            const current = await this.lockByAccount(tx, account);
            if (current.rowVersion !== BigInt(dto.expectedVersion)) {
                throw new ConflictException('用户信息已被其他人修改，请刷新后重试');
            }
            if (!dto.active && current.roleCode === SUPER_ROLE_CODE) {
                throw new BadRequestException('内置超级管理员不可停用');
            }
            if (current.status === dto.active) {
                return toWbUser(current);
            }

            const transferred =
                !dto.active && current.roleCode === 'sales'
                    ? await this.transferCustomersIfNeeded(tx, current, dto, actor)
                    : 0;

            const updated = await tx.sysUser.update({
                where: { id: current.id },
                data: {
                    status: dto.active,
                    // 停用即吊销全部在途 JWT；重新启用不回滚版本，用户需重新登录
                    ...(dto.active ? {} : { tokenVersion: { increment: 1 } }),
                    rowVersion: { increment: 1 },
                },
            });
            await tx.sysUserChangeLog.create({
                data: {
                    id: this.snowflake.next(),
                    userId: current.id,
                    operatorId: BigInt(actor.id),
                    eventType: 'STATUS_CHANGE',
                    createdAt: now,
                    beforeVersion: current.rowVersion,
                    afterVersion: updated.rowVersion,
                    reason: `${dto.active ? '启用' : '停用'}账号${
                        transferred > 0 ? `；离岗移交 ${transferred} 个客户` : ''
                    }`,
                    beforeJson: userSnapshot(current),
                    afterJson: userSnapshot(updated),
                },
            });
            return toWbUser(updated);
        });
    }

    /** 锁目标用户行并返回最新数据；不存在抛 404 */
    private async lockByAccount(tx: Tx, account: string): Promise<SysUser> {
        await tx.$queryRaw`SELECT id FROM sys_user WHERE account = ${account} FOR UPDATE`;
        const user = await tx.sysUser.findUnique({ where: { account } });
        if (!user) {
            throw new NotFoundException('用户不存在');
        }
        return user;
    }

    /**
     * 销售离岗移交（db-scheme.md §2/§3.2）：仍负责客户时必须提供启用中的接任销售，
     * 批量改 owner、写移交历史（同一 batch_id）与用户状态变更同事务原子完成。
     * 锁序：目标用户（调用方已锁）→ 接任销售 → 客户 id 升序；跨销售对向移交的
     * 理论死锁由 TransactionRunner 整事务重试收敛。
     * @returns 移交客户数；无需移交（名下无客户）返回 0
     */
    private async transferCustomersIfNeeded(
        tx: Tx,
        fromUser: SysUser,
        dto: TransferFields,
        actor: AuthUser,
    ): Promise<number> {
        const ownedCount = await tx.customTable.count({ where: { ownerId: fromUser.id } });
        if (ownedCount === 0) {
            return 0;
        }
        if (!dto.replacementOwnerAccount || !dto.transferReason) {
            throw new BadRequestException(`该销售仍负责 ${ownedCount} 个客户，必须指定接任销售并填写移交原因`);
        }

        await tx.$queryRaw`SELECT id FROM sys_user WHERE account = ${dto.replacementOwnerAccount} FOR UPDATE`;
        const replacement = await tx.sysUser.findUnique({ where: { account: dto.replacementOwnerAccount } });
        if (!replacement || replacement.id === fromUser.id || replacement.roleCode !== 'sales' || !replacement.status) {
            throw new BadRequestException('接任销售必须是启用中的其他销售账号');
        }

        // 锁定后重读：READ COMMITTED 每条语句取新快照，防止计数与锁定之间新增归属客户被漏移交
        const customers = await lockOwnedCustomers(tx, fromUser.id);
        const now = new Date();
        const batchId = this.snowflake.next();
        const operatorId = BigInt(actor.id);
        for (const customer of customers) {
            await tx.customTable.update({
                where: { id: customer.id },
                data: { ownerId: replacement.id, updatedBy: operatorId, rowVersion: { increment: 1 } },
            });
            await tx.customerOwnerHistory.create({
                data: {
                    id: this.snowflake.next(),
                    batchId,
                    customerId: customer.id,
                    fromOwnerId: fromUser.id,
                    toOwnerId: replacement.id,
                    operatorId,
                    reason: dto.transferReason,
                    createdAt: now,
                },
            });
        }
        return customers.length;
    }
}

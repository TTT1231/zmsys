import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import type { Tx } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import { formatBeijingStamp } from "../common/datetime";
import { lockRowByKey, lockRowForWrite } from "../domain/concurrency";
import type { AuthUser } from "../common/types/auth-user";
import type { PermissionCatalogEntry, ProtectionLogEntry } from "./types";
import type { SetPermissionProtectionDto } from "./dto/set-permission-protection.dto";

type PermissionRow = {
    code: string;
    kind: "MENU" | "ACTION";
    menuKey: string;
    actionId: string | null;
    label: string;
    isProtected: boolean;
};

/**
 * 权限目录保护开关：super 运行时解锁/加锁。解锁后即可在角色编辑器授予其他角色；
 * 加锁同事务清理该码全部授权行（loadPermissionRows 不按 protected 过滤，残留行会造成
 * 侧边栏可见而接口 403 的半态）并递增所有角色 grant_version——JwtStrategy 权限缓存
 * 唯一的失效通道（解锁一并递增，语义统一；在途编辑器保存会 409，属预期）。
 * 变更写 sys_permission_change_log。
 */
@Injectable()
export class PermissionCatalogService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly snowflake: SnowflakeGenerator,
        private readonly txRunner: TransactionRunner,
    ) {}

    async listCatalog(): Promise<PermissionCatalogEntry[]> {
        const permissions = await this.prisma.sysPermission.findMany({ orderBy: { code: "asc" } });
        return permissions.map(permission => toEntry(permission));
    }

    async listChangeLogs(): Promise<ProtectionLogEntry[]> {
        const logs = await this.prisma.sysPermissionChangeLog.findMany({
            orderBy: { createdAt: "desc" },
        });
        if (logs.length === 0) {
            return [];
        }
        const operatorIds = [...new Set(logs.map(log => log.operatorId))];
        const codes = [...new Set(logs.map(log => log.permissionCode))];
        const [operators, permissions] = await Promise.all([
            this.prisma.sysUser.findMany({
                where: { id: { in: operatorIds } },
                select: { id: true, name: true },
            }),
            this.prisma.sysPermission.findMany({
                where: { code: { in: codes } },
                select: { code: true, label: true },
            }),
        ]);
        const nameOf = new Map(operators.map(user => [user.id, user.name]));
        const labelOf = new Map(permissions.map(permission => [permission.code, permission.label]));
        return logs.map(log => ({
            time: formatBeijingStamp(log.createdAt),
            user: nameOf.get(log.operatorId) ?? "未知用户",
            text: describeChange(labelOf.get(log.permissionCode) ?? log.permissionCode, log),
        }));
    }

    /**
     * 切换单个权限码的受保护状态。锁序：先全部 sys_role（code 升序）→ sys_permission
     * → sys_grant，与 saveGrant 的「先角色后授权」方向一致，不引入新的死锁环。
     */
    async setProtection(
        code: string,
        dto: SetPermissionProtectionDto,
        actor: AuthUser,
    ): Promise<PermissionCatalogEntry> {
        return this.txRunner.run(async (tx: Tx) => {
            const now = new Date();
            const roles = await tx.sysRole.findMany({ select: { code: true }, orderBy: { code: "asc" } });
            for (const role of roles) {
                await lockRowByKey(tx, "sys_role", role.code);
            }
            const permission = await lockRowForWrite(
                tx,
                "sys_permission",
                code,
                t => t.sysPermission.findUnique({ where: { code } }),
                "权限不存在",
            );
            if (permission.isProtected === dto.protected) {
                // 重复翻转直接拒绝（数据库 CHECK 亦禁止 before == after 的日志行）
                throw new BadRequestException("受保护状态未变化");
            }
            const updated = await tx.sysPermission.update({
                where: { code },
                data: { isProtected: dto.protected },
            });
            let cleanedGrants = 0;
            if (dto.protected) {
                const removed = await tx.sysGrant.deleteMany({ where: { permissionCode: code } });
                cleanedGrants = removed.count;
            }
            await tx.sysRole.updateMany({ data: { grantVersion: { increment: 1 } } });
            await tx.sysPermissionChangeLog.create({
                data: {
                    id: this.snowflake.next(),
                    operatorId: BigInt(actor.id),
                    permissionCode: code,
                    beforeProtected: permission.isProtected,
                    afterProtected: dto.protected,
                    cleanedGrants,
                    reason: dto.reason ?? "",
                    createdAt: now,
                },
            });
            return toEntry(updated);
        });
    }
}

const toEntry = (permission: PermissionRow): PermissionCatalogEntry => ({
    code: permission.code,
    kind: permission.kind,
    menuKey: permission.menuKey,
    actionId: permission.actionId,
    label: permission.label,
    protected: permission.isProtected,
});

/** 日志文案为审计事实，客户端填写的 reason 只作补充（与 listGrantLogs 口径一致） */
const describeChange = (label: string, log: { afterProtected: boolean; cleanedGrants: number; reason: string }) => {
    const text = log.afterProtected
        ? `权限【${label}】已加锁（默认仅超管），清理 ${log.cleanedGrants} 条授权`
        : `权限【${label}】已解锁，可授予其他角色`;
    return log.reason ? `${text}；原因：${log.reason}` : text;
};

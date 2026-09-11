import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Tx } from '../prisma/transaction.runner';
import { buildRoleGrant } from '../access-control/access-control.service';
import { ROLE_CODES, SUPER_ROLE_CODE, isRoleCode } from '../constants';
import { SnowflakeGenerator } from '../common/snowflake';
import { formatBeijingStamp } from '../common/datetime';
import type { AuthUser } from '../common/types/auth-user';
import type { GrantLogEntry, GrantMap, RoleDef, RoleGrant } from './types';
import type { SaveRoleGrantDto } from './dto/save-role-grant.dto';

@Injectable()
export class RolesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly snowflake: SnowflakeGenerator,
    ) {}

    async listRoles(): Promise<RoleDef[]> {
        const roles = await this.prisma.sysRole.findMany();
        const byCode = new Map(roles.map(role => [role.code, role]));
        return ROLE_CODES.flatMap(code => {
            const role = byCode.get(code);
            return role ? [{ id: code, name: role.name, locked: role.locked }] : [];
        });
    }

    // 单角色授权查询 getGrant 已迁至 access-control 共享层（auth 与 roles 共用）

    async getGrantMap(): Promise<GrantMap> {
        const roles = await this.prisma.sysRole.findMany();
        const byCode = new Map(roles.map(role => [role.code, role]));
        const grants = await this.prisma.sysGrant.findMany({
            include: { permission: true },
        });
        const catalog = await this.prisma.sysPermission.findMany();

        return Object.fromEntries(
            ROLE_CODES.map(code => {
                const role = byCode.get(code);
                // super 不依赖授权行，服务端固定视为全量权限
                const permissions =
                    code === SUPER_ROLE_CODE || !role
                        ? catalog
                        : grants.filter(grant => grant.roleCode === code).map(grant => grant.permission);
                return [
                    code,
                    role ? buildRoleGrant(role.grantVersion, permissions) : { version: 1, menus: [], actions: {} },
                ];
            }),
        ) as GrantMap;
    }

    async listGrantLogs(): Promise<GrantLogEntry[]> {
        const logs = await this.prisma.sysGrantLog.findMany({
            orderBy: { createdAt: 'desc' },
        });
        if (logs.length === 0) {
            return [];
        }
        const operatorIds = [...new Set(logs.map(log => log.operatorId))];
        const operators = await this.prisma.sysUser.findMany({
            where: { id: { in: operatorIds } },
            select: { id: true, name: true },
        });
        const nameOf = new Map(operators.map(user => [user.id, user.name]));
        return logs.map(log => ({
            time: formatBeijingStamp(log.createdAt),
            user: nameOf.get(log.operatorId) ?? '未知用户',
            // 服务端生成的说明是审计事实，客户端填写的原因只作补充
            text: log.clientReason ? `${log.serverNote}；原因：${log.clientReason}` : log.serverNote,
        }));
    }

    /**
     * 原子替换单个角色授权：目录校验与规范化在事务外完成，
     * 事务内锁 sys_role 行、比对乐观锁版本、整组替换 sys_grant、
     * 递增 grant_version 并写前后快照日志。无变化保存不递增版本但记录 no-op 事件。
     */
    async saveGrant(roleId: string, dto: SaveRoleGrantDto, actor: AuthUser): Promise<RoleGrant> {
        if (!isRoleCode(roleId)) {
            throw new NotFoundException('角色不存在');
        }
        if (roleId === SUPER_ROLE_CODE) {
            throw new ForbiddenException('超级管理员为内置角色，授权不可修改');
        }

        const catalog = await this.prisma.sysPermission.findMany();
        const byCode = new Map(catalog.map(permission => [permission.code, permission]));
        const menuByKey = new Map(
            catalog
                .filter(permission => permission.kind === 'MENU')
                .map(permission => [permission.menuKey, permission]),
        );

        const menus = [...new Set(dto.grant.menus)];
        const actions: Record<string, string[]> = {};
        for (const menuKey of menus) {
            const menuPermission = menuByKey.get(menuKey);
            if (!menuPermission) {
                throw new BadRequestException('授权中包含未知菜单');
            }
            if (menuPermission.isProtected) {
                throw new BadRequestException('受保护的用户与权限菜单只能由超级管理员持有');
            }
        }
        for (const [menuKey, actionIds] of Object.entries(dto.grant.actions)) {
            const menuActions = catalog.filter(
                permission => permission.kind === 'ACTION' && permission.menuKey === menuKey,
            );
            if (menuActions.length === 0 || !Array.isArray(actionIds)) {
                throw new BadRequestException('授权中包含未知操作');
            }
            const chosen = [...new Set(actionIds)];
            for (const actionId of chosen) {
                const permission = menuActions.find(item => item.actionId === actionId);
                if (!permission) {
                    throw new BadRequestException('授权中包含未知操作');
                }
                if (permission.isProtected) {
                    throw new BadRequestException('受保护权限只能由超级管理员持有');
                }
            }
            // 空数组视为未授权该菜单；勾选动作必须同时拥有父菜单与 view 动作
            if (chosen.length > 0) {
                if (!menus.includes(menuKey) || !chosen.includes('view')) {
                    throw new BadRequestException('操作权限必须同时包含父菜单和查看权限');
                }
                actions[menuKey] = chosen;
            }
        }

        const permissionCodes = [
            ...menus.map(menuKey => `menu:${menuKey}`),
            ...Object.entries(actions).flatMap(([menuKey, ids]) => ids.map(id => `${menuKey}:${id}`)),
        ].sort();

        return this.prisma.$transaction(async (tx: Tx) => {
            const now = new Date();
            await tx.$queryRaw`SELECT code FROM sys_role WHERE code = ${roleId} FOR UPDATE`;
            const role = await tx.sysRole.findUnique({ where: { code: roleId } });
            if (!role) {
                throw new NotFoundException('角色不存在');
            }
            if (role.grantVersion !== BigInt(dto.expectedVersion)) {
                throw new ConflictException('角色授权已被其他人修改，请刷新后重试');
            }

            const currentCodes = (
                await tx.sysGrant.findMany({
                    where: { roleCode: roleId },
                    select: { permissionCode: true },
                })
            )
                .map(grant => grant.permissionCode)
                .sort();
            const labelOf = (code: string): string => byCode.get(code)?.label ?? code;

            if (JSON.stringify(currentCodes) === JSON.stringify(permissionCodes)) {
                await tx.sysGrantLog.create({
                    data: {
                        id: this.snowflake.next(),
                        operatorId: BigInt(actor.id),
                        roleCode: roleId,
                        beforeVersion: role.grantVersion,
                        afterVersion: role.grantVersion,
                        createdAt: now,
                        serverNote: `角色【${role.name}】授权保存（无变化）`,
                        clientReason: dto.note ?? '',
                        beforeJson: { permissions: currentCodes },
                        afterJson: { permissions: currentCodes },
                    },
                });
                return buildRoleGrant(
                    role.grantVersion,
                    currentCodes.flatMap(code => (byCode.get(code) ? [byCode.get(code)!] : [])),
                );
            }

            await tx.sysGrant.deleteMany({ where: { roleCode: roleId } });
            if (permissionCodes.length > 0) {
                await tx.sysGrant.createMany({
                    data: permissionCodes.map(code => ({
                        roleCode: roleId,
                        permissionCode: code,
                        grantSource: 'USER' as const,
                        grantedBy: BigInt(actor.id),
                        grantedAt: now,
                    })),
                });
            }
            const updated = await tx.sysRole.update({
                where: { code: roleId },
                data: { grantVersion: { increment: 1 } },
            });

            const added = permissionCodes.filter(code => !currentCodes.includes(code));
            const removed = currentCodes.filter(code => !permissionCodes.includes(code));
            const detail = [
                added.length > 0 ? `新增 ${added.map(labelOf).join('、')}` : null,
                removed.length > 0 ? `移除 ${removed.map(labelOf).join('、')}` : null,
            ]
                .filter((part): part is string => part !== null)
                .join('，');
            await tx.sysGrantLog.create({
                data: {
                    id: this.snowflake.next(),
                    operatorId: BigInt(actor.id),
                    roleCode: roleId,
                    beforeVersion: role.grantVersion,
                    afterVersion: updated.grantVersion,
                    createdAt: now,
                    serverNote: `角色【${role.name}】授权变更：${detail}`,
                    clientReason: dto.note ?? '',
                    beforeJson: { permissions: currentCodes },
                    afterJson: { permissions: permissionCodes },
                },
            });

            return buildRoleGrant(
                updated.grantVersion,
                permissionCodes.flatMap(code => (byCode.get(code) ? [byCode.get(code)!] : [])),
            );
        });
    }
}

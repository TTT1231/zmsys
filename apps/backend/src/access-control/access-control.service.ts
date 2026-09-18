import { Injectable, NotFoundException } from "@nestjs/common";
import type { SysPermission } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SUPER_ROLE_CODE, type RoleCode } from "../constants";
import type { RoleGrant } from "./types";

/** 由权限码行构造契约的 RoleGrant 形态（menus + 按 menuKey 分组的 actions） */
export const buildRoleGrant = (version: bigint, permissions: SysPermission[]): RoleGrant => {
    const menus: string[] = [];
    const actions: Record<string, string[]> = {};
    for (const permission of permissions) {
        if (permission.kind === "MENU") {
            menus.push(permission.menuKey);
        } else {
            (actions[permission.menuKey] ??= []).push(permission.actionId ?? "");
        }
    }
    return { version: Number(version), menus, actions };
};

/**
 * 访问控制 façade：角色授权的只读查询，供 auth 与 roles 共用。
 * 独立成共享层是为了守住依赖方向（constants ← 共享层 ← 业务模块）——
 * auth 不再直接依赖 roles 内部文件，后续 users 模块加入也不会形成环。
 */
@Injectable()
export class AccessControlService {
    constructor(private readonly prisma: PrismaService) {}

    /** 单角色实时授权：super 固定全量，其余按 sys_grant 实时行 */
    async getGrant(roleCode: RoleCode): Promise<RoleGrant> {
        const role = await this.prisma.sysRole.findUnique({
            where: { code: roleCode },
        });
        if (!role) {
            throw new NotFoundException("角色不存在");
        }
        const permissions = await this.loadPermissionRows(roleCode);
        return buildRoleGrant(role.grantVersion, permissions);
    }

    private async loadPermissionRows(roleCode: string): Promise<SysPermission[]> {
        if (roleCode === SUPER_ROLE_CODE) {
            return this.prisma.sysPermission.findMany();
        }
        const grants = await this.prisma.sysGrant.findMany({
            where: { roleCode },
            include: { permission: true },
        });
        return grants.map(grant => grant.permission);
    }
}

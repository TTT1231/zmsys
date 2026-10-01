import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../prisma/prisma.service";
import { SUPER_ROLE_CODE, isRoleCode, type RoleCode } from "../../constants";
import type { AppConfig } from "../../configuration";
import type { AuthUser } from "../../common/types/auth-user";
import type { JwtPayload } from "../types";

/** 非 super 角色的权限码缓存条目：sys_role.grant_version 递增即失效 */
interface PermissionCacheEntry {
    grantVersion: bigint;
    permissions: Set<string>;
}

/**
 * JWT 只证明会话身份：签名、有效期、签发者与受众通过后，
 * 仍按 sub 回查 sys_user 确认启停状态、token_version 与实时授权。
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    /**
     * 权限码集合按 roleCode 进程内缓存：角色固定目录（Map 无清理负担），
     * 失效判据为 sys_role.grant_version——saveGrant 整组保存时递增，版本
     * 落后即重查刷新，不牺牲授权吊销的实时语义（单实例部署，无跨进程失效）。
     */
    private readonly permissionCache = new Map<string, PermissionCacheEntry>();

    constructor(
        configService: ConfigService<AppConfig>,
        private readonly prisma: PrismaService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.getOrThrow("jwt.secret", { infer: true }),
            issuer: configService.getOrThrow("jwt.issuer", { infer: true }),
            audience: configService.getOrThrow("jwt.audience", { infer: true }),
        });
    }

    async validate(payload: JwtPayload): Promise<AuthUser> {
        // 只取鉴权所需列（passwordHash 等重列不逐请求回传）；join role 拿
        // grant_version 作权限缓存的失效判据（单行主键查询，代价可忽略）
        const user = await this.prisma.sysUser.findUnique({
            where: { id: BigInt(payload.sub) },
            select: {
                id: true,
                account: true,
                name: true,
                roleCode: true,
                status: true,
                tokenVersion: true,
                rowVersion: true,
                role: { select: { grantVersion: true } },
            },
        });
        // 停用或 token_version 落后的旧 JWT 立即拒绝
        if (!user || !user.status || user.tokenVersion !== BigInt(payload.ver)) {
            throw new UnauthorizedException("登录已过期，请重新登录");
        }

        const isSuper = user.roleCode === SUPER_ROLE_CODE;
        // super 不依赖授权行，服务端固定视为全量权限；空集无缓存价值
        const permissions = isSuper
            ? new Set<string>()
            : await this.permissionsOf(user.roleCode, user.role.grantVersion);

        const role: RoleCode = isRoleCode(user.roleCode) ? user.roleCode : "staff";
        return {
            id: user.id.toString(),
            account: user.account,
            name: user.name,
            role,
            isSuper,
            rowVersion: Number(user.rowVersion),
            permissions,
        };
    }

    /**
     * 非 super 角色的权限码集合：按 (roleCode, grantVersion) 命中缓存直接复用
     * （拷贝一份防下游突变），未命中或版本落后时重查 sys_grant 并回填缓存。
     * 受保护权限只允许 super：授权写入接口会拒绝，这里再按 sys_permission.protected
     * 过滤一次——库内出现脏授权行（迁移脚本错、直改库）也不会进入普通用户的权限集。
     */
    private async permissionsOf(roleCode: string, grantVersion: bigint): Promise<Set<string>> {
        const cached = this.permissionCache.get(roleCode);
        if (cached && cached.grantVersion === grantVersion) {
            return new Set(cached.permissions);
        }
        const grants = await this.prisma.sysGrant.findMany({
            where: { roleCode, permission: { isProtected: false } },
            select: { permissionCode: true },
        });
        const permissions = new Set(grants.map(grant => grant.permissionCode));
        this.permissionCache.set(roleCode, { grantVersion, permissions });
        return new Set(permissions);
    }
}

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AUTH_ONLY_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY, SUPER_ONLY_KEY } from "../../constants";
import type { PermissionsMetadata } from "../decorators/permissions.decorator";
import type { SuperOnlyMetadata } from "../decorators/super-only.decorator";
import type { AuthUser } from "../types/auth-user";

/**
 * 在 JwtAuthGuard 之后执行。默认拒绝（default-deny）：
 * 端点必须显式声明 @Public() / @AuthenticatedOnly() / @Permissions([...]) / @SuperOnly() 之一——
 * 未声明的端点直接 403，业务端点漏写权限装饰器不会被静默放行成越权漏洞。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const [handler, controller] = [context.getHandler(), context.getClass()];

        // super 专属端点：按角色直判，不经权限码（权限码可被解锁后授予他人，
        // 用它给受保护开关守门等于自我提权通道）；与 @Permissions 互斥声明
        const superOnly = this.reflector.getAllAndOverride<SuperOnlyMetadata | undefined>(SUPER_ONLY_KEY, [
            handler,
            controller,
        ]);
        if (superOnly) {
            const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
            if (!user?.isSuper) {
                throw new ForbiddenException(superOnly.message);
            }
            return true;
        }

        const required = this.reflector.getAllAndOverride<PermissionsMetadata | undefined>(PERMISSIONS_KEY, [
            handler,
            controller,
        ]);
        if (required?.codes.length) {
            const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
            if (!user) {
                throw new ForbiddenException(required.message);
            }
            // super 为内置锁定角色，服务端固定视为全量权限
            if (user.isSuper) {
                return true;
            }
            const ok = required.codes.every(code => user.permissions.has(code));
            if (!ok) {
                throw new ForbiddenException(required.message);
            }
            return true;
        }

        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, controller]);
        const authOnly = this.reflector.getAllAndOverride<boolean>(AUTH_ONLY_KEY, [handler, controller]);
        // Public 端点的认证豁免由 JwtAuthGuard 处理；AuthenticatedOnly 只需登录（JwtAuthGuard 已保证）
        if (isPublic || authOnly) {
            return true;
        }

        throw new ForbiddenException("端点未声明访问策略，默认拒绝");
    }
}

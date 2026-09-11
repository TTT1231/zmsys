import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../constants';
import type { PermissionsMetadata } from '../decorators/permissions.decorator';
import type { AuthUser } from '../types/auth-user';

/** 在 JwtAuthGuard 之后执行：无权限码声明的端点仅需登录，有声明的按码校验 */
@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const required = this.reflector.getAllAndOverride<PermissionsMetadata | undefined>(PERMISSIONS_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!required?.codes.length) {
            return true;
        }
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
}

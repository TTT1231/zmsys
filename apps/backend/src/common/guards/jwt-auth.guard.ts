import { ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { IS_PUBLIC_KEY } from "../../constants";
import type { AuthUser } from "../types/auth-user";

/** 全局 JWT 守卫：公开端点放行，其余统一返回中文 401 文案 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
    constructor(private readonly reflector: Reflector) {
        super();
    }

    override canActivate(context: ExecutionContext) {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) {
            return true;
        }
        return super.canActivate(context);
    }

    override handleRequest<TUser = AuthUser>(_err: unknown, user: unknown): TUser {
        if (!user) {
            throw new UnauthorizedException("登录已过期，请重新登录");
        }
        return user as TUser;
    }
}

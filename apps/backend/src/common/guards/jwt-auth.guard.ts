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

    override handleRequest<TUser = AuthUser>(err: unknown, user: unknown): TUser {
        if (err !== null && err !== undefined) {
            // 策略抛出的异常原样透传：凭据失效（UnauthorizedException）仍是 401，
            // 数据库异常等基础设施错误交全局过滤器按 5xx 处理——误报 401 会让客户端
            // 清掉待核实的恢复 requestKey 并误判恢复失败（实施计划 §6）。
            throw err;
        }
        if (!user) {
            throw new UnauthorizedException("登录已过期，请重新登录");
        }
        return user as TUser;
    }
}

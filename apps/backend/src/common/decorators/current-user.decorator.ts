import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../types/auth-user';

/** 取 JwtAuthGuard 挂载的会话用户 */
export const CurrentUser = createParamDecorator(
    (_data: undefined, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

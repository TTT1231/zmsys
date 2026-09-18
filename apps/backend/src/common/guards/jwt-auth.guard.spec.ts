import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from './jwt-auth.guard';

function createContext(isPublic: boolean) {
    const reflector = {
        getAllAndOverride: vi.fn().mockReturnValue(isPublic ? true : undefined),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const ctx = {
        getHandler: () => () => undefined,
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    return { guard, ctx };
}

describe('JwtAuthGuard', () => {
    it('@Public 端点直接放行，不进入 passport 校验', () => {
        const { guard, ctx } = createContext(true);
        expect(guard.canActivate(ctx)).toBe(true);
    });

    it('handleRequest 无用户时抛统一中文 401 文案', () => {
        const { guard } = createContext(false);
        expect(() => guard.handleRequest(null, undefined)).toThrow(new UnauthorizedException('登录已过期，请重新登录'));
    });

    it('handleRequest 透传 validate 产出的会话用户', () => {
        const { guard } = createContext(false);
        const user = { id: '1', isSuper: true };
        expect(guard.handleRequest(null, user)).toBe(user);
    });
});

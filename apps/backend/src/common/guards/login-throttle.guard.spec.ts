import { ExecutionContext, HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { LoginThrottleGuard } from './login-throttle.guard';

function createContext(ip: string, account: string) {
    const guard = new LoginThrottleGuard();
    const ctx = {
        getHandler: () => () => undefined,
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => ({ ip, body: { account } }) }),
    } as unknown as ExecutionContext;
    return { guard, ctx };
}

describe('LoginThrottleGuard（登录限流）', () => {
    it('窗口内未超阈值放行', () => {
        const { guard, ctx } = createContext('1.2.3.4', 'guojun');
        for (let i = 0; i < LoginThrottleGuard.maxAttempts; i++) {
            expect(guard.canActivate(ctx)).toBe(true);
        }
    });

    it('窗口内超过阈值抛 429', () => {
        const { guard, ctx } = createContext('1.2.3.4', 'guojun');
        for (let i = 0; i < LoginThrottleGuard.maxAttempts; i++) {
            guard.canActivate(ctx);
        }
        expect(() => guard.canActivate(ctx)).toThrow(HttpException);
        try {
            guard.canActivate(ctx);
        } catch (error) {
            expect((error as HttpException).getStatus()).toBe(429);
        }
    });

    it('不同 IP / 账号各自独立计数', () => {
        const a = createContext('1.1.1.1', 'guojun');
        const b = createContext('2.2.2.2', 'guojun');
        for (let i = 0; i < LoginThrottleGuard.maxAttempts; i++) {
            a.guard.canActivate(a.ctx);
        }
        expect(b.guard.canActivate(b.ctx)).toBe(true);
    });
});

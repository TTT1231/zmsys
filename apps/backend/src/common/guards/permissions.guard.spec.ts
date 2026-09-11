import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { PermissionsGuard } from './permissions.guard';
import type { AuthUser } from '../types/auth-user';

function createContext(user: AuthUser | undefined, metadata: unknown) {
    const reflector = {
        getAllAndOverride: () => metadata,
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    const ctx = {
        getHandler: () => () => undefined,
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    return { guard, ctx };
}

const superUser: AuthUser = {
    id: '1',
    account: 'guojun',
    name: '郭均',
    role: 'super',
    isSuper: true,
    rowVersion: 1,
    permissions: new Set(),
};

const staffUser: AuthUser = {
    id: '2',
    account: 'test',
    name: '测试员工',
    role: 'staff',
    isSuper: false,
    rowVersion: 1,
    permissions: new Set(['menu:workbench', 'orders:view']),
};

describe('PermissionsGuard', () => {
    it('未声明权限码的端点仅需登录', () => {
        const { guard, ctx } = createContext(staffUser, undefined);
        expect(guard.canActivate(ctx)).toBe(true);
    });

    it('super 直通所有权限码', () => {
        const { guard, ctx } = createContext(superUser, {
            codes: ['permissions:view'],
            message: '无权',
        });
        expect(guard.canActivate(ctx)).toBe(true);
    });

    it('持有全部要求权限码时放行', () => {
        const { guard, ctx } = createContext(staffUser, {
            codes: ['orders:view'],
            message: '无权',
        });
        expect(guard.canActivate(ctx)).toBe(true);
    });

    it('缺少任一权限码时抛出 403 并携带端点文案', () => {
        const { guard, ctx } = createContext(staffUser, {
            codes: ['permissions:view'],
            message: '无权查看角色',
        });
        expect(() => guard.canActivate(ctx)).toThrow(new ForbiddenException('无权查看角色'));
    });

    it('要求多个权限码时任一缺失即拒绝', () => {
        const { guard, ctx } = createContext(staffUser, {
            codes: ['orders:view', 'permissions:manage'],
            message: '无权',
        });
        expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
});

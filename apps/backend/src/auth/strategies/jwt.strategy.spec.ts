import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';

const baseUser = {
    id: 1n,
    account: 'guojun',
    name: '郭均',
    roleCode: 'sales',
    status: true,
    tokenVersion: 2n,
    rowVersion: 1n,
};

function createStrategy(user: unknown, grants: { permissionCode: string }[] = []) {
    const configService = {
        getOrThrow: vi.fn((key: string) => ({ 'jwt.secret': 's', 'jwt.issuer': 'i', 'jwt.audience': 'a' })[key]),
    } as never;
    const prisma = {
        sysUser: { findUnique: vi.fn().mockResolvedValue(user) },
        sysGrant: { findMany: vi.fn().mockResolvedValue(grants) },
    } as unknown as PrismaService;
    return { strategy: new JwtStrategy(configService, prisma), prisma };
}

describe('JwtStrategy.validate（每次请求回查数据库）', () => {
    let grants: { permissionCode: string }[];

    beforeEach(() => {
        grants = [{ permissionCode: 'orders:view' }, { permissionCode: 'orders:create' }];
    });

    it('用户不存在立即拒绝', async () => {
        const { strategy } = createStrategy(null);
        await expect(strategy.validate({ sub: '404', ver: 1, iat: 0, exp: 0, jti: 'x' })).rejects.toThrow(
            new UnauthorizedException('登录已过期，请重新登录'),
        );
    });

    it('停用账号的旧 JWT 立即拒绝', async () => {
        const { strategy } = createStrategy({ ...baseUser, status: false });
        await expect(strategy.validate({ sub: '1', ver: 2, iat: 0, exp: 0, jti: 'x' })).rejects.toThrow(
            UnauthorizedException,
        );
    });

    it('token_version 落后于数据库（已改密）立即拒绝', async () => {
        const { strategy } = createStrategy(baseUser);
        await expect(strategy.validate({ sub: '1', ver: 1, iat: 0, exp: 0, jti: 'x' })).rejects.toThrow(
            UnauthorizedException,
        );
    });

    it('super 角色不查授权行，直接视为全量', async () => {
        const { strategy, prisma } = createStrategy({ ...baseUser, roleCode: 'super' });
        const result = await strategy.validate({ sub: '1', ver: 2, iat: 0, exp: 0, jti: 'x' });
        expect(result.isSuper).toBe(true);
        expect(result.permissions.size).toBe(0);
        expect(prisma.sysGrant.findMany).not.toHaveBeenCalled();
    });

    it('普通角色加载实时授权码集合，id 序列化为字符串', async () => {
        const { strategy } = createStrategy(baseUser, grants);
        const result = await strategy.validate({ sub: '1', ver: 2, iat: 0, exp: 0, jti: 'x' });
        expect(result.id).toBe('1');
        expect(result.role).toBe('sales');
        expect(result.isSuper).toBe(false);
        expect(result.permissions.has('orders:view')).toBe(true);
        expect(result.permissions.has('orders:cancel')).toBe(false);
    });
});

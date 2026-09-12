import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionRunner } from '../prisma/transaction.runner';
import { AccessControlService } from '../access-control/access-control.service';
import { SnowflakeGenerator } from '../common/snowflake';

function createAuthService(user: unknown) {
    const prisma = {
        sysUser: {
            findUnique: vi.fn().mockResolvedValue(user),
            update: vi.fn().mockResolvedValue(user),
        },
        $transaction: vi.fn(),
    } as unknown as PrismaService;
    const jwtService = {
        signAsync: vi.fn().mockResolvedValue('test-token'),
    } as unknown as JwtService;
    const accessControl = {} as AccessControlService;
    const snowflake = { next: vi.fn().mockReturnValue(1n) } as unknown as SnowflakeGenerator;
    return { service: new AuthService(prisma, jwtService, accessControl, snowflake, new TransactionRunner(prisma)) };
}

const activeUser = {
    id: 1n,
    account: 'guojun',
    name: '郭均',
    roleCode: 'super',
    status: true,
    tokenVersion: 1n,
    rowVersion: 1n,
    passwordHash: bcrypt.hashSync('123456', 4),
    passwordChangedAt: null,
    lastLoginAt: null,
};

describe('AuthService.login', () => {
    let service: AuthService;

    beforeEach(() => {
        ({ service } = createAuthService(activeUser));
    });

    it('凭据正确时签发 accessToken 并返回用户展示对象', async () => {
        const result = await service.login({
            account: 'guojun',
            password: '123456',
        });
        expect(result.accessToken).toBe('test-token');
        expect(result.user).toMatchObject({
            account: 'guojun',
            role: 'super',
            active: true,
        });
        // JWT 载荷包含 sub（id 字符串）与 ver（token_version）
        expect(result.user.version).toBe(1);
    });

    it('密码错误时抛出统一文案的 400，不泄露差异', async () => {
        await expect(service.login({ account: 'guojun', password: 'wrong' })).rejects.toThrow(
            new BadRequestException('账号或密码错误'),
        );
    });

    it('停用账号与凭据错误返回相同文案，避免账号枚举', async () => {
        ({ service } = createAuthService({ ...activeUser, status: false }));
        await expect(service.login({ account: 'guojun', password: '123456' })).rejects.toThrow(
            new BadRequestException('账号或密码错误'),
        );
    });

    it('账号不存在时也走一次哈希比较后拒绝', async () => {
        ({ service } = createAuthService(null));
        await expect(service.login({ account: 'nobody', password: '123456' })).rejects.toThrow(
            new BadRequestException('账号或密码错误'),
        );
    });
});

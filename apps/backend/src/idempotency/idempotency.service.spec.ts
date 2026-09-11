import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { IdempotencyService } from './idempotency.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SnowflakeGenerator } from '../common/snowflake';
import { isMarkedRetryable } from '../common/errors/transaction-retry-exhausted.error';

const prismaKnownError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('prisma error', { code, clientVersion: 'test' });

function createService() {
    const prisma = {
        apiIdempotency: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
    } as unknown as PrismaService;
    const snowflake = { next: vi.fn().mockReturnValue(1001n) } as unknown as SnowflakeGenerator;
    const service = new IdempotencyService(prisma, snowflake);
    const tx = {
        apiIdempotency: {
            findUnique: vi.fn(),
            create: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
        },
    };
    return { service, prisma, snowflake, tx };
}

const PARAMS = {
    actorId: 1n,
    operationKey: 'order:create',
    key: 'abc12345',
    requestHash: new Uint8Array(Buffer.alloc(32, 7)),
};

const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

describe('IdempotencyService.requireKey（契约 ^[!-~]{8,128}$）', () => {
    const service = createService().service;

    it('缺失、空串、7 位、129 位均 400', () => {
        expect(() => service.requireKey(undefined)).toThrow(BadRequestException);
        expect(() => service.requireKey('')).toThrow(BadRequestException);
        expect(() => service.requireKey('abc1234')).toThrow(BadRequestException);
        expect(() => service.requireKey('x'.repeat(129))).toThrow(BadRequestException);
    });

    it('空格、Tab、换行等控制字符与中文拒绝（不止“非 ASCII”）', () => {
        expect(() => service.requireKey('abc 1234')).toThrow(BadRequestException);
        expect(() => service.requireKey('abc\t1234')).toThrow(BadRequestException);
        expect(() => service.requireKey('abc\n1234')).toThrow(BadRequestException);
        expect(() => service.requireKey('幂等键八个字')).toThrow(BadRequestException);
    });

    it('8 与 128 个可见 ASCII 合法（两侧包边字符 ! 和 ~）', () => {
        expect(service.requireKey('abcdefgh')).toBe('abcdefgh');
        expect(service.requireKey('!!!!!!!!')).toBe('!!!!!!!!');
        expect(service.requireKey('~~~~~~~~')).toBe('~~~~~~~~');
        expect(service.requireKey('x'.repeat(128))).toBe('x'.repeat(128));
    });
});

describe('IdempotencyService.digest（method/路径参数/query/body 覆盖面）', () => {
    const service = createService().service;

    it('输出恰为 32 字节且同输入稳定', () => {
        const a = service.digest({ method: 'POST', body: { x: 1 } });
        const b = service.digest({ method: 'POST', body: { x: 1 } });
        expect(a).toHaveLength(32);
        expect(eq(a, b)).toBe(true);
    });

    it('对象键序无关：body 键序不同摘要一致', () => {
        const a = service.digest({ method: 'POST', body: { x: 1, y: { b: 2, a: 3 } } });
        const b = service.digest({ method: 'POST', body: { y: { a: 3, b: 2 }, x: 1 } });
        expect(eq(a, b)).toBe(true);
    });

    it('数组顺序敏感：顺序不同摘要不同', () => {
        const a = service.digest({ method: 'POST', body: [1, 2] });
        const b = service.digest({ method: 'POST', body: [2, 1] });
        expect(eq(a, b)).toBe(false);
    });

    it('method、路径参数、query、body 任一不同摘要即不同', () => {
        const base = service.digest({ method: 'POST', pathParams: { id: 'A' }, query: { page: 1 }, body: { x: 1 } });
        expect(
            eq(base, service.digest({ method: 'PUT', pathParams: { id: 'A' }, query: { page: 1 }, body: { x: 1 } })),
        ).toBe(false);
        expect(
            eq(base, service.digest({ method: 'POST', pathParams: { id: 'B' }, query: { page: 1 }, body: { x: 1 } })),
        ).toBe(false);
        expect(
            eq(base, service.digest({ method: 'POST', pathParams: { id: 'A' }, query: { page: 2 }, body: { x: 1 } })),
        ).toBe(false);
        expect(
            eq(base, service.digest({ method: 'POST', pathParams: { id: 'A' }, query: { page: 1 }, body: { x: 2 } })),
        ).toBe(false);
    });
});

describe('IdempotencyService.beginOrReplay（事务内占位/重放/冲突）', () => {
    it('无记录：写 PROCESSING 占位并返回 placeholderId', async () => {
        const { service, tx, snowflake } = createService();
        tx.apiIdempotency.findUnique.mockResolvedValue(null);

        const result = await service.beginOrReplay(tx as never, PARAMS);

        expect(result.replay).toBeNull();
        expect(result.placeholderId).toBe(1001n);
        expect(tx.apiIdempotency.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ state: 'PROCESSING', expiresAt: expect.any(Date) }),
        });
        expect(snowflake.next).toHaveBeenCalledOnce();
    });

    it('已 SUCCEEDED 且摘要一致：返回重放体，不写占位', async () => {
        const { service, tx } = createService();
        tx.apiIdempotency.findUnique.mockResolvedValue({
            state: 'SUCCEEDED',
            requestHash: PARAMS.requestHash,
            httpStatus: 200,
            responseJson: { code: 'ZM260911001' },
        });

        const result = await service.beginOrReplay(tx as never, PARAMS);

        expect(result.replay).toEqual({ httpStatus: 200, body: { code: 'ZM260911001' } });
        expect(result.placeholderId).toBeNull();
        expect(tx.apiIdempotency.create).not.toHaveBeenCalled();
    });

    it('同 key 摘要不一致：409', async () => {
        const { service, tx } = createService();
        tx.apiIdempotency.findUnique.mockResolvedValue({
            state: 'SUCCEEDED',
            requestHash: Buffer.alloc(32, 9), // 不同摘要
            httpStatus: 200,
            responseJson: {},
        });
        await expect(service.beginOrReplay(tx as never, PARAMS)).rejects.toThrow(ConflictException);
    });

    it('PROCESSING 残留：409 提示稍后重试', async () => {
        const { service, tx } = createService();
        tx.apiIdempotency.findUnique.mockResolvedValue({
            state: 'PROCESSING',
            requestHash: PARAMS.requestHash,
            httpStatus: null,
            responseJson: null,
        });
        await expect(service.beginOrReplay(tx as never, PARAMS)).rejects.toThrow('重复请求正在处理中');
    });

    it('占位撞唯一键（并发竞争）：抛带可重试标记的错误，交由整事务重试收敛', async () => {
        const { service, tx } = createService();
        tx.apiIdempotency.findUnique.mockResolvedValue(null);
        tx.apiIdempotency.create.mockRejectedValue(prismaKnownError('P2002'));

        const error = await service.beginOrReplay(tx as never, PARAMS).catch(e => e);

        expect(isMarkedRetryable(error)).toBe(true);
    });
});

describe('IdempotencyService.complete / cleanup', () => {
    it('complete：占位转 SUCCEEDED 并记录响应与资源标识', async () => {
        const { service, tx } = createService();
        await service.complete(tx as never, {
            id: 1001n,
            httpStatus: 200,
            responseBody: { code: 'ZM260911001' },
            resource: { type: 'order', code: 'ZM260911001' },
        });
        expect(tx.apiIdempotency.update).toHaveBeenCalledWith({
            where: { id: 1001n },
            data: {
                state: 'SUCCEEDED',
                httpStatus: 200,
                responseJson: { code: 'ZM260911001' },
                resourceType: 'order',
                resourceCode: 'ZM260911001',
            },
        });
    });

    it('cleanup：只按 expires_at 删除过期记录', async () => {
        const { service, prisma } = createService();
        const count = await service.cleanup();
        expect(count).toBe(3);
        expect(prisma.apiIdempotency.deleteMany).toHaveBeenCalledWith({
            where: { expiresAt: { lt: expect.any(Date) } },
        });
    });
});

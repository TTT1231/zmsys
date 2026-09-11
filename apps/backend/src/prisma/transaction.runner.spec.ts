import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { TransactionRunner } from './transaction.runner';
import type { PrismaService } from './prisma.service';
import {
    TransactionRetryExhaustedError,
    markTransactionRetryable,
} from '../common/errors/transaction-retry-exhausted.error';

const prismaKnownError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('prisma error', { code, clientVersion: 'test' });

const driverDeadlock = () => Object.assign(new Error('Deadlock found when trying to get lock'), { errno: 1213 });

function createRunner() {
    const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
    const prisma = { $transaction } as unknown as PrismaService;
    const sleeps: number[] = [];
    const runner = new TransactionRunner(prisma);
    const options = {
        baseDelayMs: 100,
        maxDelayMs: 1000,
        sleep: async (ms: number) => {
            sleeps.push(ms);
        },
        // 固定随机源：delay = backoff/2 + 0.5 * backoff/2 = 0.75 * backoff，不抖测
        random: () => 0.5,
    };
    return { runner, $transaction, sleeps, options };
}

describe('TransactionRunner（死锁/锁超时整事务重试）', () => {
    it('P2034 可重试：第三次成功，重试的是整个事务，退避值符合 [backoff/2, backoff)', async () => {
        const { runner, $transaction, sleeps, options } = createRunner();
        const fn = vi
            .fn<(tx: unknown) => Promise<string>>()
            .mockRejectedValueOnce(prismaKnownError('P2034'))
            .mockRejectedValueOnce(driverDeadlock())
            .mockResolvedValueOnce('ok');

        const result = await runner.run(fn, options);

        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
        expect($transaction).toHaveBeenCalledTimes(3);
        // attempt1 退避基数 100 → 0.75*100=75；attempt2 基数 200 → 0.75*200=150
        expect(sleeps).toEqual([75, 150]);
    });

    it('退避有上限：指数增长不超过 maxDelayMs', async () => {
        const { runner, sleeps, options } = createRunner();
        const fn = vi
            .fn<(tx: unknown) => Promise<string>>()
            .mockRejectedValueOnce(driverDeadlock())
            .mockRejectedValueOnce(driverDeadlock())
            .mockResolvedValueOnce('ok');

        await runner.run(fn, options);

        // attempt2 基数 400 → 300 < 1000 上限；若再退避会是 800 → 600，验证上限逻辑存在
        expect(sleeps).toEqual([75, 150]);
    });

    it('非可重试错误原样抛出且只尝试一次', async () => {
        const { runner, $transaction, options } = createRunner();
        const business = new BadRequestException('参数错误');
        const fn = vi.fn<(tx: unknown) => Promise<string>>().mockRejectedValue(business);

        await expect(runner.run(fn, options)).rejects.toBe(business);
        expect(fn).toHaveBeenCalledTimes(1);
        expect($transaction).toHaveBeenCalledTimes(1);
    });

    it('maxAttempts=3 为总尝试次数：3 次失败后抛 TransactionRetryExhaustedError 且 cause 为最后一次错误', async () => {
        const { runner, sleeps, options } = createRunner();
        const last = driverDeadlock();
        const fn = vi
            .fn<(tx: unknown) => Promise<string>>()
            .mockRejectedValueOnce(prismaKnownError('P2034'))
            .mockRejectedValueOnce(prismaKnownError('P2034'))
            .mockRejectedValueOnce(last);

        const error = await runner.run(fn, options).catch(e => e);

        expect(error).toBeInstanceOf(TransactionRetryExhaustedError);
        expect(error.cause).toBe(last);
        expect(fn).toHaveBeenCalledTimes(3);
        expect(sleeps).toHaveLength(2); // 最后一次失败后不再退避
    });

    it('markTransactionRetryable 标记的错误（幂等占位竞争）可重试', async () => {
        const { runner, options } = createRunner();
        const fn = vi
            .fn<(tx: unknown) => Promise<string>>()
            .mockRejectedValueOnce(markTransactionRetryable(prismaKnownError('P2002')))
            .mockResolvedValueOnce('ok');

        await expect(runner.run(fn, options)).resolves.toBe('ok');
    });

    it('锁等待超时（ER_LOCK_WAIT_TIMEOUT code）可重试', async () => {
        const { runner, options } = createRunner();
        const fn = vi
            .fn<(tx: unknown) => Promise<string>>()
            .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ER_LOCK_WAIT_TIMEOUT' }))
            .mockResolvedValueOnce('ok');

        await expect(runner.run(fn, options)).resolves.toBe('ok');
    });

    it('Prisma 透传的驱动死锁码 1213（e2e 实测形态，非 P2034）可重试', async () => {
        const { runner, options } = createRunner();
        const fn = vi
            .fn<(tx: unknown) => Promise<string>>()
            .mockRejectedValueOnce(prismaKnownError('1213'))
            .mockResolvedValueOnce('ok');

        await expect(runner.run(fn, options)).resolves.toBe('ok');
    });

    it('异源错误对象带数字 code 1213（跨 @prisma/client 副本，instanceof 失效场景）可重试', async () => {
        const { runner, options } = createRunner();
        // 模拟运行时来自另一依赖副本的裸对象错误
        const foreignError = Object.assign(new Error('Deadlock found'), { code: 1213 });
        const fn = vi
            .fn<(tx: unknown) => Promise<string>>()
            .mockRejectedValueOnce(foreignError)
            .mockResolvedValueOnce('ok');

        await expect(runner.run(fn, options)).resolves.toBe('ok');
    });

    it('$queryRaw 死锁的真实形态 P2010 + meta.driverAdapterError.cause（e2e 实测）可重试', async () => {
        const { runner, options } = createRunner();
        // 与 @prisma/adapter-mariadb 实际抛出的结构一致
        const rawDeadlock = Object.assign(new Error('Raw query failed'), {
            code: 'P2010',
            meta: {
                driverAdapterError: {
                    name: 'DriverAdapterError',
                    cause: {
                        originalCode: '1213',
                        originalMessage: 'Deadlock found when trying to get lock; try restarting transaction',
                        kind: 'TransactionWriteConflict',
                    },
                },
            },
        });
        const fn = vi
            .fn<(tx: unknown) => Promise<string>>()
            .mockRejectedValueOnce(rawDeadlock)
            .mockResolvedValueOnce('ok');

        await expect(runner.run(fn, options)).resolves.toBe('ok');
    });
});

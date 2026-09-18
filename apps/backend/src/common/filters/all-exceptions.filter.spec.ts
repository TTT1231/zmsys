import { ArgumentsHost, BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { TransactionRetryExhaustedError } from '../errors/transaction-retry-exhausted.error';

function runFilter(exception: unknown) {
    const send = vi.fn();
    const response = { status: vi.fn((_code: number) => ({ send })) };
    const host = {
        switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ id: 'req-42' }) }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(exception, host);
    const statusArg = response.status.mock.calls[0][0];
    return { statusCode: statusArg, body: send.mock.calls[0][0] };
}

function prismaKnownError(code: string, meta?: Record<string, unknown>) {
    return new Prisma.PrismaClientKnownRequestError('prisma error', {
        code,
        clientVersion: '7.10.0',
        meta,
    });
}

describe('AllExceptionsFilter（统一错误信封与数据库错误映射）', () => {
    it('字符串 message 的 HttpException', () => {
        const { statusCode, body } = runFilter(new BadRequestException('参数错误'));
        expect(statusCode).toBe(400);
        expect(body).toEqual({ code: 400, data: null, message: '参数错误' });
    });

    it('ValidationPipe 的 message 数组拼接为一句', () => {
        const exception = new HttpException(
            { statusCode: 400, message: ['账号为 3–64 位字母、数字或下划线', '请输入密码'] },
            400,
        );
        const { statusCode, body } = runFilter(exception);
        expect(statusCode).toBe(400);
        expect(body.message).toBe('账号为 3–64 位字母、数字或下划线；请输入密码');
    });

    it('未知异常返回 500 且不泄露内部细节', () => {
        const { statusCode, body } = runFilter(new Error('数据库连接串泄密'));
        expect(statusCode).toBe(500);
        expect(body).toEqual({ code: 500, data: null, message: '服务器内部错误' });
    });

    it('P2002 唯一冲突映射 409 并带出冲突字段', () => {
        const { statusCode, body } = runFilter(prismaKnownError('P2002', { target: ['account'] }));
        expect(statusCode).toBe(409);
        expect(body.message).toBe('数据已存在（account）');
    });

    it('P2025 记录不存在映射 404', () => {
        const { statusCode, body } = runFilter(prismaKnownError('P2025'));
        expect(statusCode).toBe(404);
        expect(body.message).toBe('记录不存在或已被删除');
    });

    it('P2034 事务冲突映射 503', () => {
        const { statusCode, body } = runFilter(prismaKnownError('P2034'));
        expect(statusCode).toBe(503);
        expect(body.message).toBe('并发冲突，请稍后重试');
    });

    it('未映射的 Prisma 错误码（如 P2003）落 500 且不泄露细节', () => {
        const { statusCode, body } = runFilter(prismaKnownError('P2003', { field_name: 'role_code' }));
        expect(statusCode).toBe(500);
        expect(body).toEqual({ code: 500, data: null, message: '服务器内部错误' });
    });

    it('MariaDB 死锁（errno 1213）映射 503', () => {
        const { statusCode, body } = runFilter(Object.assign(new Error('Deadlock found'), { errno: 1213 }));
        expect(statusCode).toBe(503);
        expect(body.message).toBe('数据库锁冲突，请稍后重试');
    });

    it('MariaDB 锁等待超时（code ER_LOCK_WAIT_TIMEOUT）映射 503', () => {
        const { statusCode, body } = runFilter(Object.assign(new Error('timeout'), { code: 'ER_LOCK_WAIT_TIMEOUT' }));
        expect(statusCode).toBe(503);
        expect(body.message).toBe('数据库锁冲突，请稍后重试');
    });

    it('事务重试耗尽错误映射 503', () => {
        const cause = Object.assign(new Error('deadlock'), { errno: 1213 });
        const { statusCode, body } = runFilter(new TransactionRetryExhaustedError(cause, 3));
        expect(statusCode).toBe(503);
        expect(body.message).toBe('并发冲突，请稍后重试');
    });

    it('500 分支记录原始异常日志（含 requestId）', () => {
        const send = vi.fn();
        const response = { status: vi.fn(() => ({ send })) };
        const host = {
            switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ id: 'req-7' }) }),
        } as unknown as ArgumentsHost;
        const filter = new AllExceptionsFilter();
        const errorSpy = vi.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
        filter.catch(new Error('原始内部错误'), host);
        expect(errorSpy).toHaveBeenCalledOnce();
        const [message] = errorSpy.mock.calls[0];
        expect(String(message)).toContain('req-7');
        expect(String(message)).toContain('原始内部错误');
        errorSpy.mockRestore();
    });
});

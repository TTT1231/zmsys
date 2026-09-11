import { ArgumentsHost, BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter';

function runFilter(exception: unknown) {
    const send = vi.fn();
    const response = { status: vi.fn((_code: number) => ({ send })) };
    const host = {
        switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(exception, host);
    const statusArg = response.status.mock.calls[0][0];
    return { statusCode: statusArg, body: send.mock.calls[0][0] };
}

describe('AllExceptionsFilter（统一错误信封）', () => {
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
});

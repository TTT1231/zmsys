import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { TransformInterceptor } from './transform.interceptor';

const interceptor = new TransformInterceptor<unknown>();

function run(data: unknown) {
    return firstValueFrom(interceptor.intercept({} as never, { handle: () => of(data) }));
}

describe('TransformInterceptor（统一响应信封）', () => {
    it('包装成功数据为 {code: 0, data, message: "ok"}', async () => {
        await expect(run({ hello: 'world' })).resolves.toEqual({
            code: 0,
            data: { hello: 'world' },
            message: 'ok',
        });
    });

    it('undefined 数据规范化为 null（幂等退出等空响应）', async () => {
        await expect(run(undefined)).resolves.toEqual({ code: 0, data: null, message: 'ok' });
    });

    it('BigInt 安全范围内转 number（契约 version: integer；直接 JSON.stringify 会抛 TypeError）', async () => {
        const result = await run({ version: 3n, nested: { rowVersion: 100n }, list: [7n, 'x'] });
        expect(result.data).toEqual({ version: 3, nested: { rowVersion: 100 }, list: [7, 'x'] });
    });

    it('BigInt 超出 ±2^53（Snowflake 主键）转十进制字符串，不丢精度', async () => {
        const snowflake = 7_000_000_000_000_000_001n;
        const result = await run({ id: snowflake });
        expect(result.data).toEqual({ id: '7000000000000000001' });
    });

    it('Date 实例原样保留（date-time 字段由序列化层输出 ISO）', async () => {
        const at = new Date('2026-09-12T08:00:00.000Z');
        const result = await run({ cancelledAt: at });
        expect((result.data as { cancelledAt: Date }).cancelledAt).toBe(at);
    });
});

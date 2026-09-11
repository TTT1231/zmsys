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
});

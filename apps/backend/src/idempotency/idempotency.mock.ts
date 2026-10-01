import { BadRequestException } from "@nestjs/common";
import { vi } from "vitest";
import type { BeginResult, IdempotencyService } from "./idempotency.service";

export type BeginFn = (tx: unknown, params: unknown) => Promise<BeginResult>;
type TxRunLike = (fn: (tx: never) => Promise<unknown>) => Promise<unknown>;

/**
 * runGuarded 时代的幂等服务假件（各服务 spec 共用）：runGuarded/runGuardedVoid
 * 在 mock 内按服务真实序言展开（键校验 → 事务 → beginOrReplay → 重放短路 →
 * 占位检查 → 业务回调 → complete），保留原有 beginOrReplay/complete 注入点，
 * 重放与占位用例零迁移。
 */
export const mkIdempotencyMock = (run: TxRunLike, beginOrReplay?: BeginFn) => {
    const requireKey = vi.fn((key?: string) => {
        if (!key || key.length < 8) {
            throw new BadRequestException("Idempotency-Key 必须为 8–128 个可见 ASCII 字符");
        }
        return key;
    });
    const digest = vi.fn(() => new Uint8Array(32));
    const requestKey = vi.fn(() => "a".repeat(64));
    const begin =
        beginOrReplay ??
        (vi.fn(async () => ({ replay: null, placeholderId: 8000000000000000n })) as unknown as BeginFn);
    const complete = vi.fn();

    const runGuarded = vi.fn(
        async (
            params: { idempotencyKey?: string },
            fn: (
                tx: never,
                guard: { placeholderId: bigint; idempotencyKey: string },
            ) => Promise<{ httpStatus: number; responseBody: unknown; resource?: { type: string; code: string } }>,
        ) => {
            const key = requireKey(params.idempotencyKey);
            digest();
            return run(async tx => {
                const { replay, placeholderId } = await begin(tx, { key });
                if (replay) {
                    return replay.body;
                }
                if (placeholderId === null) {
                    throw new Error("幂等占位缺失");
                }
                const guarded = await fn(tx, { placeholderId, idempotencyKey: key });
                await complete(tx, { id: placeholderId, ...guarded });
                return guarded.responseBody;
            });
        },
    );

    const runGuardedVoid = vi.fn(
        async (
            params: { idempotencyKey?: string },
            fn: (
                tx: never,
                guard: { placeholderId: bigint; idempotencyKey: string },
            ) => Promise<{ httpStatus: number; responseBody: unknown; resource?: { type: string; code: string } }>,
        ) => {
            const key = requireKey(params.idempotencyKey);
            digest();
            return run(async tx => {
                const { replay, placeholderId } = await begin(tx, { key });
                if (replay || placeholderId === null) {
                    return null;
                }
                const guarded = await fn(tx, { placeholderId, idempotencyKey: key });
                await complete(tx, { id: placeholderId, ...guarded });
                return null;
            });
        },
    );

    return {
        requireKey,
        digest,
        requestKey,
        beginOrReplay: begin,
        complete,
        runGuarded,
        runGuardedVoid,
    } as unknown as IdempotencyService & Record<string, ReturnType<typeof vi.fn>>;
};

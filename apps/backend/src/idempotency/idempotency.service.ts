import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import type { Tx } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import { markTransactionRetryable } from "../common/errors/transaction-retry-exhausted.error";

/** 契约：Idempotency-Key 为 8–128 个可见 ASCII 字符（db-scheme.md §1.3，^[!-~]+$） */
const KEY_PATTERN = /^[!-~]{8,128}$/;

/** 幂等记录保留时长：契约要求至少 24 小时，取 48 小时留清理余量 */
const RETENTION_MS = 48 * 60 * 60 * 1000;

/** 请求摘要输入：method + 路径参数 + query + DTO 转换后的 body，任一不同即不同请求 */
export interface DigestInput {
    method: string;
    pathParams?: Record<string, string | number>;
    query?: Record<string, unknown>;
    body?: unknown;
}

/** 重放的既有成功响应 */
export interface StoredReplay {
    httpStatus: number;
    body: Prisma.InputJsonValue;
}

/** runGuarded 业务回调的产物：complete 所需的成功三要素 */
export interface GuardedResult<T> {
    httpStatus: number;
    responseBody: T;
    resource?: { type: string; code: string };
}

/** runGuarded 回调上下文：占位 id 与校验后的原始键（业务行 request_key 派生用） */
export interface GuardContext {
    placeholderId: bigint;
    idempotencyKey: string;
}

/** runGuarded/runGuardedVoid 的公共参数（键校验、摘要与幂等三元组由服务内折叠） */
export interface RunGuardedParams {
    actorId: bigint;
    operationKey: string;
    /** 控制器透传的 Idempotency-Key 头（requireKey 校验收口于此） */
    idempotencyKey: string | undefined;
    digest: DigestInput;
}

/** beginOrReplay 结果：replay 非空时直接重放，不得再执行业务；否则用 placeholderId 调 complete */
export interface BeginResult {
    replay: StoredReplay | null;
    placeholderId: bigint | null;
}

/**
 * 递归规范化（db-scheme.md：同 key 同 body 但路径不同必须判为不同请求）。
 * 每个值先打类型标签再交给 JSON.stringify：Date/BigInt/undefined 等非 JSON
 * 原生类型不会退化为 {}（旧实现两个不同日期摘要相同）也不会让 stringify 抛
 * TypeError；整棵树都被 $ 标签包裹，body 里的普通对象无法伪造与其他类型的碰撞。
 */
const canonicalize = (value: unknown): unknown => {
    if (value === null) {
        return { $null: 1 };
    }
    switch (typeof value) {
        case "undefined":
            return { $undefined: 1 };
        case "string":
            return { $string: value };
        case "number":
            // String(number) 往返精确；NaN/Infinity 不像 JSON.stringify 那样退化成 null
            return { $number: String(value) };
        case "bigint":
            return { $bigint: value.toString() };
        case "boolean":
            return { $boolean: value };
        case "object":
            if (value instanceof Date) {
                return { $date: value.toISOString() };
            }
            if (Array.isArray(value)) {
                return { $array: value.map(canonicalize) };
            }
            return {
                $object: Object.entries(value as Record<string, unknown>)
                    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                    .map(([key, item]) => [key, canonicalize(item)]),
            };
        default:
            // function/symbol 不可能来自 JSON DTO，出现即程序性缺陷：快速失败优于静默丢字段
            throw new Error(`请求摘要遇到不可序列化的值类型：${typeof value}`);
    }
};

/** 字节比较（Prisma Bytes 列读取为 Uint8Array，统一在此比较而非依赖 Buffer 方法） */
const bytesEqual = (a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): boolean =>
    a.length === b.length && a.every((byte, index) => byte === b[index]);

/**
 * 幂等服务（db-scheme.md §1.3）：占位写入与业务写入处于同一事务——
 * 首请求回滚时占位一并回滚，允许安全重试；首请求提交后响应丢失时，重试从 response_json 重放。
 * 并发竞争（唯一键冲突）由 TransactionRunner 对整个事务重试后按已提交结果收敛：
 * 胜者执行业务，败者重放或按摘要冲突返回 409，保证“恰一次提交业务效果”。
 */
@Injectable()
export class IdempotencyService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly snowflake: SnowflakeGenerator,
        private readonly txRunner: TransactionRunner,
    ) {}

    /** 校验并返回 Idempotency-Key；缺失/含控制字符/超长一律 400 */
    requireKey(header: string | undefined): string {
        const key = header?.trim() ?? "";
        if (!KEY_PATTERN.test(key)) {
            throw new BadRequestException("Idempotency-Key 必须为 8–128 个可见 ASCII 字符");
        }
        return key;
    }

    /** 请求摘要：SHA-256 → 32 字节（对应 BINARY(32)），覆盖 method/路径参数/query/规范化 body */
    digest(input: DigestInput): Uint8Array<ArrayBuffer> {
        const payload = canonicalize({
            m: input.method,
            p: input.pathParams ?? {},
            q: input.query ?? {},
            b: input.body ?? null,
        });
        return new Uint8Array(createHash("sha256").update(JSON.stringify(payload)).digest());
    }

    /**
     * 业务行 request_key（VARCHAR(128) 全局唯一，CHECK 8–128 ASCII）的派生值：
     * 幂等三元组以 \n 连接后的 SHA-256 十六进制（定长 64）。不能直接存原始
     * Idempotency-Key——api_idempotency 的唯一域含 actor_id，两个用户各自首次
     * 使用同一原始 key 时会在业务表的全局唯一键上相撞；哈希派生与幂等占位保持
     * 同一唯一域，且恒在长度约束内。三元组各字段均不含 \n（可见 ASCII），无拼接歧义。
     */
    requestKey(actorId: bigint, operationKey: string, idempotencyKey: string): string {
        return createHash("sha256").update(`${actorId}\n${operationKey}\n${idempotencyKey}`).digest("hex");
    }

    /**
     * 事务内开始或重放：
     * - 无记录：写入 PROCESSING 占位，返回 replay=null，调用方继续业务写入；
     * - 已 SUCCEEDED 且摘要一致：返回重放体，调用方不得执行业务；
     * - 摘要不一致：409；
     * - INSERT 撞唯一键（并发竞争）：标记可重试抛出，事务重试后按已提交结果收敛。
     */
    async beginOrReplay(
        tx: Tx,
        params: {
            actorId: bigint;
            operationKey: string;
            key: string;
            requestHash: Uint8Array<ArrayBuffer>;
        },
    ): Promise<BeginResult> {
        const where = {
            actorId_operationKey_idempotencyKey: {
                actorId: params.actorId,
                operationKey: params.operationKey,
                idempotencyKey: params.key,
            },
        };
        const existing = await tx.apiIdempotency.findUnique({ where });
        if (existing) {
            if (!bytesEqual(existing.requestHash, params.requestHash)) {
                throw new ConflictException("幂等键已被其他请求使用");
            }
            if (existing.state === "SUCCEEDED") {
                return {
                    replay: {
                        httpStatus: existing.httpStatus ?? 200,
                        body: (existing.responseJson ?? {}) as Prisma.InputJsonValue,
                    },
                    placeholderId: null,
                };
            }
            // PROCESSING 只存在于未提交事务中；已提交数据出现该状态说明异常残留
            throw new ConflictException("重复请求正在处理中，请稍后重试");
        }
        const placeholderId = this.snowflake.next();
        const now = new Date();
        try {
            await tx.apiIdempotency.create({
                data: {
                    id: placeholderId,
                    actorId: params.actorId,
                    operationKey: params.operationKey,
                    idempotencyKey: params.key,
                    requestHash: params.requestHash,
                    state: "PROCESSING",
                    createdAt: now,
                    expiresAt: new Date(now.getTime() + RETENTION_MS),
                },
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                // 并发同 key：占位唯一键竞争，交由 TransactionRunner 重试整个事务后收敛到重放/409
                throw markTransactionRetryable(error);
            }
            throw error;
        }
        return { replay: null, placeholderId };
    }

    /** 事务内完成：占位转 SUCCEEDED 并记录响应体（契约 CHECK：2xx + JSON 对象） */
    async complete(
        tx: Tx,
        params: {
            id: bigint;
            httpStatus: number;
            responseBody: Prisma.InputJsonValue;
            resource?: { type: string; code: string };
        },
    ): Promise<void> {
        await tx.apiIdempotency.update({
            where: { id: params.id },
            data: {
                state: "SUCCEEDED",
                httpStatus: params.httpStatus,
                responseJson: params.responseBody,
                resourceType: params.resource?.type,
                resourceCode: params.resource?.code,
            },
        });
    }

    /** 清理过期记录：只按 expires_at 删除，不触碰保留期内的行 */
    async cleanup(): Promise<number> {
        const result = await this.prisma.apiIdempotency.deleteMany({
            where: { expiresAt: { lt: new Date() } },
        });
        return result.count;
    }

    /**
     * 幂等序言/收尾收口（此前同构样板在 6 个服务手写 14 处）：键校验 → 摘要 →
     * 事务（可重试）→ beginOrReplay → 命中重放直接返回原响应 → 占位 null 检查 →
     * 业务回调（同事务）→ complete 落响应快照 → 返回响应体。回调返回
     * GuardedResult（成功三要素），重放转型的 as 断言只存在于本方法内。
     */
    async runGuarded<T>(
        params: RunGuardedParams,
        fn: (tx: Tx, guard: GuardContext) => Promise<GuardedResult<T>>,
    ): Promise<T> {
        const key = this.requireKey(params.idempotencyKey);
        const requestHash = this.digest(params.digest);
        return this.txRunner.run(async (tx: Tx) => {
            const { replay, placeholderId } = await this.beginOrReplay(tx, {
                actorId: params.actorId,
                operationKey: params.operationKey,
                key,
                requestHash,
            });
            if (replay) {
                return replay.body as unknown as T;
            }
            if (placeholderId === null) {
                // BeginResult 契约：replay 为空时占位必然存在；走到这里即基础设施缺陷
                throw new Error("幂等占位缺失");
            }
            const guarded = await fn(tx, { placeholderId, idempotencyKey: key });
            await this.complete(tx, {
                id: placeholderId,
                httpStatus: guarded.httpStatus,
                responseBody: guarded.responseBody as unknown as Prisma.InputJsonValue,
                resource: guarded.resource,
            });
            return guarded.responseBody;
        });
    }

    /**
     * 删除类端点的 runGuarded 变体：契约响应恒为 data:null，重放不读快照、
     * 成功亦返回 null（complete 仍落响应快照供审计兜底）。
     */
    async runGuardedVoid(
        params: RunGuardedParams,
        fn: (tx: Tx, guard: GuardContext) => Promise<GuardedResult<Prisma.InputJsonValue>>,
    ): Promise<null> {
        const key = this.requireKey(params.idempotencyKey);
        const requestHash = this.digest(params.digest);
        await this.txRunner.run(async (tx: Tx) => {
            const { replay, placeholderId } = await this.beginOrReplay(tx, {
                actorId: params.actorId,
                operationKey: params.operationKey,
                key,
                requestHash,
            });
            if (replay) {
                return null;
            }
            if (placeholderId === null) {
                throw new Error("幂等占位缺失");
            }
            const guarded = await fn(tx, { placeholderId, idempotencyKey: key });
            await this.complete(tx, {
                id: placeholderId,
                httpStatus: guarded.httpStatus,
                responseBody: guarded.responseBody,
                resource: guarded.resource,
            });
            return null;
        });
        return null;
    }
}

import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { TransactionRetryExhaustedError, isMarkedRetryable } from "../common/errors/transaction-retry-exhausted.error";
import { isDriverLockConflict } from "../common/errors/driver-lock-conflict";
import { PrismaService } from "./prisma.service";

/** 共享事务客户端类型：业务 service 一律从此导入，不再各自维护本地别名 */
export type Tx = Prisma.TransactionClient;

/**
 * Prisma 层可重试码：P2034 = 事务写入冲突；'1213'/'1205' 为个别路径直接透传的驱动码。
 * $queryRaw 中的死锁实际以 P2010 + meta.driverAdapterError.cause 形态出现（见下方判定）。
 */
const RETRYABLE_PRISMA_CODES = new Set(["P2034", "1213", "1205"]);

/**
 * 提取 Prisma 错误码（鸭子判定，不用 instanceof）：运行时错误实例来自 pnpm 依赖图中
 * 另一份 @prisma/client 副本（peer-hash 不同源），instanceof 判定跨副本必然失败——
 * e2e 实测教训。
 */
const prismaErrorCode = (error: unknown): string | undefined => {
    if (typeof error !== "object" || error === null || !("code" in error)) {
        return undefined;
    }
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" || typeof code === "number" ? String(code) : undefined;
};

/**
 * Prisma P2010（raw query failed）错误的驱动语义：死锁经 $queryRaw 冒出时 code 是
 * P2010 而非 1213，真实信息在 meta.driverAdapterError.cause——
 * { originalCode: '1213', kind: 'TransactionWriteConflict' }（e2e 实测形态）。
 */
const isRawQueryLockConflict = (error: unknown): boolean => {
    if (typeof error !== "object" || error === null) {
        return false;
    }
    const candidate = error as {
        code?: unknown;
        meta?: { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown } } };
    };
    if (prismaErrorCode(error) !== "P2010") {
        return false;
    }
    const cause = candidate.meta?.driverAdapterError?.cause;
    if (!cause) {
        return false;
    }
    return cause.kind === "TransactionWriteConflict" || ["1213", "1205"].includes(String(cause.originalCode));
};

const isRetryable = (error: unknown): boolean =>
    isMarkedRetryable(error) ||
    isDriverLockConflict(error) ||
    isRawQueryLockConflict(error) ||
    RETRYABLE_PRISMA_CODES.has(prismaErrorCode(error) ?? "");

export interface TransactionRunnerOptions {
    /** 总尝试次数（1 次初始 + N-1 次重试），默认 3 */
    maxAttempts?: number;
    /** 退避基数毫秒，默认 50 */
    baseDelayMs?: number;
    /** 单次退避上限毫秒，默认 1000 */
    maxDelayMs?: number;
    /** 可注入的 sleep（测试时替换为空实现，避免慢测） */
    sleep?: (ms: number) => Promise<void>;
    /** 可注入的随机源（测试时固定，避免抖测） */
    random?: () => number;
}

/**
 * 事务重试器：仅对死锁/锁超时/事务冲突重试**整个事务**（db-scheme.md §1.3：
 * 死锁只能重试整个事务，不能只重试最后一条 SQL）。
 * 非可重试错误（业务 404/409 等）原样抛出；重试耗尽抛 TransactionRetryExhaustedError。
 * 事务回调必须可重入且不得包含邮件、网络请求等外部副作用——重试可能使回调执行多次，
 * 只有数据库写入随回滚一起撤销。
 *
 * 隔离级别 READ COMMITTED 由 create-pool 在连接层统一设置（initSql）。
 * 不走 $transaction 的 isolationLevel 选项：实测 @prisma/adapter-mariadb 静默忽略
 * 该选项，事务仍以服务器默认 REPEATABLE READ 运行。选 READ COMMITTED 的原因：
 * 幂等占位查询（普通读）总是先于业务行锁发生，RR 的事务级快照会让行锁之后的
 * 聚合读（v_bom_stock 等）仍取旧快照；RC 每条语句取新快照，锁定读（FOR UPDATE）
 * 之后的普通读能看到最新已提交行，且间隙锁更少、死锁更少。db-scheme.md §2 的
 * 并发控制以行锁为主体，不依赖 RR 快照一致性。
 */
@Injectable()
export class TransactionRunner {
    constructor(private readonly prisma: PrismaService) {}

    async run<T>(fn: (tx: Tx) => Promise<T>, options: TransactionRunnerOptions = {}): Promise<T> {
        const maxAttempts = options.maxAttempts ?? 3;
        const baseDelayMs = options.baseDelayMs ?? 50;
        const maxDelayMs = options.maxDelayMs ?? 1000;
        const sleep = options.sleep ?? (async (ms: number) => await new Promise(resolve => setTimeout(resolve, ms)));
        const random = options.random ?? Math.random;

        let lastError: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await this.prisma.$transaction(tx => fn(tx));
            } catch (error) {
                lastError = error;
                if (!isRetryable(error)) {
                    throw error;
                }
                if (attempt < maxAttempts) {
                    // 指数退避 + 抖动：等待 [backoff/2, backoff) 的随机时长
                    const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
                    await sleep(backoff / 2 + random() * (backoff / 2));
                }
            }
        }
        throw new TransactionRetryExhaustedError(lastError, maxAttempts);
    }
}

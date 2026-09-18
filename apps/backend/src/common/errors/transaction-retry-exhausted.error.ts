/**
 * TransactionRunner 重试耗尽时抛出：cause 保留最后一次原始错误。
 * service 层不直接抛 HTTP 语义，由统一异常过滤器映射为 503。
 */
export class TransactionRetryExhaustedError extends Error {
    constructor(cause: unknown, attempts: number) {
        super(`事务重试 ${attempts} 次后仍失败`);
        this.name = 'TransactionRetryExhaustedError';
        this.cause = cause;
    }
}

/**
 * 可重试标记：非 runner 所知的错误类型（如幂等占位的唯一键竞争）可打上此标记，
 * runner 据此对整个事务重试，而无需把判定逻辑集中在一处、避免模块间反向依赖。
 */
const RETRYABLE_MARKER = 'retryableTransaction';

/** 给错误打上“整事务可重试”标记并原样返回 */
export const markTransactionRetryable = <T extends object>(error: T): T => {
    Object.defineProperty(error, RETRYABLE_MARKER, { value: true, enumerable: false });
    return error;
};

/** 判断错误是否被打过可重试标记 */
export const isMarkedRetryable = (error: unknown): boolean =>
    typeof error === 'object' && error !== null && RETRYABLE_MARKER in error;

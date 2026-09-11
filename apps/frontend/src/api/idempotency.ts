/* 写请求幂等键：Axios 在同一次网络重试中复用同一 config/header。 */
export function idempotencyConfig() {
    return { headers: { "Idempotency-Key": crypto.randomUUID() } };
}

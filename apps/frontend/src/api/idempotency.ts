/* 写请求幂等键：Axios 在同一次网络重试中复用同一 config/header。 */
function uuid(): string {
    if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    // 非安全上下文（HTTP 局域网访问）没有 randomUUID，getRandomValues 仍可用
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function idempotencyConfig() {
    return { headers: { "Idempotency-Key": uuid() } };
}

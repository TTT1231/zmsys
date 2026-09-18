/* 幂等键生成：优先 randomUUID，非安全上下文降级 getRandomValues 仍产出合法 UUID v4 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { idempotencyConfig } from "@/api/idempotency";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("idempotencyConfig", () => {
    it("uses crypto.randomUUID when available", () => {
        vi.stubGlobal("crypto", {
            randomUUID: () => "11111111-2222-4333-8444-555555555555",
        });
        expect(idempotencyConfig()).toEqual({
            headers: { "Idempotency-Key": "11111111-2222-4333-8444-555555555555" },
        });
    });

    it("falls back to getRandomValues when randomUUID is missing", () => {
        vi.stubGlobal("crypto", {
            getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab),
        });
        const key = idempotencyConfig().headers["Idempotency-Key"];
        // 全 0xab 字节经 v4 规则改写第 7、9 字节后应得到固定串
        expect(key).toBe("abababab-abab-4bab-abab-abababababab");
    });

    it("generates a distinct key per call", () => {
        const keys = new Set(Array.from({ length: 50 }, () => idempotencyConfig().headers["Idempotency-Key"]));
        expect(keys.size).toBe(50);
    });
});

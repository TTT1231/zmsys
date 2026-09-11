/* mock handler 公共约束：Idempotency-Key 缺失、成功重放及同键异参冲突 */
import { describe, expect, it, vi } from "vitest";

import { idempotent } from "../../mocks/request/shared";

const requestOf = (key?: string) =>
    new Request("http://localhost/api/orders", {
        method: "POST",
        headers: key ? { "Idempotency-Key": key } : undefined,
    });

describe("idempotent", () => {
    it("requires a valid key and replays one successful result without executing twice", () => {
        const execute = vi.fn(() => ({ orderNo: "ZM-IDEMPOTENT-01" }));
        const first = idempotent(requestOf("idem-test-0001"), "sys_admin", "test:create", { qty: 1 }, execute);
        const replay = idempotent(requestOf("idem-test-0001"), "sys_admin", "test:create", { qty: 1 }, execute);

        expect(first).toEqual({ orderNo: "ZM-IDEMPOTENT-01" });
        expect(replay).toEqual(first);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(() => idempotent(requestOf("idem-test-0001"), "sys_admin", "test:create", { qty: 2 }, execute)).toThrow(
            "不能用于不同请求",
        );
        expect(() => idempotent(requestOf(), "sys_admin", "test:create", { qty: 1 }, execute)).toThrow(
            "Idempotency-Key",
        );
    });
});

/* ApiError 载体与类型守卫 */
import { describe, expect, it } from "vitest";

import { ApiError, isApiError } from "@/http/errors";

describe("ApiError", () => {
    it("carries message, code and name", () => {
        const error = new ApiError("登录已过期", 401);
        expect(error.message).toBe("登录已过期");
        expect(error.code).toBe(401);
        expect(error.name).toBe("ApiError");
        expect(error).toBeInstanceOf(Error);
        expect(new ApiError("网络异常", -1).code).toBe(-1);
    });

    it("guards only ApiError instances", () => {
        expect(isApiError(new ApiError("x", 400))).toBe(true);
        expect(isApiError(new Error("x"))).toBe(false);
        expect(isApiError("x")).toBe(false);
        expect(isApiError(null)).toBe(false);
    });
});

// @vitest-environment jsdom
/* accessToken 存取：正常往返 + localStorage 抛异常时的静默容错 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearToken, getToken, setToken } from "@/lib/token";

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe("token storage", () => {
    it("round-trips token through localStorage", () => {
        expect(getToken()).toBeNull();
        setToken("abc.def");
        expect(localStorage.getItem("zm-token")).toBe("abc.def");
        expect(getToken()).toBe("abc.def");
        clearToken();
        expect(getToken()).toBeNull();
    });

    it("returns null instead of throwing when storage access fails", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        expect(getToken()).toBeNull();
    });

    it("swallows set failures silently", () => {
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        expect(() => setToken("t")).not.toThrow();
    });
});

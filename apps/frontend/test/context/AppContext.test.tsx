// @vitest-environment jsdom
/* 认证上下文：mock @/api 三个请求函数，验证会话恢复、登录/登出编排与 can() 授权 */
import "@testing-library/jest-dom/vitest";

import { useEffect } from "react";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoginResult, WbUser } from "@/api";
import { fetchProfile, login as loginRequest, logout as logoutRequest } from "@/api";
import { DEFAULT_GRANTS } from "@/data/permissions";
import { clearToken, setToken } from "@/http";

import { AppProvider, useApp } from "@/context/AppContext";

vi.mock("@/api", () => ({
    fetchProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
}));

const user: WbUser = {
    version: 1,
    name: "王仓管",
    account: "ck01",
    role: "warehouse",
    active: true,
    last: "03-09 08:00",
};
const profile = { user, grant: DEFAULT_GRANTS.warehouse };
const loginResult: LoginResult = { accessToken: "tok.1", user };

// 每次渲染后刷新为最新的 context value，供直接调用 login/logout
const captured: { current: ReturnType<typeof useApp> | null } = { current: null };

function Probe() {
    const app = useApp();
    useEffect(() => {
        captured.current = app;
    });
    return (
        <div>
            <span data-testid="status">{app.status}</span>
            <span data-testid="role">{app.role}</span>
            <span data-testid="can-register">{String(app.can("inbound:register"))}</span>
            <span data-testid="can-print">{String(app.can("outbound:print"))}</span>
        </div>
    );
}

const renderApp = () =>
    render(
        <AppProvider>
            <Probe />
        </AppProvider>,
    );

const statusOf = () => screen.getByTestId("status").textContent;

beforeEach(() => {
    vi.clearAllMocks();
    clearToken();
});

afterEach(() => {
    cleanup();
    clearToken();
});

describe("AppProvider session restore", () => {
    it("starts as guest without token and denies perms", () => {
        renderApp();
        expect(statusOf()).toBe("guest");
        expect(screen.getByTestId("can-register").textContent).toBe("false");
        expect(fetchProfile).not.toHaveBeenCalled();
    });

    it("restores session from token via fetchProfile", async () => {
        setToken("tok.1");
        vi.mocked(fetchProfile).mockResolvedValue(profile);
        renderApp();
        expect(statusOf()).toBe("loading");
        await waitFor(() => expect(statusOf()).toBe("authenticated"));
        expect(screen.getByTestId("role").textContent).toBe("warehouse");
        expect(screen.getByTestId("can-register").textContent).toBe("true");
        expect(screen.getByTestId("can-print").textContent).toBe("false");
    });

    it("falls back to guest when profile request fails", async () => {
        setToken("tok.expired");
        vi.mocked(fetchProfile).mockRejectedValue(new Error("401"));
        renderApp();
        await waitFor(() => expect(statusOf()).toBe("guest"));
    });
});

describe("AppProvider login / logout", () => {
    it("logs in, applies profile and grants", async () => {
        vi.mocked(loginRequest).mockResolvedValue(loginResult);
        vi.mocked(fetchProfile).mockResolvedValue(profile);
        renderApp();
        await captured.current!.login("ck01", "123456");
        expect(loginRequest).toHaveBeenCalledWith({ account: "ck01", password: "123456" });
        await waitFor(() => expect(statusOf()).toBe("authenticated"));
        expect(screen.getByTestId("can-register").textContent).toBe("true");
    });

    it("propagates login failure to the caller", async () => {
        vi.mocked(loginRequest).mockRejectedValue(new Error("账号或密码错误"));
        renderApp();
        await expect(captured.current!.login("ck01", "wrong")).rejects.toThrow("账号或密码错误");
        expect(statusOf()).toBe("guest");
    });

    it("logs out and resets state", async () => {
        setToken("tok.1");
        vi.mocked(fetchProfile).mockResolvedValue(profile);
        renderApp();
        await waitFor(() => expect(statusOf()).toBe("authenticated"));
        vi.mocked(logoutRequest).mockResolvedValue(undefined);
        await captured.current!.logout();
        await waitFor(() => expect(statusOf()).toBe("guest"));
        expect(screen.getByTestId("can-register").textContent).toBe("false");
    });

    it("still clears local auth state when the logout request fails", async () => {
        setToken("tok.1");
        vi.mocked(fetchProfile).mockResolvedValue(profile);
        renderApp();
        await waitFor(() => expect(statusOf()).toBe("authenticated"));
        vi.mocked(logoutRequest).mockRejectedValue(new Error("network"));

        await expect(captured.current!.logout()).resolves.toBeUndefined();
        await waitFor(() => expect(statusOf()).toBe("guest"));
    });

    it("skips refreshProfile without token", async () => {
        renderApp();
        await captured.current!.refreshProfile();
        expect(fetchProfile).not.toHaveBeenCalled();
    });

    it("refreshes profile when token exists", async () => {
        setToken("tok.1");
        vi.mocked(fetchProfile).mockResolvedValue(profile);
        renderApp();
        await waitFor(() => expect(statusOf()).toBe("authenticated"));
        const renewed = { ...profile, grant: DEFAULT_GRANTS.super };
        vi.mocked(fetchProfile).mockResolvedValue(renewed);
        await captured.current!.refreshProfile();
        // 授权更新后 can() 立即反映新权限（super 可打印出库单）
        await waitFor(() => expect(screen.getByTestId("can-print").textContent).toBe("true"));
        expect(fetchProfile).toHaveBeenCalledTimes(2);
    });
});

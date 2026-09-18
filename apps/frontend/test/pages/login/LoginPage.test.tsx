// @vitest-environment jsdom
/* 登录页：覆盖字段校验、请求错误友好化与登录中反馈 */
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { ApiError } from "@/http";
import { LoginPage } from "@/pages/login/LoginPage";

const { loginSpy, toastSpy, notificationSpy } = vi.hoisted(() => ({
    loginSpy: vi.fn(),
    toastSpy: vi.fn(),
    notificationSpy: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({
    useApp: () => ({ status: "guest", login: loginSpy }),
}));

vi.mock("@/components/ui/Toast", () => ({
    useToast: () => toastSpy,
    useNotification: () => notificationSpy,
}));

function renderLoginPage() {
    return render(
        <MemoryRouter initialEntries={["/login"]}>
            <LoginPage />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(cleanup);

describe("LoginPage", () => {
    it("shows inline required errors and focuses the first invalid field", () => {
        renderLoginPage();

        fireEvent.click(screen.getByRole("button", { name: "登录" }));

        expect(screen.getByText("请输入账号")).toBeInTheDocument();
        expect(screen.getByText("请输入密码")).toBeInTheDocument();
        expect(screen.getByLabelText("账号")).toHaveFocus();
        expect(loginSpy).not.toHaveBeenCalled();
    });

    it("sends recoverable service errors to the global message without changing the form", async () => {
        loginSpy.mockRejectedValueOnce(new ApiError("请求失败（HTTP 502）", 502));
        const user = userEvent.setup();
        renderLoginPage();

        await user.type(screen.getByLabelText("账号"), "sys_admin");
        await user.type(screen.getByLabelText("密码"), "123456");
        await user.click(screen.getByRole("button", { name: "登录" }));

        await waitFor(() => expect(toastSpy).toHaveBeenCalledWith("登录服务暂时不可用，请稍后重试", true));
        expect(notificationSpy).not.toHaveBeenCalled();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.getByLabelText("账号")).toHaveValue("sys_admin");
        expect(screen.getByLabelText("密码")).toHaveValue("123456");
    });

    it("disables the form and exposes a distinct progress label while logging in", async () => {
        let resolveLogin: (() => void) | undefined;
        loginSpy.mockImplementationOnce(
            () =>
                new Promise<void>(resolve => {
                    resolveLogin = resolve;
                }),
        );
        const user = userEvent.setup();
        renderLoginPage();

        await user.type(screen.getByLabelText("账号"), "sys_admin");
        await user.type(screen.getByLabelText("密码"), "123456");
        await user.click(screen.getByRole("button", { name: "登录" }));

        expect(screen.getByRole("button", { name: "正在登录…" })).toBeDisabled();
        expect(screen.getByLabelText("账号")).toBeDisabled();
        expect(screen.getByLabelText("密码")).toBeDisabled();

        resolveLogin?.();
        await waitFor(() => expect(loginSpy).toHaveBeenCalledWith("sys_admin", "123456"));
        await waitFor(() => expect(screen.getByRole("button", { name: "登录" })).not.toBeDisabled());
        expect(notificationSpy).toHaveBeenCalledWith({ title: "登录成功", message: "欢迎回来" });
        expect(toastSpy).not.toHaveBeenCalled();
    });

    it("welcomes the signed-in user through the notification channel", async () => {
        loginSpy.mockResolvedValueOnce({ name: "系统管理员" });
        const user = userEvent.setup();
        renderLoginPage();

        await user.type(screen.getByLabelText("账号"), "sys_admin");
        await user.type(screen.getByLabelText("密码"), "123456");
        await user.click(screen.getByRole("button", { name: "登录" }));

        await waitFor(() =>
            expect(notificationSpy).toHaveBeenCalledWith({
                title: "登录成功",
                message: "欢迎回来，系统管理员",
            }),
        );
        expect(toastSpy).not.toHaveBeenCalled();
    });
});

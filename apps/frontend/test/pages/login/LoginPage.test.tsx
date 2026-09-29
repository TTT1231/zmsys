// @vitest-environment jsdom
/* 登录页：字段/滑块校验、记住账号回填、忘记密码指引与登录反馈 */
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { ApiError } from "@/http";
import { LoginPage, REMEMBER_KEY } from "@/pages/login/LoginPage";

const { loginSpy, toastSpy, notificationSpy } = vi.hoisted(() => ({
    loginSpy: vi.fn(),
    toastSpy: vi.fn(),
    notificationSpy: vi.fn(),
}));

vi.mock("@/context/useApp", () => ({
    useApp: () => ({ status: "guest", login: loginSpy }),
}));

vi.mock("@/components/ui/toastContexts", () => ({
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

/* 键盘路径通过滑块（jsdom 无布局，拖拽路径不可用） */
function passCaptcha() {
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
}

async function fillCredentials(user: ReturnType<typeof userEvent.setup>, account = "sys_admin") {
    await user.type(screen.getByLabelText("账号"), account);
    await user.type(screen.getByLabelText("密码"), "123456");
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
});

afterEach(cleanup);

describe("LoginPage", () => {
    it("shows inline required errors (fields + captcha) and focuses the first invalid field", () => {
        renderLoginPage();

        fireEvent.click(screen.getByRole("button", { name: "登录" }));

        expect(screen.getByText("请输入账号")).toBeInTheDocument();
        expect(screen.getByText("请输入密码")).toBeInTheDocument();
        expect(screen.getByText("请拖动滑块完成验证")).toBeInTheDocument();
        expect(screen.getByLabelText("账号")).toHaveFocus();
        expect(loginSpy).not.toHaveBeenCalled();
    });

    it("blocks submit until the slider captcha passes, then sends credentials", async () => {
        const user = userEvent.setup();
        renderLoginPage();
        await fillCredentials(user);

        await user.click(screen.getByRole("button", { name: "登录" }));
        expect(loginSpy).not.toHaveBeenCalled();
        expect(screen.getByText("请拖动滑块完成验证")).toBeInTheDocument();

        passCaptcha();
        await user.click(screen.getByRole("button", { name: "登录" }));

        await waitFor(() => expect(loginSpy).toHaveBeenCalledWith("sys_admin", "123456"));
    });

    it("resets the captcha but keeps inputs after a recoverable service error", async () => {
        loginSpy.mockRejectedValueOnce(new ApiError("请求失败（HTTP 502）", 502));
        const user = userEvent.setup();
        renderLoginPage();
        await fillCredentials(user);
        passCaptcha();

        await user.click(screen.getByRole("button", { name: "登录" }));

        await waitFor(() => expect(toastSpy).toHaveBeenCalledWith("登录服务暂时不可用，请稍后重试", true));
        expect(screen.getByText("请按住滑块拖动")).toBeInTheDocument();
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
        await fillCredentials(user);
        passCaptcha();

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
        await fillCredentials(user);
        passCaptcha();

        await user.click(screen.getByRole("button", { name: "登录" }));

        await waitFor(() =>
            expect(notificationSpy).toHaveBeenCalledWith({
                title: "登录成功",
                message: "欢迎回来，系统管理员",
            }),
        );
        expect(toastSpy).not.toHaveBeenCalled();
    });

    it("persists the account when checked, prefills it next visit and clears when unchecked", async () => {
        const user = userEvent.setup();
        renderLoginPage();
        await fillCredentials(user);
        await user.click(screen.getByRole("checkbox", { name: "记住账号" }));
        passCaptcha();

        await user.click(screen.getByRole("button", { name: "登录" }));
        await waitFor(() => expect(loginSpy).toHaveBeenCalled());
        expect(localStorage.getItem(REMEMBER_KEY)).toBe("sys_admin");

        cleanup();
        loginSpy.mockClear();
        loginSpy.mockResolvedValueOnce(undefined);

        renderLoginPage();
        expect(screen.getByLabelText("账号")).toHaveValue("sys_admin");
        expect(screen.getByRole("checkbox", { name: "记住账号" })).toBeChecked();

        await user.clear(screen.getByLabelText("账号"));
        await user.type(screen.getByLabelText("账号"), "ops_user");
        await user.type(screen.getByLabelText("密码"), "123456");
        await user.click(screen.getByRole("checkbox", { name: "记住账号" }));
        passCaptcha();

        await user.click(screen.getByRole("button", { name: "登录" }));
        await waitFor(() => expect(loginSpy).toHaveBeenCalledWith("ops_user", "123456"));
        expect(localStorage.getItem(REMEMBER_KEY)).toBe("");
    });

    it("guides to the administrator from the forget-password view and returns to login", async () => {
        const user = userEvent.setup();
        renderLoginPage();

        await user.click(screen.getByRole("button", { name: "忘记密码?" }));
        expect(screen.getByText("忘记密码 🤦🏻‍♂️")).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "获取重置方式" }));
        expect(screen.getByText("请输入账号")).toBeInTheDocument();
        expect(notificationSpy).not.toHaveBeenCalled();

        await user.type(screen.getByLabelText("账号"), "ops_user");
        await user.click(screen.getByRole("button", { name: "获取重置方式" }));
        expect(notificationSpy).toHaveBeenCalledWith({
            title: "请联系管理员重置密码",
            message: "账号 ops_user 的密码需由系统管理员在「用户管理」中重置后生效",
        });

        await user.click(screen.getByRole("button", { name: "返回登录" }));
        expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
        expect(screen.getByText("欢迎回来 👋🏻")).toBeInTheDocument();
    });
});

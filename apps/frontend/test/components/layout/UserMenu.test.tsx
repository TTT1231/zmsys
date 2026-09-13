// @vitest-environment jsdom
/* UserMenu:下拉展开(简洁信息头 + 个人中心 + 退出登录)、个人中心弹窗、退出确认与登出跳转 */
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WbUser } from "@/api";
import { ToastProvider } from "@/components/ui/Toast";
import { UserMenu } from "@/components/layout/UserMenu";

const user: WbUser = {
    version: 1,
    name: "张三",
    account: "zhangsan",
    role: "sales",
    active: true,
    last: "09-08 17:42",
};

const { logoutSpy, refreshProfileSpy, navigateSpy } = vi.hoisted(() => ({
    logoutSpy: vi.fn().mockResolvedValue(undefined),
    refreshProfileSpy: vi.fn().mockResolvedValue(undefined),
    navigateSpy: vi.fn(),
}));

vi.mock("@/context/AppContext", async importOriginal => {
    const actual = await importOriginal<typeof import("@/context/AppContext")>();
    return {
        ...actual,
        useApp: () => ({
            user,
            role: "sales" as const,
            logout: logoutSpy,
            refreshProfile: refreshProfileSpy,
        }),
    };
});

vi.mock("react-router", () => ({
    useNavigate: () => navigateSpy,
}));

// Radix Trigger 监听 pointerdown,jsdom 下需组合事件
const openMenu = () => {
    const trigger = screen.getByRole("button", { name: "用户菜单" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
};

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(cleanup);

const renderMenu = () =>
    render(
        <ToastProvider>
            <UserMenu />
        </ToastProvider>,
    );

describe("UserMenu", () => {
    it("opens dropdown with concise user info and two menu items", async () => {
        renderMenu();
        openMenu();
        const menu = await screen.findByRole("menu");
        expect(menu).toHaveTextContent("张三");
        expect(menu).toHaveTextContent("销售");
        expect(screen.getByRole("menuitem", { name: /个人中心/ })).toBeInTheDocument();
        expect(screen.getByRole("menuitem", { name: /退出登录/ })).toBeInTheDocument();
    });

    it("opens profile dialog from menu", async () => {
        renderMenu();
        openMenu();
        fireEvent.click(await screen.findByRole("menuitem", { name: /个人中心/ }));
        const dialog = await screen.findByRole("dialog", { name: "个人中心" });
        expect(dialog).toHaveTextContent("@zhangsan");
    });

    it("logout requires confirmation, then logs out and navigates", async () => {
        renderMenu();
        openMenu();
        fireEvent.click(await screen.findByRole("menuitem", { name: /退出登录/ }));
        const confirm = await screen.findByRole("dialog", { name: "退出登录" });
        expect(confirm).toHaveTextContent("确定要退出当前账号吗");
        expect(logoutSpy).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
        await waitFor(() => expect(logoutSpy).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/login", { replace: true }));
        expect(await screen.findByText("已退出登录")).toBeInTheDocument();
    });

    it("cancel keeps session", async () => {
        renderMenu();
        openMenu();
        fireEvent.click(await screen.findByRole("menuitem", { name: /退出登录/ }));
        fireEvent.click(await screen.findByRole("button", { name: "取消" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "退出登录" })).not.toBeInTheDocument());
        expect(logoutSpy).not.toHaveBeenCalled();
    });
});

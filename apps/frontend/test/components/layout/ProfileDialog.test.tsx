// @vitest-environment jsdom
/* ProfileDialog:账号信息(含创建/修改时间)只读渲染、无自助改名入口、改密链路(changePassword → logout) */
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WbUser } from "@/api";
import { changePassword } from "@/api";
import { ToastProvider } from "@/components/ui/Toast";
import { ProfileDialog } from "@/components/layout/ProfileDialog";

const user: WbUser = {
    version: 1,
    name: "李销售",
    account: "li_xiaomei",
    role: "sales",
    active: true,
    last: "09-07 09:12",
    createdAt: "2026-06-01T09:45:00+08:00",
};

const { logoutSpy, refreshProfileSpy } = vi.hoisted(() => ({
    logoutSpy: vi.fn().mockResolvedValue(undefined),
    refreshProfileSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/api", () => ({
    changePassword: vi.fn(),
}));

vi.mock("@/context/useApp", async importOriginal => {
    const actual = await importOriginal<typeof import("@/context/useApp")>();
    return {
        ...actual,
        useApp: () => ({ user, role: "sales" as const, refreshProfile: refreshProfileSpy, logout: logoutSpy }),
    };
});

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(changePassword).mockResolvedValue(null);
});

afterEach(cleanup);

const renderDialog = () =>
    render(
        <ToastProvider>
            <ProfileDialog onClose={() => {}} />
        </ToastProvider>,
    );

describe("ProfileDialog", () => {
    it("renders read-only account info including created/updated timestamps", () => {
        renderDialog();
        const dialog = screen.getByRole("dialog", { name: "个人中心" });
        expect(dialog).toHaveTextContent("@li_xiaomei");
        expect(dialog).toHaveTextContent("李销售");
        expect(dialog).toHaveTextContent("启用");
        expect(dialog).toHaveTextContent("09-07 09:12");
        expect(dialog).toHaveTextContent("2026-06-01 09:45");
        // 从未变更过资料时,上一次修改时间显示占位符
        expect(dialog).toHaveTextContent("—");
    });

    it("highlights the active status with a green dot and success text", () => {
        renderDialog();
        // 圆点为纯装饰(aria-hidden),状态由文字传达,颜色只作增强不作唯一信息
        const dot = document.querySelector(".bg-success");
        expect(dot).toHaveAttribute("aria-hidden", "true");
        expect(screen.getByText("启用")).toHaveClass("text-success");
    });

    it("offers no self-service name editing or save action", () => {
        renderDialog();
        expect(screen.queryByLabelText("姓名")).toBeNull();
        expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    });

    it("invalidates the session and returns to login state after changing password", async () => {
        renderDialog();
        fireEvent.change(screen.getByLabelText("旧密码"), { target: { value: "123456" } });
        fireEvent.change(screen.getByLabelText("新密码（至少 6 位）"), { target: { value: "new-password" } });
        fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-password" } });
        fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

        await waitFor(() =>
            expect(changePassword).toHaveBeenCalledWith({ oldPassword: "123456", newPassword: "new-password" }),
        );
        await waitFor(() => expect(logoutSpy).toHaveBeenCalledTimes(1));
        expect(await screen.findByText("密码已修改，请重新登录")).toBeInTheDocument();
    });
});

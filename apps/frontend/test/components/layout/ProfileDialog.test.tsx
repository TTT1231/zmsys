// @vitest-environment jsdom
/* ProfileDialog:只读信息渲染、姓名校验、保存链路(updateProfile → refreshProfile → toast) */
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WbUser } from "@/api";
import { changePassword, updateProfile } from "@/api";
import { ApiError } from "@/http";
import { ToastProvider } from "@/components/ui/Toast";
import { ProfileDialog } from "@/components/layout/ProfileDialog";

const user: WbUser = {
    version: 1,
    name: "李销售",
    account: "li_xiaomei",
    role: "sales",
    active: true,
    last: "09-07 09:12",
};

const { logoutSpy, refreshProfileSpy } = vi.hoisted(() => ({
    logoutSpy: vi.fn().mockResolvedValue(undefined),
    refreshProfileSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/api", () => ({
    changePassword: vi.fn(),
    updateProfile: vi.fn(),
}));

vi.mock("@/context/AppContext", async importOriginal => {
    const actual = await importOriginal<typeof import("@/context/AppContext")>();
    return {
        ...actual,
        useApp: () => ({ user, role: "sales" as const, refreshProfile: refreshProfileSpy, logout: logoutSpy }),
    };
});

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(changePassword).mockResolvedValue(null);
    vi.mocked(updateProfile).mockResolvedValue({ ...user, name: "李新名" });
});

afterEach(cleanup);

const renderDialog = () =>
    render(
        <ToastProvider>
            <ProfileDialog onClose={() => {}} />
        </ToastProvider>,
    );

describe("ProfileDialog", () => {
    it("renders read-only account info with current name prefilled", () => {
        renderDialog();
        const dialog = screen.getByRole("dialog", { name: "个人中心" });
        expect(dialog).toHaveTextContent("@li_xiaomei");
        expect(dialog).toHaveTextContent("启用");
        expect(dialog).toHaveTextContent("09-07 09:12");
        expect(screen.getByLabelText("姓名")).toHaveValue("李销售");
    });

    it("blocks empty name without calling the API", async () => {
        renderDialog();
        const input = screen.getByLabelText("姓名");
        fireEvent.change(input, { target: { value: "   " } });
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        expect(updateProfile).not.toHaveBeenCalled();
        expect(refreshProfileSpy).not.toHaveBeenCalled();
        expect(await screen.findByText("姓名不能为空")).toBeInTheDocument();
    });

    it("saves name change through updateProfile then refreshProfile", async () => {
        renderDialog();
        fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "李新名" } });
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ name: "李新名" }));
        await waitFor(() => expect(refreshProfileSpy).toHaveBeenCalledTimes(1));
        expect(await screen.findByText("已保存")).toBeInTheDocument();
    });

    it("shows error toast when save fails", async () => {
        // 拦截器会把服务端失败归一成 ApiError,页面 catch 后透出其 message
        vi.mocked(updateProfile).mockRejectedValueOnce(new ApiError("姓名最多 20 个字符", 400));
        renderDialog();
        fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "超长姓名超长姓名超长姓名超长" } });
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        expect(await screen.findByText("姓名最多 20 个字符")).toBeInTheDocument();
        expect(refreshProfileSpy).not.toHaveBeenCalled();
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

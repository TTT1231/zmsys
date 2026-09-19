// @vitest-environment jsdom
/* 反馈分层：Message 顶部居中、Notification 右上角，分别验证语义与关闭行为 */
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { toast } from "sonner";

import { ToastProvider } from "@/components/ui/Toast";
import { useNotification, useToast } from "@/components/ui/toastContexts";

function ToastTrigger({ message, error }: { message: string; error?: boolean }) {
    const push = useToast();
    return (
        <button type="button" onClick={() => push(message, error)}>
            触发
        </button>
    );
}

function NotificationTrigger({ duration = 5000 }: { duration?: number }) {
    const notify = useNotification();
    return (
        <button type="button" onClick={() => notify({ title: "登录成功", message: "欢迎回来，系统管理员", duration })}>
            触发欢迎通知
        </button>
    );
}

afterEach(() => {
    toast.dismiss();
    cleanup();
});

describe("ToastProvider", () => {
    it("shows a compact top-center success message without a close button", async () => {
        render(
            <ToastProvider>
                <ToastTrigger message="已退出登录" />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "触发" }));

        const message = await screen.findByText("已退出登录");
        expect(message.closest("[data-sonner-toast]")).toHaveAttribute("data-type", "success");
        expect(message.closest("[data-sonner-toaster]")).toHaveAttribute("data-x-position", "center");
        expect(message.closest("[data-sonner-toaster]")).toHaveAttribute("data-y-position", "top");
        expect(screen.queryByRole("button", { name: "关闭通知" })).not.toBeInTheDocument();
    });

    it("infers error tone and also honors an explicit error flag", async () => {
        const { rerender } = render(
            <ToastProvider>
                <ToastTrigger message="请输入有效的发货数量" />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "触发" }));
        const inferred = await screen.findByText("请输入有效的发货数量");
        expect(inferred.closest("[data-sonner-toast]")).toHaveAttribute("data-type", "error");

        rerender(
            <ToastProvider>
                <ToastTrigger message="plain" error />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "触发" }));
        const explicit = await screen.findByText("plain");
        expect(explicit.closest("[data-sonner-toast]")).toHaveAttribute("data-type", "error");
        await waitFor(() => expect(screen.queryByText("请输入有效的发货数量")).not.toBeInTheDocument());
    });

    it("renders the welcome notification at the top-right with a dismiss control", async () => {
        render(
            <ToastProvider>
                <NotificationTrigger />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "触发欢迎通知" }));
        const title = await screen.findByText("登录成功");
        expect(screen.getByText("欢迎回来，系统管理员")).toBeInTheDocument();
        expect(title.closest("[data-sonner-toaster]")).toHaveAttribute("data-x-position", "right");
        expect(title.closest("[data-sonner-toaster]")).toHaveAttribute("data-y-position", "top");
        fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));
        await waitFor(() => expect(screen.queryByText("登录成功")).not.toBeInTheDocument());
    });

    it("auto-dismisses a short-lived notification", async () => {
        render(
            <ToastProvider>
                <NotificationTrigger duration={120} />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "触发欢迎通知" }));
        expect(await screen.findByText("登录成功")).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText("登录成功")).not.toBeInTheDocument());
    });

    it("keeps a notification visible when a separate global message appears", async () => {
        render(
            <ToastProvider>
                <NotificationTrigger />
                <ToastTrigger message="已退出登录" />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "触发欢迎通知" }));
        expect(await screen.findByText("欢迎回来，系统管理员")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "触发" }));
        expect(await screen.findByText("已退出登录")).toBeInTheDocument();
        expect(screen.getByText("欢迎回来，系统管理员")).toBeInTheDocument();
    });
});

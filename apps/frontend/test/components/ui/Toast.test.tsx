// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "@/components/ui/Toast";

function ToastTrigger({ message, error }: { message: string; error?: boolean }) {
    const push = useToast();
    return (
        <button type="button" onClick={() => push(message, error)}>
            触发
        </button>
    );
}

function NotificationTrigger() {
    const push = useToast();
    return (
        <button
            type="button"
            onClick={() => push({ title: "登录成功", message: "欢迎回来，李晓梅", tone: "success", duration: 4000 })}
        >
            触发欢迎通知
        </button>
    );
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

describe("ToastProvider", () => {
    it("pushes a toast via context and auto dismisses with an exit animation", () => {
        render(
            <ToastProvider>
                <ToastTrigger message="保存成功" />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "触发" }));
        expect(screen.getByRole("status")).toHaveTextContent("保存成功");
        act(() => {
            vi.advanceTimersByTime(3599);
        });
        expect(screen.getByRole("status")).toBeInTheDocument();
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(screen.getByRole("status")).toHaveAttribute("data-state", "closing");
        act(() => {
            vi.advanceTimersByTime(160);
        });
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("guesses error tone from message keywords", () => {
        render(
            <ToastProvider>
                <ToastTrigger message="请输入有效的发货数量" />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "触发" }));
        const status = screen.getByRole("status");
        expect(status).toHaveAttribute("data-tone", "error");
        expect(status).toHaveAttribute("aria-live", "assertive");
    });

    it("honors an explicit error flag", () => {
        render(
            <ToastProvider>
                <ToastTrigger message="plain" error={true} />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "触发" }));
        const status = screen.getByRole("status");
        expect(status).toHaveAttribute("data-tone", "error");
        expect(status).toHaveTextContent("plain");
    });

    it("renders a titled notification and supports manual dismissal", () => {
        render(
            <ToastProvider>
                <NotificationTrigger />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "触发欢迎通知" }));

        const notification = screen.getByRole("status");
        expect(notification).toHaveTextContent("登录成功");
        expect(notification).toHaveTextContent("欢迎回来，李晓梅");

        fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));
        expect(notification).toHaveAttribute("data-state", "closing");
        act(() => {
            vi.advanceTimersByTime(160);
        });
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
});

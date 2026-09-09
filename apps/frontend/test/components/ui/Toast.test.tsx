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

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

describe("ToastProvider", () => {
    it("pushes a toast via context and auto dismisses after 2400ms", () => {
        render(
            <ToastProvider>
                <ToastTrigger message="保存成功" />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "触发" }));
        expect(screen.getByRole("status")).toHaveTextContent("保存成功");
        act(() => {
            vi.advanceTimersByTime(2399);
        });
        expect(screen.getByRole("status")).toBeInTheDocument();
        act(() => {
            vi.advanceTimersByTime(1);
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
        expect(screen.getByRole("status").className).toContain("bg-danger");
    });

    it("honors explicit error flag and stacks messages", () => {
        render(
            <ToastProvider>
                <ToastTrigger message="plain" error={true} />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "触发" }));
        const status = screen.getByRole("status");
        expect(status.className).toContain("bg-danger");
        expect(status).toHaveTextContent("plain");
    });
});

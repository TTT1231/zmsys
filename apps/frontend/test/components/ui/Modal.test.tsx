// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/ui/Modal";

afterEach(cleanup);

const renderModal = (over: Partial<Parameters<typeof Modal>[0]> = {}) =>
    render(
        <Modal open onClose={vi.fn()} title="登记发货" subtitle="回填订单已发数量" {...over}>
            <button type="button">表单按钮</button>
        </Modal>,
    );

describe("Modal", () => {
    it("renders nothing when closed", () => {
        const { container } = render(
            <Modal open={false} onClose={() => {}} title="登记发货">
                内容
            </Modal>,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it("renders dialog with title, subtitle and footer", () => {
        renderModal({ footer: <button type="button">确定</button> });
        expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
        expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "登记发货");
        expect(screen.getByRole("heading", { name: "登记发货", level: 2 })).toBeInTheDocument();
        expect(screen.getByText("回填订单已发数量")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "确定" })).toBeInTheDocument();
    });

    it("locks body scroll while open and restores on close", () => {
        const { rerender } = renderModal();
        expect(document.body.style.overflow).toBe("hidden");
        rerender(
            <Modal open={false} onClose={vi.fn()} title="登记发货">
                <button type="button">表单按钮</button>
            </Modal>,
        );
        expect(document.body.style.overflow).toBe("");
    });

    it("closes on Escape, close button and backdrop mousedown", () => {
        const onClose = vi.fn();
        render(
            <Modal open onClose={onClose} title="登记发货">
                内容
            </Modal>,
        );
        fireEvent.keyDown(document.body, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "关闭" }));
        expect(onClose).toHaveBeenCalledTimes(2);
        // 点击遮罩本身关闭；点到面板内部不关闭
        const overlay = screen.getByRole("dialog").parentElement as HTMLElement;
        fireEvent.mouseDown(overlay);
        expect(onClose).toHaveBeenCalledTimes(3);
        fireEvent.mouseDown(screen.getByRole("dialog"));
        expect(onClose).toHaveBeenCalledTimes(3);
    });

    it("focuses the first focusable element on open", () => {
        renderModal();
        // DOM 顺序上 header 的关闭按钮先于内容区表单控件
        expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    });

    it("traps Tab focus inside the dialog", () => {
        renderModal();
        const first = screen.getByRole("button", { name: "关闭" });
        const last = screen.getByRole("button", { name: "表单按钮" });
        // 焦点在最后一个元素上按 Tab → 绕回第一个
        last.focus();
        fireEvent.keyDown(document, { key: "Tab" });
        expect(first).toHaveFocus();
        // 焦点在第一个元素上按 Shift+Tab → 绕到最后一个
        fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
        expect(last).toHaveFocus();
        // 焦点落到面板外（如 body）时按 Tab → 拉回第一个
        (document.activeElement as HTMLElement).blur();
        fireEvent.keyDown(document, { key: "Tab" });
        expect(first).toHaveFocus();
    });
});

describe("Modal 叠加", () => {
    /* 分开 render 模拟真实叠层：外层先挂载入栈，内层后挂载成为栈顶 */
    const renderStacked = () => {
        const outerClose = vi.fn();
        const innerClose = vi.fn();
        const outer = render(
            <Modal open onClose={outerClose} title="客户详情">
                <button type="button">外层按钮</button>
            </Modal>,
        );
        const inner = render(
            <Modal open onClose={innerClose} title="订单详情">
                <button type="button">内层按钮A</button>
                <button type="button">内层按钮B</button>
            </Modal>,
        );
        const overlayOf = (title: string) => screen.getByRole("dialog", { name: title }).parentElement as HTMLElement;
        return { outer, inner, outerClose, innerClose, overlayOf };
    };

    it("仅栈顶响应 ESC：内层先关，再按才轮到外层", () => {
        const { inner, outerClose, innerClose, overlayOf } = renderStacked();
        fireEvent.keyDown(document.body, { key: "Escape" });
        expect(innerClose).toHaveBeenCalledTimes(1);
        expect(outerClose).not.toHaveBeenCalled();
        // 关掉内层后外层成为栈顶，ESC 恢复响应
        inner.unmount();
        fireEvent.keyDown(document.body, { key: "Escape" });
        expect(outerClose).toHaveBeenCalledTimes(1);
        expect(overlayOf("客户详情")).toBeInTheDocument();
    });

    it("非栈顶层挂 inert，关内层后外层解除", () => {
        const { inner, overlayOf } = renderStacked();
        expect(overlayOf("订单详情")).not.toHaveAttribute("inert");
        expect(overlayOf("客户详情")).toHaveAttribute("inert");
        inner.unmount();
        expect(overlayOf("客户详情")).not.toHaveAttribute("inert");
    });

    it("滚动锁在叠加期间保持，栈清空才解锁", () => {
        const { outer, inner } = renderStacked();
        expect(document.body.style.overflow).toBe("hidden");
        inner.unmount();
        expect(document.body.style.overflow).toBe("hidden");
        outer.unmount();
        expect(document.body.style.overflow).toBe("");
    });

    it("Tab 焦点只在栈顶弹窗内循环，不落回外层", () => {
        const { overlayOf } = renderStacked();
        const innerClose = screen
            .getByRole("dialog", { name: "订单详情" })
            .querySelector('button[aria-label="关闭"]') as HTMLElement;
        const innerA = screen.getByRole("button", { name: "内层按钮A" });
        const innerB = screen.getByRole("button", { name: "内层按钮B" });
        // 焦点在内层中间元素上按 Tab：栈顶陷阱交还浏览器默认移动，不被外层陷阱拉走
        innerA.focus();
        fireEvent.keyDown(document, { key: "Tab" });
        expect(innerA).toHaveFocus();
        // 焦点在内层最后一个元素上按 Tab → 绕回内层第一个
        innerB.focus();
        fireEvent.keyDown(document, { key: "Tab" });
        expect(innerClose).toHaveFocus();
        expect(screen.getByRole("button", { name: "外层按钮" })).not.toHaveFocus();
        expect(overlayOf("客户详情")).toHaveAttribute("inert");
    });
});

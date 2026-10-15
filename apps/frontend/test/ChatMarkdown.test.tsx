// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatMarkdown } from "@/components/ai/ChatMarkdown";

const renderer = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: renderer }));
beforeEach(() => {
    renderer.initialize.mockClear();
    renderer.render
        .mockReset()
        .mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>打开订单</text></svg>' });
});
afterEach(cleanup);

it("直接展示流程图，不显示源代码，并使用严格模式", async () => {
    render(
        <ChatMarkdown>{"先打开销售订单。\n\n```mermaid\nflowchart TD\nA[打开订单] --> B[确认删除]\n```"}</ChatMarkdown>,
    );
    await waitFor(() => expect(screen.getByRole("img", { name: "操作流程图" }).querySelector("svg")).not.toBeNull());
    expect(renderer.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict" }));
    expect(screen.queryByText(/flowchart TD/)).not.toBeInTheDocument();
});
it("流中未完成的图形先保留位置，结束后再绘制", () => {
    render(<ChatMarkdown streaming>{"```mermaid\nflowchart TD\nA[打开订单]"}</ChatMarkdown>);
    expect(screen.getByText("正在绘制流程图…")).toBeInTheDocument();
    expect(renderer.render).not.toHaveBeenCalled();
});
it("更新回答文字时保留已经绘制的流程图，避免页面高度跳动", async () => {
    const content = "```mermaid\nflowchart TD\nA[打开订单] --> B[确认删除]\n```";
    const { rerender } = render(<ChatMarkdown>{content}</ChatMarkdown>);
    const canvas = await screen.findByRole("img", { name: "操作流程图" });
    await waitFor(() => expect(canvas.querySelector("svg")).not.toBeNull());
    const svg = canvas.querySelector("svg");
    rerender(<ChatMarkdown>{content + "\n\n请核对订单。"}</ChatMarkdown>);
    expect(canvas.querySelector("svg")).toBe(svg);
    expect(renderer.render).toHaveBeenCalledTimes(1);
});
it("拒绝覆盖安全设置和外部链接，不显示图形源代码", async () => {
    render(
        <ChatMarkdown>{"```mermaid\n%%{init: {'securityLevel': 'loose'}}%%\nflowchart TD\nA-->B\n```"}</ChatMarkdown>,
    );
    expect(await screen.findByText("流程图暂时无法显示，请按文字步骤操作。")).toBeInTheDocument();
    expect(renderer.render).not.toHaveBeenCalled();
});

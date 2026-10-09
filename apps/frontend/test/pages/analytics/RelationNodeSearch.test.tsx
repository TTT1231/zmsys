// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { RelationNode } from "@/data/relations";
import { RelationNodeSearch } from "@/pages/analytics/RelationNodeSearch";

afterEach(cleanup);
const node = (id: string, name: string): RelationNode => ({
    id,
    name,
    type: "person",
    properties: {},
    facts: { type: "person", role: "经办人" },
});
const nodes = [node("person:1", "同名人员"), node("person:2", "同名人员"), node("person:3", "张经理")];

function Picker({ items = nodes, initial = null }: { items?: RelationNode[]; initial?: string | null }) {
    const [selectedId, setSelectedId] = useState(initial);
    return (
        <>
            <RelationNodeSearch nodes={items} selectedId={selectedId} onSelect={setSelectedId} />
            <span data-testid="selected">{selectedId}</span>
            <button>其他操作</button>
        </>
    );
}

it("大量节点关闭时没有候选 DOM；展开也最多渲染 40 个，搜索能找到列表尾部节点", async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 5_000 }, (_, index) => node(`person:${index}`, `人员 ${index}`));
    render(<Picker items={items} />);
    const input = screen.getByRole("combobox", { name: "查找节点" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    await user.click(input);
    expect(screen.getAllByRole("option")).toHaveLength(40);
    expect(screen.getByRole("status")).toHaveTextContent("还有更多，请输入关键词");
    await user.type(input, "person:4999");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByTestId("selected")).toHaveTextContent("person:4999");
    expect(input).toHaveValue("人员 4999");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
});

it("同名节点保持独立编号，方向键与回车选择真实 ID，焦点保持在输入框", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const input = screen.getByRole("combobox");
    await user.type(input, "同名");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    const activeId = input.getAttribute("aria-activedescendant");
    expect(document.getElementById(activeId!)).toHaveTextContent("经办人 · 记录尾号 …2");
    expect(document.getElementById(activeId!)).not.toHaveTextContent("person:2");
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("selected")).toHaveTextContent("person:2");
    expect(input).toHaveValue("同名人员");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "false");
});

it("按中文类型查询，空结果不触发选中，Esc 和离开输入框恢复已选名称", async () => {
    const user = userEvent.setup();
    render(<Picker initial="person:3" />);
    const input = screen.getByRole("combobox");
    await user.type(input, "人员");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    await user.clear(input);
    await user.type(input, "不存在的节点");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("未找到匹配节点");
    await user.keyboard("{ArrowDown}{Enter}{Escape}");
    expect(input).toHaveValue("张经理");
    expect(screen.getByTestId("selected")).toHaveTextContent("person:3");
    await user.click(input);
    await user.type(input, "同名");
    await user.click(screen.getByRole("button", { name: "其他操作" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("张经理");
});

it("候选层挂载在 body，鼠标选中保持焦点，关闭后移除 portal", async () => {
    const user = userEvent.setup();
    const { container } = render(<Picker />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    expect(input).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    const option = screen.getByRole("option", { name: /张经理/ });
    expect(option).toHaveTextContent("经办人");
    expect(option).not.toHaveTextContent("person:3");
    expect(option).not.toHaveTextContent("记录尾号");
    await user.click(option);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("张经理");
    expect(screen.getByTestId("selected")).toHaveTextContent("person:3");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("触屏 pointerdown 保留滚动默认行为，点击结果仍可选中且保持输入焦点", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    const option = screen.getByRole("option", { name: /张经理/ });
    expect(fireEvent.pointerDown(option, { pointerType: "touch" })).toBe(true);
    expect(fireEvent.mouseDown(option)).toBe(false);
    fireEvent.click(option);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("张经理");
    expect(screen.getByTestId("selected")).toHaveTextContent("person:3");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("候选层出现在输入框上方并随页面滚动更新，点外部空白也会关闭", () => {
    render(<Picker />);
    const input = screen.getByRole("combobox");
    let rect = new DOMRect(120, 400, 240, 32);
    vi.spyOn(input, "getBoundingClientRect").mockImplementation(() => rect);
    fireEvent.focus(input);
    const popup = screen.getByRole("listbox").parentElement!;
    expect(popup).toHaveStyle({ left: "120px", bottom: `${window.innerHeight - 400 + 4}px`, width: "280px" });
    rect = new DOMRect(80, 300, 240, 32);
    fireEvent.scroll(window);
    expect(popup).toHaveStyle({ left: "80px", bottom: `${window.innerHeight - 300 + 4}px`, maxHeight: "288px" });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("中文输入法回车不选中，禁用时不能展开", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<RelationNodeSearch nodes={nodes} selectedId={null} onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.compositionEnd(input);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("person:1");
    rerender(<RelationNodeSearch nodes={nodes} selectedId={null} onSelect={onSelect} disabled />);
    fireEvent.focus(input);
    fireEvent.click(input);
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

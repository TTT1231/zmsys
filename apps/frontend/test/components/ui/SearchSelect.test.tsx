// @vitest-environment jsdom
/* 客户组合框：即时结果、明确选中、键盘操作与弹窗内 Esc 边界。 */
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SearchSelect } from "@/components/ui/SearchSelect";
import { Modal } from "@/components/ui/Modal";
afterEach(cleanup);
const options = [
    { value: "CUS-001", label: "海晏电器" },
    { value: "CUS-002", label: "铭工电器" },
];
function Picker({ initial = "" }: { initial?: string }) {
    const [value, setValue] = useState(initial);
    return (
        <>
            <SearchSelect label="客户" value={value} onChange={setValue} options={options} required />
            <span data-testid="value">{value}</span>
        </>
    );
}
it("输入即显示结果与空态，只有选择候选项后才提交真实编号", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const input = screen.getByRole("combobox", { name: /客户/ });
    await user.type(input, "海");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByTestId("value")).toBeEmptyDOMElement();
    await user.click(screen.getByRole("option", { name: /海晏电器/ }));
    expect(input).toHaveValue("海晏电器");
    expect(screen.getByTestId("value")).toHaveTextContent("CUS-001");
    await user.click(input);
    await user.type(input, "不存在");
    expect(screen.getByRole("status")).toHaveTextContent("未找到匹配客户");
    expect(screen.getByTestId("value")).toBeEmptyDOMElement();
});
it("支持按编号搜索和方向键回车选择，焦点停留输入框", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const input = screen.getByRole("combobox");
    await user.type(input, "CUS-002");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveFocus();
    expect(input).toHaveValue("铭工电器");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});
it("仅打开再离开不会丢失已有客户；第一次 Esc 只关闭候选层", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(
        <Modal open title="新建订单" onClose={close}>
            <Picker initial="CUS-001" />
        </Modal>,
    );
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("海晏电器");
    expect(close).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(close).toHaveBeenCalledOnce();
});
it("错误关联到输入框，中文输入法确认不选择客户", () => {
    const onChange = vi.fn();
    render(<SearchSelect label="客户" value="" onChange={onChange} options={options} error="请选择客户" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("请选择客户");
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileListSearch } from "@/components/layout/MobileListSearch";
import { ListToolbar } from "@/components/ui/ListToolbar";
import { MobileListControls } from "@/components/ui/MobileListControls";
import { ListViewProvider } from "@/context/ListViewProvider";
import { useRememberedListState } from "@/context/useListView";
import { useTableControls } from "@/lib/useTableControls";

beforeEach(() => {
    vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function ListPage() {
    const { keyword, onKeywordChange } = useTableControls();
    const [operator, setOperator] = useRememberedListState("operator", "全部登记人");
    return (
        <>
            <ListToolbar
                keyword={keyword}
                onKeywordChange={onKeywordChange}
                placeholder="客户名、订单号或 BOM 编码"
                filtersActive={!!keyword}
                onClear={() => onKeywordChange("")}
                mobileContent={
                    <MobileListControls
                        fields={[
                            {
                                key: "operator",
                                label: "登记人",
                                value: operator,
                                defaultValue: "全部登记人",
                                options: ["全部登记人", "登记人甲"],
                            },
                        ]}
                        onApply={draft => setOperator(draft.operator!)}
                    />
                }
            />
            <output aria-label="当前搜索">{keyword}</output>
            <output aria-label="当前登记人">{operator}</output>
        </>
    );
}

function Harness() {
    const [account, setAccount] = useState("甲");
    return (
        <MemoryRouter initialEntries={["/orders"]}>
            <button onClick={() => setAccount("乙")}>切换账号</button>
            <ListViewProvider key={account}>
                <MobileListSearch />
                <Link to="/orders">去订单</Link>
                <Link to="/customers">去客户</Link>
                <Link to="/workbench">去工作台</Link>
                <Routes>
                    <Route path="/orders" element={<ListPage key="orders" />} />
                    <Route path="/customers" element={<ListPage key="customers" />} />
                    <Route path="/workbench" element={<p>工作台</p>} />
                </Routes>
            </ListViewProvider>
        </MemoryRouter>
    );
}

it("搜索先编辑草稿，取消不生效；回车确认并恢复入口焦点", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "搜索销售订单" });
    trigger.focus();
    fireEvent.click(trigger);
    let dialog = screen.getByRole("dialog", { name: "搜索销售订单" });
    let input = within(dialog).getByRole("searchbox", { name: "搜索内容" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "不要生效" } });
    expect(screen.getByLabelText("当前搜索")).toHaveTextContent("");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    dialog = screen.getByRole("dialog");
    input = within(dialog).getByRole("searchbox");
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "  KW0001  " } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter", isComposing: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("当前搜索")).toHaveTextContent("KW0001");
    expect(trigger).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(screen.getByLabelText("当前搜索")).toBeEmptyDOMElement();
});

it("页面搜索和人员条件分别记忆，工作台搜索禁用，切换账号后清空", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "搜索销售订单" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "订单甲" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("combobox", { name: "登记人" }), {
        target: { value: "登记人甲" },
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
    fireEvent.click(screen.getByRole("link", { name: "去客户" }));
    expect(screen.getByLabelText("当前搜索")).toBeEmptyDOMElement();
    expect(screen.getByLabelText("当前登记人")).toHaveTextContent("全部登记人");
    expect(screen.getByRole("button", { name: "搜索客户档案" })).toBeEnabled();
    fireEvent.click(screen.getByRole("link", { name: "去订单" }));
    expect(screen.getByLabelText("当前搜索")).toHaveTextContent("订单甲");
    expect(screen.getByLabelText("当前登记人")).toHaveTextContent("登记人甲");
    fireEvent.click(screen.getByRole("link", { name: "去工作台" }));
    expect(screen.getByRole("button", { name: "当前页面不支持搜索" })).toBeDisabled();
    fireEvent.click(screen.getByRole("link", { name: "去订单" }));
    fireEvent.click(screen.getByRole("button", { name: "切换账号" }));
    expect(screen.getByLabelText("当前搜索")).toBeEmptyDOMElement();
    expect(screen.getByLabelText("当前登记人")).toHaveTextContent("全部登记人");
});

it("筛选的选择和重置只在确认后生效，清空筛选保留当前搜索", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "搜索销售订单" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "KW0001" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    let dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "登记人甲" } });
    expect(screen.getByLabelText("当前登记人")).toHaveTextContent("全部登记人");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox")).toHaveValue("全部登记人");
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "登记人甲" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认" }));
    expect(screen.getByRole("button", { name: "筛选，已选 1 项" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选，已选 1 项" }));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "重置" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.getByLabelText("当前登记人")).toHaveTextContent("登记人甲");
    const clear = screen.getByRole("button", { name: "清空筛选" });
    clear.focus();
    fireEvent.click(clear);
    expect(screen.getByLabelText("当前登记人")).toHaveTextContent("全部登记人");
    expect(screen.getByLabelText("当前搜索")).toHaveTextContent("KW0001");
    expect(screen.queryByRole("button", { name: "清空筛选" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选" })).toHaveFocus();
});

it("手机工具栏只保留筛选和业务操作，多项条件确认后显示数量", () => {
    function Toolbar() {
        const [status, setStatus] = useState("全部状态");
        const [category, setCategory] = useState("全部品类");
        return (
            <MobileListControls
                fields={[
                    {
                        key: "status",
                        label: "状态",
                        value: status,
                        defaultValue: "全部状态",
                        options: ["全部状态", "已入库"],
                    },
                    {
                        key: "category",
                        label: "品类",
                        value: category,
                        defaultValue: "全部品类",
                        options: ["全部品类", "旋转开关"],
                    },
                    {
                        key: "operator",
                        label: "登记人",
                        value: "全部登记人",
                        defaultValue: "全部登记人",
                        options: ["全部登记人"],
                    },
                ]}
                onApply={draft => {
                    setStatus(draft.status!);
                    setCategory(draft.category!);
                }}
                action={<button>入库</button>}
            />
        );
    }
    render(<Toolbar />);
    expect(screen.getByRole("button", { name: "入库" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "状态" })).toHaveDisplayValue("全部");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "状态" }), {
        target: { value: "已入库" },
    });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "品类" }), {
        target: { value: "旋转开关" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认" }));
    expect(screen.getByRole("button", { name: "筛选，已选 2 项" })).toHaveTextContent("筛选 · 2");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选，已选 2 项" }));
    expect(within(screen.getByRole("dialog")).getByRole("combobox", { name: "品类" })).toHaveValue("旋转开关");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "重置" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "清空筛选" })).not.toBeInTheDocument();
});

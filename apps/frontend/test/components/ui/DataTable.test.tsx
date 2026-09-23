// @vitest-environment jsdom
/* 共用表格：列宽与排序互不干扰，列显隐/空态对齐、密度和账号隔离持久化。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DataTable } from "@/components/ui/DataTable";
import { SortTh } from "@/components/ui/SortTh";
const auth = vi.hoisted(() => ({ account: "user-a" }));
vi.mock("@/context/useApp", () => ({ useApp: () => ({ user: auth }) }));
function stubResizeObserver() {
    const callbacks: Array<() => void> = [];
    class FakeObserver {
        constructor(callback: () => void) {
            callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
        unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", FakeObserver);
    return callbacks;
}
/** 视口测量合并进 rAF（防逐帧重渲染）：断言前需等排队的帧落地 */
const flushFrames = async (frames = 1) => {
    for (let i = 0; i < frames; i += 1) {
        await act(async () => {
            await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
        });
    }
};
beforeEach(() => {
    localStorage.clear();
    auth.account = "user-a";
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});
function Table({ sort = () => {}, empty = false }: { sort?: () => void; empty?: boolean }) {
    return (
        <DataTable tableId="test" defaultWidths={[180, 160, 240, 120]}>
            <thead>
                <tr>
                    <th>编号</th>
                    <SortTh label="数量" active={false} dir="asc" onSort={sort} />
                    <th>备注</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody>
                {empty ? (
                    <tr>
                        <td colSpan={4}>暂无数据</td>
                    </tr>
                ) : (
                    <tr>
                        <td>001</td>
                        <td>300</td>
                        <td>按期交付</td>
                        <td>
                            <button>详情</button>
                        </td>
                    </tr>
                )}
            </tbody>
        </DataTable>
    );
}
it("键盘调整列宽不触发排序，刷新后保留宽度且账号隔离", () => {
    const sort = vi.fn();
    const view = render(<Table sort={sort} />);
    const handle = screen.getByRole("separator", { name: "调整数量列宽" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "176");
    expect(sort).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "数量" }));
    expect(sort).toHaveBeenCalledOnce();
    view.unmount();
    render(<Table />);
    expect(screen.getByRole("separator", { name: "调整数量列宽" })).toHaveAttribute("aria-valuenow", "176");
    cleanup();
    auth.account = "user-b";
    render(<Table />);
    expect(screen.getByRole("separator", { name: "调整数量列宽" })).toHaveAttribute("aria-valuenow", "160");
});
it("隐藏次要列时表头、单元格和空态同步，恢复推荐设置重置密度与宽度", async () => {
    const user = userEvent.setup();
    const view = render(<Table />);
    await user.click(screen.getByRole("button", { name: "显示设置" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("checkbox", { name: "编号" })).toBeDisabled();
    expect(dialog.getByRole("checkbox", { name: "操作" })).toBeDisabled();
    await user.click(dialog.getByRole("checkbox", { name: "数量" }));
    await user.click(dialog.getByRole("radio", { name: "紧凑" }));
    await user.click(dialog.getByRole("button", { name: "完成" }));
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.queryByRole("cell", { name: "300" })).not.toBeInTheDocument();
    expect(screen.getByRole("table").closest(".managed-table")).toHaveAttribute("data-density", "compact");
    view.rerender(<Table empty />);
    expect(screen.getByRole("cell", { name: "暂无数据" })).toHaveAttribute("colspan", "3");
    await user.click(screen.getByRole("button", { name: "显示设置" }));
    await user.click(screen.getByRole("button", { name: "恢复推荐设置" }));
    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
    expect(screen.getByRole("cell", { name: "暂无数据" })).toHaveAttribute("colspan", "4");
    expect(screen.getByRole("table").closest(".managed-table")).toHaveAttribute("data-density", "standard");
});
it("损坏的本地偏好不会阻断表格", () => {
    localStorage.setItem("zm-table:v2:user-a:test", "{broken");
    render(<Table />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
});

it("列宽使用直白选项，调宽数量列不会挤压备注列", async () => {
    const user = userEvent.setup();
    render(<Table />);
    await user.click(screen.getByRole("button", { name: "显示设置" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "数量的宽窄" }), "wider");
    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.getByRole("separator", { name: "调整数量列宽" })).toHaveAttribute("aria-valuenow", "240");
    expect(screen.getByRole("separator", { name: "调整备注列宽" })).toHaveAttribute("aria-valuenow", "240");
    await user.click(screen.getByRole("button", { name: "显示设置" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "数量的宽窄" }), "recommended");
    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.getByRole("separator", { name: "调整数量列宽" })).toHaveAttribute("aria-valuenow", "160");
});

it("指针拖动改变列宽，结束拖动后移动不再更改宽度", () => {
    render(<Table />);
    const handle = screen.getByRole("separator", { name: "调整数量列宽" });
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 160 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 224 });
    expect(handle).toHaveAttribute("aria-valuenow", "224");
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(JSON.parse(localStorage.getItem("zm-table:v2:user-a:test")!).widths).toEqual({ 数量: 224 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 });
    expect(handle).toHaveAttribute("aria-valuenow", "224");
});

it("操作列固定，旧偏好中的极窄操作列不会恢复，也没有拖动入口", async () => {
    localStorage.setItem("zm-table:v2:user-a:test", JSON.stringify({ widths: { 操作: 96 } }));
    const user = userEvent.setup();
    render(<Table />);
    expect(screen.queryByRole("separator", { name: "调整操作列宽" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "显示设置" }));
    expect(screen.queryByRole("spinbutton", { name: "操作列宽" })).not.toBeInTheDocument();
    expect(screen.getByText("始终显示")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).not.toHaveTextContent("px");
});

it("全部可调列锁定后以表格内弹性区铺满，操作列保持最右", async () => {
    const callbacks = stubResizeObserver();
    // 备注列硬下限 140（两行内容列），保存值低于下限时渲染时顶到下限
    localStorage.setItem("zm-table:v2:user-a:test", JSON.stringify({ widths: { 编号: 150, 数量: 120, 备注: 140 } }));
    const view = render(<Table />);
    const body = view.container.querySelector(".managed-table-body")!;
    Object.defineProperty(body, "clientWidth", { configurable: true, get: () => 900 });
    act(() => callbacks.at(-1)!());
    await flushFrames();

    const table = screen.getByRole("table");
    expect(table).toHaveStyle({ width: "900px" });
    expect(table.querySelector("col[data-table-fill]")).toHaveStyle({ width: "370px" });
    const operationHeader = screen.getByRole("columnheader", { name: "操作" });
    expect(operationHeader.previousElementSibling).toHaveAttribute("data-table-fill");
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
    const row = screen.getByRole("cell", { name: "300" }).parentElement!;
    expect(row.children).toHaveLength(5);
    expect(row.children[3]).toHaveAttribute("data-table-fill");

    view.rerender(<Table empty />);
    expect(screen.getByRole("cell", { name: "暂无数据" })).toHaveAttribute("colspan", "5");
});

it("紧凑档宽内容列收紧到 220，剩余宽度整体交给弹性区", async () => {
    const callbacks = stubResizeObserver();
    localStorage.setItem("zm-table:v2:user-a:test", JSON.stringify({ density: "compact" }));
    const view = render(
        <DataTable tableId="test" defaultWidths={[370, 330, 120]}>
            <thead>
                <tr>
                    <th>BOM 编码</th>
                    <th>BOM 备注</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>KW001</td>
                    <td>—</td>
                    <td>
                        <button>详情</button>
                    </td>
                </tr>
            </tbody>
        </DataTable>,
    );
    const body = view.container.querySelector(".managed-table-body")!;
    Object.defineProperty(body, "clientWidth", { configurable: true, get: () => 900 });
    act(() => callbacks.at(-1)!());
    await flushFrames();
    expect(screen.getByRole("separator", { name: "调整BOM 编码列宽" })).toHaveAttribute("aria-valuenow", "220");
    expect(screen.getByRole("separator", { name: "调整BOM 备注列宽" })).toHaveAttribute("aria-valuenow", "220");
    // 剩余 900-560=340 不再分给内容列，集中为操作列前的弹性区
    expect(view.container.querySelector("col[data-table-fill]")).toHaveStyle({ width: "340px" });
});

it("拖动只改变当前列，取消拖动恢复原宽", () => {
    render(<Table />);
    const handle = screen.getByRole("separator", { name: "调整数量列宽" });
    handle.setPointerCapture = vi.fn();
    const before = localStorage.getItem("zm-table:v2:user-a:test");
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 160 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 });
    expect(handle).toHaveAttribute("aria-valuenow", "600");
    expect(localStorage.getItem("zm-table:v2:user-a:test")).toBe(before);
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(handle).toHaveAttribute("aria-valuenow", "160");
});

it("表头与表体在同一个横向滚动区，纵向不再限制高度", () => {
    const { container } = render(<Table />);
    const body = container.querySelector(".managed-table-body")!;
    expect(body.querySelector("thead")).not.toBeNull();
    expect(body.querySelector("tbody")).not.toBeNull();
    expect(body.className).not.toContain("max-h-");
});
it("旧布局完全弃用，新版列宽从推荐值开始", () => {
    localStorage.setItem(
        "zm-table:v1:user-a:test",
        JSON.stringify({ widths: { 数量: 96 }, hidden: ["备注"], compact: true }),
    );
    render(<Table />);
    expect(screen.getByRole("separator", { name: "调整数量列宽" })).toHaveAttribute("aria-valuenow", "160");
    expect(screen.getByRole("columnheader", { name: "备注" })).toBeInTheDocument();
    expect(localStorage.getItem("zm-table:v1:user-a:test")).toBeNull();
});
it("聚焦列边界时高亮整列，取消拖动清除高亮", () => {
    render(<Table />);
    const handle = screen.getByRole("separator", { name: "调整数量列宽" });
    fireEvent.focus(handle);
    expect(screen.getByRole("columnheader", { name: "数量" })).toHaveClass("column-highlight");
    expect(screen.getByRole("cell", { name: "300" })).toHaveClass("column-highlight");
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 160 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(screen.getByRole("cell", { name: "300" })).not.toHaveClass("column-highlight");
});

it("ResizeObserver 回调的宽度与槽位不变时不重渲染，阻断滚动条临界抖动", async () => {
    const callbacks = stubResizeObserver();
    const counter = { renders: 0 };
    const countRender = () => {
        counter.renders += 1;
    };
    const Probe = () => {
        countRender();
        return <th>探针</th>;
    };
    const { container } = render(
        <DataTable tableId="resize" defaultWidths={[180, 160, 240, 120]}>
            <thead>
                <tr>
                    <Probe />
                    <th>备注</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>001</td>
                    <td>按期交付</td>
                    <td>
                        <button>详情</button>
                    </td>
                </tr>
            </tbody>
        </DataTable>,
    );
    const body = container.querySelector(".managed-table-body")!;
    const setSize = (clientWidth: number, offsetWidth: number) => {
        Object.defineProperty(body, "clientWidth", { configurable: true, get: () => clientWidth });
        Object.defineProperty(body, "offsetWidth", { configurable: true, get: () => offsetWidth });
    };
    // 挂载时 clientWidth 为 0，与初始视口一致，不应产生额外渲染
    expect(counter.renders).toBe(1);
    setSize(800, 817);
    act(() => callbacks.at(-1)!());
    act(() => callbacks.at(-1)!());
    act(() => callbacks.at(-1)!());
    await flushFrames();
    // 宽度只变化一次：重复回调合并进同一帧，滚动条出现/消失不再来回拉扯列宽
    expect(counter.renders).toBe(2);
    setSize(760, 760);
    act(() => callbacks.at(-1)!());
    await flushFrames();
    expect(counter.renders).toBe(3);
});

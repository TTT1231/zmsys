// @vitest-environment jsdom
/* 共用表格：列宽与排序互不干扰，列显隐/空态对齐、密度和账号隔离持久化。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DataTable } from "@/components/ui/DataTable";
import { SortTh } from "@/components/ui/SortTh";
const auth = vi.hoisted(() => ({ account: "user-a" }));
vi.mock("@/context/AppContext", () => ({ useApp: () => ({ user: auth }) }));
beforeEach(() => {
    localStorage.clear();
    auth.account = "user-a";
});
afterEach(cleanup);
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
it("隐藏次要列时表头、单元格和空态同步，恢复默认重置密度与宽度", async () => {
    const user = userEvent.setup();
    const view = render(<Table />);
    await user.click(screen.getByRole("button", { name: "表格设置" }));
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
    await user.click(screen.getByRole("button", { name: "表格设置" }));
    await user.click(screen.getByRole("button", { name: "恢复默认" }));
    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
    expect(screen.getByRole("cell", { name: "暂无数据" })).toHaveAttribute("colspan", "4");
    expect(screen.getByRole("table").closest(".managed-table")).toHaveAttribute("data-density", "comfortable");
});
it("损坏的本地偏好不会阻断表格", () => {
    localStorage.setItem("zm-table:v1:user-a:test", "{broken");
    render(<Table />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
});

it("列宽数值支持清空后完整输入，提交时才限制范围", async () => {
    const user = userEvent.setup();
    render(<Table />);
    await user.click(screen.getByRole("button", { name: "表格设置" }));
    const width = screen.getByRole("spinbutton", { name: "数量列宽" });
    await user.clear(width);
    await user.type(width, "240");
    expect(width).toHaveValue(240);
    await user.tab();
    expect(screen.getByRole("separator", { name: "调整数量列宽" })).toHaveAttribute("aria-valuenow", "240");
});

it("指针拖动改变列宽，结束拖动后移动不再更改宽度", () => {
    render(<Table />);
    const handle = screen.getByRole("separator", { name: "调整数量列宽" });
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 160 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 224 });
    expect(handle).toHaveAttribute("aria-valuenow", "224");
    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 });
    expect(handle).toHaveAttribute("aria-valuenow", "224");
});

it("操作列固定，旧偏好中的极窄操作列不会恢复，也没有拖动入口", async () => {
    localStorage.setItem("zm-table:v1:user-a:test", JSON.stringify({ widths: { 操作: 96 } }));
    const user = userEvent.setup();
    render(<Table />);
    expect(screen.queryByRole("separator", { name: "调整操作列宽" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "表格设置" }));
    expect(screen.queryByRole("spinbutton", { name: "操作列宽" })).not.toBeInTheDocument();
    expect(screen.getByText("固定 120 px")).toBeInTheDocument();
});

it("拖动期间保持总宽与操作列不变，取消拖动恢复原宽", () => {
    render(<Table />);
    const handle = screen.getByRole("separator", { name: "调整数量列宽" });
    handle.setPointerCapture = vi.fn();
    const before = localStorage.getItem("zm-table:v1:user-a:test");
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 160 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 });
    expect(handle).toHaveAttribute("aria-valuenow", "280");
    expect(localStorage.getItem("zm-table:v1:user-a:test")).toBe(before);
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(handle).toHaveAttribute("aria-valuenow", "160");
});

it("只有表体滚动，横向滚动同步到独立表头", () => {
    const { container } = render(<Table />);
    const body = container.querySelector(".managed-table-body")!;
    const header = container.querySelector(".managed-table-header > div")!;
    expect(body.querySelector("thead")).toBeNull();
    fireEvent.scroll(body, { target: { scrollLeft: 123 } });
    expect(header.scrollLeft).toBe(123);
});

// @vitest-environment jsdom
/* 行拖拽手动排序：生效排序下手柄禁用；三击表头取消排序后启用；键盘 ↑/↓ 换行与行位播报；
   重新点表头排序即作废手动序。指针拖拽链路（dnd-kit + 插入线几何）依赖真实布局，
   属运行时验证项；键盘路径与拖拽共用同一提交函数，此处覆盖该路径。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { OrdersPage } from "@/pages/orders/OrdersPage";
import { detailOrder, detailSnapshot } from "../../fixtures/recordDetails";

const snapshot = {
    ...detailSnapshot,
    orders: [
        { ...detailOrder, orderNo: "SO-001", qty: 100 },
        { ...detailOrder, orderNo: "SO-002", qty: 200 },
        { ...detailOrder, orderNo: "SO-003", qty: 300 },
    ],
};
vi.mock("@/context/useApp", () => ({ useApp: () => ({ role: "staff", can: () => false }) }));
vi.mock("@/data/queries", () => ({
    useWbSnapshot: () => ({ data: snapshot }),
    useWbRefresh: () => ({ refresh: vi.fn() }),
}));
const toastSpy = vi.fn();
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => toastSpy }));
afterEach(() => {
    cleanup();
    toastSpy.mockClear();
});

const orderNos = () =>
    within(screen.getByRole("table"))
        .getAllByRole("row")
        .slice(1)
        // 行内第一个按钮是拖拽手柄（无文本），取第一个有文本的即订单号按钮
        .map(
            row =>
                within(row)
                    .getAllByRole("button")
                    .map(btn => btn.textContent)
                    .filter(Boolean)[0],
        );
const handleOf = (orderNo: string) =>
    screen.getByRole("button", { name: `拖拽调整 ${orderNo} 的显示顺序，聚焦后可用上下方向键移动` });

const cancelSort = () => {
    // 三态循环：默认升序 → 降序 → 取消（列表回到数据顺序，手柄才可用）
    const header = screen.getByRole("button", { name: /销售订单号/ });
    fireEvent.click(header);
    fireEvent.click(header);
};

it("默认带排序时手柄禁用，悬停提示先取消排序", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    expect(handleOf("SO-001")).toBeDisabled();
    expect(handleOf("SO-001")).toHaveAttribute("title", "当前按「销售订单号」排序，点击表头取消排序后可手动调整");
});

it("取消排序后手柄启用，键盘 ↓/↑ 换行并播报行位", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    cancelSort();
    expect(handleOf("SO-001")).toBeEnabled();
    fireEvent.keyDown(handleOf("SO-001"), { key: "ArrowDown" });
    expect(orderNos()).toEqual(["SO-002", "SO-001", "SO-003"]);
    expect(toastSpy).toHaveBeenCalledWith("已移至第 2 行，共 3 行");
    fireEvent.keyDown(handleOf("SO-001"), { key: "ArrowUp" });
    expect(orderNos()).toEqual(["SO-001", "SO-002", "SO-003"]);
});

it("首位再上移、末位再下移均为原地不动", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    cancelSort();
    fireEvent.keyDown(handleOf("SO-001"), { key: "ArrowUp" });
    fireEvent.keyDown(handleOf("SO-003"), { key: "ArrowDown" });
    expect(orderNos()).toEqual(["SO-001", "SO-002", "SO-003"]);
    expect(toastSpy).not.toHaveBeenCalled();
});

it("重新点表头排序即作废手动序，手柄回到禁用", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    cancelSort();
    fireEvent.keyDown(handleOf("SO-001"), { key: "ArrowDown" });
    expect(orderNos()).toEqual(["SO-002", "SO-001", "SO-003"]);
    fireEvent.click(screen.getByRole("button", { name: /销售订单号/ }));
    expect(orderNos()).toEqual(["SO-001", "SO-002", "SO-003"]);
    expect(handleOf("SO-001")).toBeDisabled();
});

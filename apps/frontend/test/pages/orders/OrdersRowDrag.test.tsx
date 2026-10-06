// @vitest-environment jsdom
/* 行拖拽手动排序：排序生效时手柄同样可用，拖拽/键盘提交即暂停当前排序（最后一次操作生效）；
   重新点表头排序恢复排序并作废手动序；键盘 ↑/↓ 换行与行位播报。
   指针拖拽链路（dnd-kit + 插入线几何）依赖真实布局，属运行时验证项；
   键盘路径与拖拽共用同一提交函数，此处覆盖该路径。 */
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
    useWbView: () => ({ snap: snapshot, isLoading: false, refreshing: false }),
    useWbRefresh: () => ({ refresh: vi.fn() }),
    useUnarchiveOrder: () => ({ mutate: vi.fn(), isPending: false }),
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
const orderNoSortState = () => screen.getByRole("columnheader", { name: /销售订单号/ }).getAttribute("aria-sort");

it("排序生效时手柄同样可用，悬停提示拖拽将暂停排序", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    expect(handleOf("SO-001")).toBeEnabled();
    expect(handleOf("SO-001")).toHaveAttribute(
        "title",
        "当前按「销售订单号」排序，拖拽调整将暂停该排序，点击表头可重新排序",
    );
});

it("排序生效下键盘移动即暂停排序，落位按当前显示序", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    fireEvent.keyDown(handleOf("SO-001"), { key: "ArrowDown" });
    expect(orderNos()).toEqual(["SO-002", "SO-001", "SO-003"]);
    // 排序被暂停：aria-sort 回到 none，手柄提示切回手动序文案；此后仍可继续微调
    expect(orderNoSortState()).toBe("none");
    expect(handleOf("SO-001")).toHaveAttribute("title", "拖拽调整顺序：仅改变当前视图显示，刷新或重新排序后恢复");
    fireEvent.keyDown(handleOf("SO-001"), { key: "ArrowUp" });
    expect(orderNos()).toEqual(["SO-001", "SO-002", "SO-003"]);
});

it("暂停排序后重新点表头即恢复排序，作废手动序", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    fireEvent.keyDown(handleOf("SO-001"), { key: "ArrowDown" });
    expect(orderNos()).toEqual(["SO-002", "SO-001", "SO-003"]);
    fireEvent.click(screen.getByRole("button", { name: /销售订单号/ }));
    expect(orderNos()).toEqual(["SO-001", "SO-002", "SO-003"]);
    expect(orderNoSortState()).toBe("ascending");
});

it("首位再上移、末位再下移均为原地不动，不播报也不暂停排序", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    fireEvent.keyDown(handleOf("SO-001"), { key: "ArrowUp" });
    fireEvent.keyDown(handleOf("SO-003"), { key: "ArrowDown" });
    expect(orderNos()).toEqual(["SO-001", "SO-002", "SO-003"]);
    expect(toastSpy).not.toHaveBeenCalled();
    expect(orderNoSortState()).toBe("ascending");
});

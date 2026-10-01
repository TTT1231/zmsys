// @vitest-environment jsdom
/* 订单列表排序：默认订单号升序，表头点击切换升/降序，移动端排序下拉与表头共享同一状态。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { OrdersPage } from "@/pages/orders/OrdersPage";
import { detailOrder, detailSnapshot } from "../../fixtures/recordDetails";
const snapshot = {
    ...detailSnapshot,
    orders: [
        { ...detailOrder, orderNo: "SO-003", qty: 300, outbound: 100, deliverDate: "2026-10-01" },
        { ...detailOrder, orderNo: "SO-001", qty: 100, outbound: 0, deliverDate: "2026-12-01" },
        { ...detailOrder, orderNo: "SO-002", qty: 200, outbound: 200, deliverDate: "2026-11-01" },
    ],
};
vi.mock("@/context/useApp", () => ({ useApp: () => ({ role: "staff", can: () => false }) }));
vi.mock("@/data/queries", () => ({
    useWbView: () => ({ snap: snapshot, isLoading: false, refreshing: false }),
    useWbRefresh: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => vi.fn() }));
afterEach(cleanup);

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

it("默认按销售订单号升序", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    expect(orderNos()).toEqual(["SO-001", "SO-002", "SO-003"]);
});

it("点击订单数量表头先升序再降序", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    const header = screen.getByRole("button", { name: /订单数量/ });
    fireEvent.click(header);
    expect(orderNos()).toEqual(["SO-001", "SO-002", "SO-003"]);
    expect(screen.getByRole("columnheader", { name: /订单数量/ })).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(header);
    expect(orderNos()).toEqual(["SO-003", "SO-002", "SO-001"]);
    expect(screen.getByRole("columnheader", { name: /订单数量/ })).toHaveAttribute("aria-sort", "descending");
});

it("点击交货日期表头按日期升序", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /交货日期/ }));
    expect(orderNos()).toEqual(["SO-003", "SO-002", "SO-001"]);
});

it("移动端排序下拉共享同一排序状态", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "排序列表" }), { target: { value: "qty:desc" } });
    expect(orderNos()).toEqual(["SO-003", "SO-002", "SO-001"]);
    expect(screen.getByRole("columnheader", { name: /订单数量/ })).toHaveAttribute("aria-sort", "descending");
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrdersPage } from "@/pages/orders/OrdersPage";
import { detailOrder, detailSnapshot } from "../../fixtures/recordDetails";

const snapshot = {
    ...detailSnapshot,
    orders: [
        detailOrder,
        { ...detailOrder, orderNo: "DONE", outbound: detailOrder.qty },
        { ...detailOrder, orderNo: "NO-STOCK", qty: 10000, outbound: 0 },
    ],
};
vi.mock("@/context/useApp", () => ({ useApp: () => ({ role: "warehouse", can: () => false }) }));
vi.mock("@/data/queries", () => ({
    useWbView: () => ({ snap: snapshot, isLoading: false, refreshing: false }),
    useWbRefresh: () => ({ refresh: vi.fn() }),
    useUnarchiveOrder: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteCustomer: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => vi.fn() }));
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
const cards = () => [...document.querySelectorAll(".mobile-records article")];

it("仓管手机端的全部包含已完成与无库存订单，不叠加默认可发货条件", () => {
    render(
        <MemoryRouter initialEntries={["/orders?task=ready"]}>
            <OrdersPage />
        </MemoryRouter>,
    );
    expect(cards()).toHaveLength(3);
    const group = within(screen.getByRole("group", { name: "订单完成情况" }));
    fireEvent.click(group.getByRole("button", { name: "已完成" }));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent("DONE");
    fireEvent.click(group.getByRole("button", { name: "未完成" }));
    expect(cards()).toHaveLength(2);
    expect(cards().some(card => card.textContent?.includes("NO-STOCK"))).toBe(true);
    fireEvent.click(group.getByRole("button", { name: "全部" }));
    expect(cards()).toHaveLength(3);
});

it("桌面的细分状态和交期不会在手机端形成看不见的筛选", () => {
    render(
        <MemoryRouter initialEntries={["/orders"]}>
            <OrdersPage />
        </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("按状态筛选"), { target: { value: "已完成" } });
    expect(cards()).toHaveLength(3);
});

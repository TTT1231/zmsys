// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrdersPage } from "@/pages/orders/OrdersPage";
import { detailBom, detailOrder, detailSnapshot } from "../../fixtures/recordDetails";

const snapshot = {
    ...detailSnapshot,
    boms: [detailBom, { ...detailBom, code: "OTHER", name: "旋转开关" }],
    orders: [
        detailOrder,
        { ...detailOrder, orderNo: "DONE", outbound: detailOrder.qty, deliverDate: "2026-10-01" },
        { ...detailOrder, orderNo: "NO-STOCK", bomCode: "OTHER", qty: 10000, outbound: 0, deliverDate: "2026-10-15" },
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
const openFilters = () => {
    fireEvent.click(screen.getByRole("button", { name: /^筛选/ }));
    return within(screen.getByRole("dialog", { name: "筛选" }));
};
const selectStatus = (status: string) => {
    const dialog = openFilters();
    fireEvent.change(dialog.getByRole("combobox", { name: "订单状态" }), { target: { value: status } });
    fireEvent.click(dialog.getByRole("button", { name: "确认" }));
};

it("仓管手机端的全部包含已完成与无库存订单，不叠加默认可发货条件", () => {
    render(
        <MemoryRouter initialEntries={["/orders?task=ready"]}>
            <OrdersPage />
        </MemoryRouter>,
    );
    expect(cards()).toHaveLength(3);
    expect(screen.queryByRole("group", { name: "订单完成情况" })).not.toBeInTheDocument();
    expect(document.querySelector(".mobile-list-controls select")).toBeNull();
    selectStatus("已完成");
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent("DONE");
    selectStatus("未完成");
    expect(cards()).toHaveLength(2);
    expect(cards().some(card => card.textContent?.includes("NO-STOCK"))).toBe(true);
    selectStatus("全部状态");
    expect(cards()).toHaveLength(3);
});

it("手机细分状态与完成度是同一个单选，不叠加桌面的快捷状态", () => {
    render(
        <MemoryRouter initialEntries={["/orders"]}>
            <OrdersPage />
        </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("按状态筛选"), { target: { value: "已完成" } });
    expect(cards()).toHaveLength(3);
    selectStatus("待备货");
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent("NO-STOCK");
    selectStatus("已完成");
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent("DONE");
});

it("状态、品类和交期同时确认后筛选，重置取消保留原结果，一键清空恢复全部", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    let dialog = openFilters();
    fireEvent.change(dialog.getByRole("combobox", { name: "订单状态" }), { target: { value: "未完成" } });
    fireEvent.change(dialog.getByRole("combobox", { name: "品类" }), { target: { value: "新微动" } });
    fireEvent.change(dialog.getByRole("combobox", { name: "交期" }), { target: { value: "custom" } });
    fireEvent.change(dialog.getByLabelText("交货开始日期"), { target: { value: "2026-09-01" } });
    fireEvent.change(dialog.getByLabelText("交货结束日期"), { target: { value: "2026-09-30" } });
    expect(cards()).toHaveLength(3);
    fireEvent.click(dialog.getByRole("button", { name: "确认" }));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent(detailOrder.orderNo);
    expect(screen.getByRole("button", { name: "筛选，已选 3 项" })).toBeInTheDocument();
    dialog = openFilters();
    expect(dialog.getByRole("combobox", { name: "品类" })).toHaveValue("新微动");
    expect(dialog.getByLabelText("交货开始日期")).toHaveValue("2026-09-01");
    fireEvent.click(dialog.getByRole("button", { name: "重置" }));
    fireEvent.click(dialog.getByRole("button", { name: "取消" }));
    expect(cards()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "清空筛选" }));
    expect(cards()).toHaveLength(3);
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();
});

it("交期默认不限，指定日期必须有效才提交", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    const dialog = openFilters();
    expect(dialog.queryByLabelText("交货开始日期")).not.toBeInTheDocument();
    fireEvent.change(dialog.getByRole("combobox", { name: "交期" }), { target: { value: "custom" } });
    fireEvent.change(dialog.getByLabelText("交货开始日期"), { target: { value: "2026-10-01" } });
    fireEvent.change(dialog.getByLabelText("交货结束日期"), { target: { value: "2026-09-01" } });
    fireEvent.click(dialog.getByRole("button", { name: "确认" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("开始日期不能晚于结束日期");
    expect(cards()).toHaveLength(3);
    fireEvent.click(dialog.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();
});

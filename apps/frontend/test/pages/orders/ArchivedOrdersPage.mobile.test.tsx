// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArchivedOrdersPage } from "@/pages/orders/ArchivedOrdersPage";
import { detailBom, detailOrder, detailSnapshot } from "../../fixtures/recordDetails";

const snapshot = {
    ...detailSnapshot,
    boms: [detailBom, { ...detailBom, code: "OTHER", name: "旋转开关" }],
    orders: [
        {
            ...detailOrder,
            orderNo: "ARCHIVE-001",
            lifecycleStatus: "archived" as const,
            outbound: detailOrder.qty,
            archivedAt: "2026-09-30T00:00:00Z",
        },
        {
            ...detailOrder,
            orderNo: "ARCHIVE-002",
            lifecycleStatus: "archived" as const,
            outbound: detailOrder.qty,
            bomCode: "OTHER",
            deliverDate: "2026-10-15",
            archivedAt: "2026-10-16T00:00:00Z",
        },
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
    return within(screen.getByRole("dialog"));
};

it("归档订单的品类、交期与排序在面板确认后生效，清空恢复默认排序与全部记录", () => {
    render(
        <MemoryRouter>
            <ArchivedOrdersPage />
        </MemoryRouter>,
    );
    expect(cards()).toHaveLength(2);
    expect(cards()[0]).toHaveTextContent("ARCHIVE-002");
    expect(document.querySelector(".mobile-list-controls select")).toBeNull();
    let dialog = openFilters();
    fireEvent.change(dialog.getByRole("combobox", { name: "排序" }), { target: { value: "orderNo:asc" } });
    expect(cards()[0]).toHaveTextContent("ARCHIVE-002");
    fireEvent.click(dialog.getByRole("button", { name: "确认" }));
    expect(cards()[0]).toHaveTextContent("ARCHIVE-001");
    dialog = openFilters();
    fireEvent.change(dialog.getByRole("combobox", { name: "品类" }), { target: { value: "旋转开关" } });
    fireEvent.change(dialog.getByRole("combobox", { name: "交期" }), { target: { value: "custom" } });
    fireEvent.change(dialog.getByLabelText("交货开始日期"), { target: { value: "2026-10-01" } });
    fireEvent.change(dialog.getByLabelText("交货结束日期"), { target: { value: "2026-10-31" } });
    fireEvent.click(dialog.getByRole("button", { name: "确认" }));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent("ARCHIVE-002");
    expect(screen.getByRole("button", { name: "筛选，已选 3 项" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清空筛选" }));
    expect(cards()).toHaveLength(2);
    expect(cards()[0]).toHaveTextContent("ARCHIVE-002");
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();
});

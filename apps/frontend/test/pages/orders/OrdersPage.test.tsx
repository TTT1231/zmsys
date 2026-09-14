// @vitest-environment jsdom
/* 订单表格预览结构化规格，并正确区分取消、完成与仍待交付的订单。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { OrdersPage } from "@/pages/orders/OrdersPage";
import { detailOrder, detailSnapshot } from "../../fixtures/recordDetails";
const snapshot = {
    ...detailSnapshot,
    orders: [
        {
            ...detailOrder,
            orderNo: "CANCELLED",
            lifecycleStatus: "cancelled" as const,
            outbound: 0,
            deliverDate: "2020-01-01",
        },
        { ...detailOrder, orderNo: "DONE", outbound: detailOrder.qty },
        detailOrder,
    ],
};
vi.mock("@/context/AppContext", () => ({ useApp: () => ({ role: "staff", can: () => false }) }));
vi.mock("@/data/queries", () => ({
    useWbSnapshot: () => ({ data: snapshot }),
    useWbRefresh: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
afterEach(cleanup);
it("取消订单不显示全部交付或逾期，正常完成与待交数量保持准确", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("已停止交付");
    expect(rows[1]).not.toHaveTextContent("已全部交付");
    expect(rows[1]).not.toHaveTextContent("已逾期");
    expect(rows[1]).toHaveTextContent("已发 0 / 300");
    expect(rows[2]).toHaveTextContent("已全部交付");
    expect(rows[3]).toHaveTextContent("待交 100");
});
it("表格规格摘要共用同行详情入口，不额外增加规格按钮", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    const table = within(screen.getByRole("table"));
    expect(table.getByRole("columnheader", { name: "成品 / BOM" })).toBeInTheDocument();
    expect(table.queryByRole("button", { name: /查看全部规格/ })).not.toBeInTheDocument();
    fireEvent.click(table.getAllByRole("button", { name: "查看详情" })[0]);
    expect(screen.getByRole("dialog", { name: "CANCELLED" })).toHaveTextContent("辅助动片");
});

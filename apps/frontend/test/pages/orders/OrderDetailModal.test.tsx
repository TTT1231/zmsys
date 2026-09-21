// @vitest-environment jsdom
/* 订单详情区分取消与交付状态，保留规格、作废发货记录及发货入口约束。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OrderDetailModal } from "@/pages/orders/OrdersPage";
import { detailOrder, detailOutbound, detailSnapshot } from "../../fixtures/recordDetails";
afterEach(cleanup);

it("部分发货后取消显示明确状态、取消原因且不能继续发货", () => {
    const cancelledOrder = { ...detailOrder, lifecycleStatus: "cancelled" as const, cancelReason: "客户调整需求" };
    render(
        <OrderDetailModal
            order={cancelledOrder}
            snap={{ ...detailSnapshot, orders: [cancelledOrder] }}
            onClose={vi.fn()}
            onShip={vi.fn()}
        />,
    );
    expect(screen.getByText("部分发货后取消")).toBeInTheDocument();
    expect(screen.getByText("订单已取消，剩余数量不再安排交付。")).toBeInTheDocument();
    expect(screen.getByText("客户调整需求")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记发货" })).not.toBeInTheDocument();
    const productDetail = screen.getByRole("region", { name: "详情" });
    expect(productDetail).toHaveTextContent("6.3静片：铜镀银");
    expect(productDetail).toHaveTextContent("BOM 备注：—");
});
it("有效订单保留发货入口，历史作废出库明确标注", () => {
    render(
        <OrderDetailModal
            order={detailOrder}
            snap={{ ...detailSnapshot, outboundLedger: [{ ...detailOutbound, state: "voided" }] }}
            onClose={vi.fn()}
            onShip={vi.fn()}
        />,
    );
    expect(screen.getByRole("button", { name: "登记发货" })).toBeInTheDocument();
    expect(screen.getByText("已作废")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "数量与状态" })).getByText("100")).toBeInTheDocument();
});

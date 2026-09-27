// @vitest-environment jsdom
/* 订单详情区分归档与交付状态，保留规格、作废发货记录及发货入口约束。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OrderDetailModal } from "@/pages/orders/OrdersPage";
import { detailOrder, detailOutbound, detailSnapshot } from "../../fixtures/recordDetails";
afterEach(cleanup);

it("部分发货后归档显示结案提示，且不能继续发货", () => {
    const archivedOrder = {
        ...detailOrder,
        lifecycleStatus: "archived" as const,
        archivedAt: "2026-03-12T00:00:00Z",
        archivedBy: "郭均",
        archiveReason: "行情不好客户弃单",
    };
    render(
        <OrderDetailModal
            order={archivedOrder}
            snap={{ ...detailSnapshot, orders: [archivedOrder] }}
            onClose={vi.fn()}
            onShip={vi.fn()}
        />,
    );
    expect(screen.getByText("订单已归档，仅供查询，不可修改。")).toBeInTheDocument();
    expect(screen.getByText("行情不好客户弃单")).toBeInTheDocument();
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

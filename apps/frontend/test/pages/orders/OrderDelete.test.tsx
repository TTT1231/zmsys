// @vitest-environment jsdom
/* 编辑弹窗的删除入口：仅超级管理员且一件未发才可见；警告二次确认后才发起删除请求。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { OrdersPage } from "@/pages/orders/OrdersPage";
import { detailBom, detailOrder, detailOutbound, detailSnapshot } from "../../fixtures/recordDetails";

const deleteMutate = vi.fn();
const canMock = vi.fn<(code: string) => boolean>(() => true);
vi.mock("@/context/useApp", () => ({
    useApp: () => ({ role: "super", can: (code: string) => canMock(code) }),
}));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => vi.fn() }));
vi.mock("@/data/queries", () => ({
    useWbSnapshot: () => ({ data: snapshot }),
    useWbRefresh: () => ({ refresh: vi.fn() }),
    useCreateOrder: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateOrder: () => ({ mutate: vi.fn(), isPending: false }),
    useArchiveOrder: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteOrder: () => ({ mutate: deleteMutate, isPending: false }),
}));

/* 一件未发的新订单与已发 200/300 的旧订单同列，验证可见性按发货量区分；
 * voidedOrder 曾发货又作废（累计已发回到 0 但台账留有已作废流水）——与后端口径一致不可删 */
const freshOrder = { ...detailOrder, orderNo: "ZM260914001", outbound: 0 };
const voidedOrder = { ...detailOrder, orderNo: "ZM260914002", outbound: 0 };
const voidedShipment = { ...detailOutbound, no: "CK26091499", orderNo: voidedOrder.orderNo, state: "voided" };
const snapshot = {
    ...detailSnapshot,
    boms: [detailBom],
    orders: [detailOrder, freshOrder, voidedOrder],
    outboundLedger: [...detailSnapshot.outboundLedger, voidedShipment],
};

const openEdit = async (orderNo: string) => {
    const user = userEvent.setup();
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    const row = within(screen.getByRole("table"))
        .getAllByRole("row")
        .find(tr => tr.textContent?.includes(orderNo))!;
    expect(within(row).queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "登记发货" })).not.toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "查看详情" }));
    await user.click(within(screen.getByRole("dialog", { name: orderNo })).getByRole("button", { name: "编辑订单" }));
    return screen.getByRole("dialog", { name: "编辑销售订单" });
};

afterEach(() => {
    cleanup();
    deleteMutate.mockClear();
    canMock.mockImplementation(() => true);
});

it("超级管理员编辑一件未发的订单：警告二次确认后按乐观锁版本发起删除", async () => {
    const user = userEvent.setup();
    const dialog = await openEdit(freshOrder.orderNo);
    await user.click(within(dialog).getByRole("button", { name: "删除订单" }));

    const confirm = screen.getByRole("dialog", { name: "删除销售订单" });
    expect(within(confirm).getByText(/从列表移除/)).toBeInTheDocument();
    expect(within(confirm).getByText(/删除后无恢复入口/)).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: "确认删除" }));
    expect(deleteMutate).toHaveBeenCalledWith(
        { orderNo: freshOrder.orderNo, expectedVersion: freshOrder.version },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
});

it("已有发货的订单即使超级管理员也不显示删除入口，只提示数量下限", async () => {
    const dialog = await openEdit(detailOrder.orderNo);
    expect(within(dialog).queryByRole("button", { name: "删除订单" })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/累计已发 200 个/)).toBeInTheDocument();
});

it("曾发货又作废的订单（累计已发回到 0 但台账留流水）与后端口径一致，不显示删除入口", async () => {
    const dialog = await openEdit(voidedOrder.orderNo);
    expect(within(dialog).queryByRole("button", { name: "删除订单" })).not.toBeInTheDocument();
});

it("无删除权限的角色不渲染删除入口，避免误操作", async () => {
    canMock.mockImplementation((code: string) => code !== "orders:delete");
    const dialog = await openEdit(freshOrder.orderNo);
    expect(within(dialog).queryByRole("button", { name: "删除订单" })).not.toBeInTheDocument();
});

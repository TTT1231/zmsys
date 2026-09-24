// @vitest-environment jsdom
/* 编辑弹窗的取消入口：仅活跃且有剩余量可见；原因必填（2–500 字符），
 * 二次确认展示部分发货/未发货两种欠量关闭文案后按乐观锁版本发起取消。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { OrdersPage } from "@/pages/orders/OrdersPage";
import { detailBom, detailOrder, detailSnapshot } from "../../fixtures/recordDetails";

const cancelMutate = vi.fn();
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
    useCancelOrder: () => ({ mutate: cancelMutate, isPending: false }),
    useArchiveOrder: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteOrder: () => ({ mutate: vi.fn(), isPending: false }),
}));

/* 部分发货单（200/300）与已完成单（300/300）同列，验证可见性按剩余量区分 */
const doneOrder = { ...detailOrder, orderNo: "ZM260914003", outbound: 300 };
const snapshot = {
    ...detailSnapshot,
    boms: [detailBom],
    orders: [detailOrder, doneOrder],
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
    await user.click(within(row).getByRole("button", { name: "查看详情" }));
    await user.click(within(screen.getByRole("dialog", { name: orderNo })).getByRole("button", { name: "编辑订单" }));
    return screen.getByRole("dialog", { name: "编辑销售订单" });
};

afterEach(() => {
    cleanup();
    cancelMutate.mockClear();
    canMock.mockImplementation(() => true);
});

it("部分发货订单可取消：欠量关闭文案 + 原因校验后按乐观锁版本发起取消", async () => {
    const user = userEvent.setup();
    const dialog = await openEdit(detailOrder.orderNo);
    await user.click(within(dialog).getByRole("button", { name: "取消订单" }));

    const confirm = screen.getByRole("dialog", { name: "取消销售订单" });
    // 部分发货：已发保留、剩余欠量关闭
    expect(within(confirm).getByText(/已发 200 个的交付记录保留/)).toBeInTheDocument();
    expect(within(confirm).getByText(/剩余 100 个欠量全部关闭/)).toBeInTheDocument();

    // 原因必填（2–500 字符，与后端 CancelOrderDto 同口径）
    await user.click(within(confirm).getByRole("button", { name: "确认取消" }));
    expect(within(confirm).getByText(/取消原因为 2–500 个字符/)).toBeInTheDocument();
    expect(cancelMutate).not.toHaveBeenCalled();

    await user.type(within(confirm).getByRole("textbox", { name: /取消原因/ }), "客户撤单");
    await user.click(within(confirm).getByRole("button", { name: "确认取消" }));
    expect(cancelMutate).toHaveBeenCalledWith(
        { orderNo: detailOrder.orderNo, expectedVersion: detailOrder.version, reason: "客户撤单" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
});

it("已完成订单无剩余量，不显示取消入口", async () => {
    const dialog = await openEdit(doneOrder.orderNo);
    expect(within(dialog).queryByRole("button", { name: "取消订单" })).not.toBeInTheDocument();
});

it("无取消权限的角色不渲染取消入口", async () => {
    canMock.mockImplementation((code: string) => code !== "orders:cancel");
    const dialog = await openEdit(detailOrder.orderNo);
    expect(within(dialog).queryByRole("button", { name: "取消订单" })).not.toBeInTheDocument();
});

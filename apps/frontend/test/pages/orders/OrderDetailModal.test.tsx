// @vitest-environment jsdom
/* 订单详情区分归档与交付状态，保留规格、作废发货记录及发货入口约束；
 * 归档回退入口仅归档操作人本人且有权限时可见（权限 + 账号判等）。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { OrderDetailModal } from "@/pages/orders/OrdersPage";
import { SnapProvider } from "@/context/snap";
import { detailOrder, detailOutbound, detailSnapshot } from "../../fixtures/recordDetails";
import type { Order } from "@/api";

/* 归档回退可见性依赖登录态：hoisted ref 按用例切换 can/user */
const auth = vi.hoisted(() => ({
    current: { user: { account: "guojun" } as { account: string } | null, canAllow: true },
}));
const unarchiveMutate = vi.hoisted(() => vi.fn());
vi.mock("@/context/useApp", () => ({
    useApp: () => ({
        user: auth.current.user,
        can: () => auth.current.canAllow,
    }),
}));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/data/queries", () => ({
    useWbView: () => ({ snap: {}, isLoading: false, refreshing: false }),
    useWbRefresh: () => ({ refresh: vi.fn() }),
    useCreateOrder: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateOrder: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteOrder: () => ({ mutate: vi.fn(), isPending: false }),
    useArchiveOrder: () => ({ mutate: vi.fn(), isPending: false }),
    useUnarchiveOrder: () => ({ mutate: unarchiveMutate, isPending: false }),
}));

const archivedOrder: Order = {
    ...detailOrder,
    lifecycleStatus: "archived",
    archivedAt: "2026-03-12T00:00:00Z",
    archivedBy: "郭均",
    archivedByAccount: "guojun",
    archiveReason: "行情不好客户弃单",
};

const restoreAuth = () => {
    auth.current = { user: { account: "guojun" }, canAllow: true };
};

afterEach(() => {
    cleanup();
    unarchiveMutate.mockClear();
    restoreAuth();
});

it("部分发货后归档显示结案提示，且不能继续发货", () => {
    render(
        <SnapProvider snap={{ ...detailSnapshot, orders: [archivedOrder] }}>
            <OrderDetailModal order={archivedOrder} onClose={vi.fn()} onShip={vi.fn()} />
        </SnapProvider>,
    );
    expect(screen.getByText("订单已归档，仅供查询；归档人可回退。")).toBeInTheDocument();
    expect(screen.getByText("行情不好客户弃单")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登记发货" })).not.toBeInTheDocument();
    const productDetail = screen.getByRole("region", { name: "详情" });
    expect(productDetail).toHaveTextContent("6.3静片：铜镀银");
    expect(productDetail).toHaveTextContent("BOM 备注：—");
});
it("有效订单保留发货入口，历史作废出库明确标注", () => {
    render(
        <SnapProvider snap={{ ...detailSnapshot, outboundLedger: [{ ...detailOutbound, state: "voided" }] }}>
            <OrderDetailModal order={detailOrder} onClose={vi.fn()} onShip={vi.fn()} />
        </SnapProvider>,
    );
    expect(screen.getByRole("button", { name: "登记发货" })).toBeInTheDocument();
    expect(screen.getByText("已作废")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "归档回退" })).not.toBeInTheDocument();
});
it("归档人本人且有权限：详情显示归档回退，确认后携带版本与备注提交", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
        <SnapProvider snap={{ ...detailSnapshot, orders: [archivedOrder] }}>
            <OrderDetailModal order={archivedOrder} onClose={onClose} />
        </SnapProvider>,
    );
    await user.click(screen.getByRole("button", { name: "归档回退" }));
    // 确认弹窗：回退影响说明 + 选填备注
    expect(screen.getByText("回退归档订单")).toBeInTheDocument();
    expect(screen.getByText(/将返回「销售订单」/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("回退备注（选填）"), "归档错了，恢复跟进");
    await user.click(screen.getByRole("button", { name: "确认回退" }));
    expect(unarchiveMutate).toHaveBeenCalledWith(
        { orderNo: archivedOrder.orderNo, expectedVersion: archivedOrder.version, reason: "归档错了，恢复跟进" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
});
it("非归档人（账号不一致）：即使有权限也不显示归档回退", () => {
    auth.current = { user: { account: "other-super" }, canAllow: true };
    render(
        <SnapProvider snap={{ ...detailSnapshot, orders: [archivedOrder] }}>
            <OrderDetailModal order={archivedOrder} onClose={vi.fn()} />
        </SnapProvider>,
    );
    expect(screen.queryByRole("button", { name: "归档回退" })).not.toBeInTheDocument();
});
it("无 orders:unarchive 权限：归档人本人也不显示归档回退", () => {
    auth.current = { user: { account: "guojun" }, canAllow: false };
    render(
        <SnapProvider snap={{ ...detailSnapshot, orders: [archivedOrder] }}>
            <OrderDetailModal order={archivedOrder} onClose={vi.fn()} />
        </SnapProvider>,
    );
    expect(screen.queryByRole("button", { name: "归档回退" })).not.toBeInTheDocument();
});

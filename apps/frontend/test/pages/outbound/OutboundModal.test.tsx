// @vitest-environment jsdom
/* 登记发货两步选择：先客户后订单，选中即带出订单信息；换客户清空旧单，无库存仍可选单、超发拦截不变。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { OutboundModal } from "@/pages/outbound/OutboundPage";
import { SnapProvider } from "@/context/snap";
import { detailBom, detailOrder, detailSnapshot } from "../../fixtures/recordDetails";
import type { Order, Snapshot } from "@/api";

const mutate = vi.fn();
vi.mock("@/context/useApp", () => ({ useApp: () => ({ role: "warehouse", can: () => true }) }));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => vi.fn() }));
vi.mock("@/data/queries", () => ({
    useWbView: () => ({ snap: active, isLoading: false, refreshing: false }),
    useWbRefresh: () => ({ refresh: vi.fn(), refreshing: false }),
    useCreateOutbound: () => ({ mutate, isPending: false }),
    useVoidOutbound: () => ({ mutate: vi.fn(), isPending: false }),
}));

/* 同一 BOM 库存池 200 个：首单（交期早）剩余 100 全部可发，后单分到剩余 100 */
const laterOrder: Order = {
    ...detailOrder,
    orderNo: "ZM260914002",
    customer: "东莞精密连接器厂",
    customerCode: "CUS-0003",
    qty: 500,
    outbound: 0,
    deliverDate: "2026-10-15",
    remark: "",
};
const snapshot: Snapshot = { ...detailSnapshot, orders: [detailOrder, laterOrder] };
let active: Snapshot = snapshot;

const choose = async (user: ReturnType<typeof userEvent.setup>, label: RegExp, option: RegExp) => {
    await user.click(screen.getByRole("combobox", { name: label }));
    await user.click(screen.getByRole("option", { name: option }));
};

afterEach(() => {
    cleanup();
    mutate.mockClear();
    active = snapshot;
});

it("先选客户再选订单，选中即带出 BOM、数量、交期与交付情况，缺数量提交被拦", async () => {
    const user = userEvent.setup();
    render(
        <SnapProvider snap={active}>
            <OutboundModal open onClose={vi.fn()} />
        </SnapProvider>,
    );

    await user.click(screen.getByRole("button", { name: "确认发货" }));
    expect(screen.getByText("请选择客户")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    await choose(user, /^客户/, new RegExp(detailOrder.customerCode));
    await choose(user, /^销售订单/, new RegExp(detailOrder.orderNo));

    expect(screen.getByText(detailOrder.orderNo)).toBeInTheDocument();
    expect(screen.getByText(/新微动/)).toBeInTheDocument();
    expect(screen.getByText(/6.3静片：铜镀银/)).toBeInTheDocument();
    expect(screen.getByText("300 个")).toBeInTheDocument();
    expect(screen.getByText("2026-09-30")).toBeInTheDocument();
    expect(screen.getByText(/BOM 备注：/)).toBeInTheDocument();
    expect(screen.getByText("已发 200 个")).toBeInTheDocument();
    expect(screen.getByText("部分发货")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "填入全部可发数量（100 个）" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认发货" }));
    expect(screen.getByText("请填写发货数量")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "填入全部可发数量（100 个）" }));
    await user.click(screen.getByRole("button", { name: "确认发货" }));
    expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({ orderNo: detailOrder.orderNo, qty: 100 }),
        expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
});

it("换客户会清空已选订单并回到占位提示，改选新客户的订单正常登记", async () => {
    const user = userEvent.setup();
    render(
        <SnapProvider snap={active}>
            <OutboundModal open onClose={vi.fn()} />
        </SnapProvider>,
    );

    await choose(user, /^客户/, new RegExp(detailOrder.customerCode));
    await choose(user, /^销售订单/, new RegExp(detailOrder.orderNo));
    expect(screen.getByText(detailOrder.orderNo)).toBeInTheDocument();

    await choose(user, /^客户/, new RegExp(laterOrder.customerCode));
    expect(screen.getByText(/选择订单后，这里会带出成品档案/)).toBeInTheDocument();
    expect((screen.getByRole("combobox", { name: /^销售订单/ }) as HTMLInputElement).value).toBe("");

    await choose(user, /^销售订单/, new RegExp(laterOrder.orderNo));
    expect(screen.getByText(laterOrder.orderNo)).toBeInTheDocument();
    expect(screen.getByText("500 个")).toBeInTheDocument();
    expect(screen.getByText("已发 0 个")).toBeInTheDocument();
});

it("数量为 0 被明确拦截，补填有效数量后报错即时消失", async () => {
    const user = userEvent.setup();
    render(
        <SnapProvider snap={active}>
            <OutboundModal open onClose={vi.fn()} />
        </SnapProvider>,
    );

    await choose(user, /^客户/, new RegExp(detailOrder.customerCode));
    await choose(user, /^销售订单/, new RegExp(detailOrder.orderNo));

    const qtyInput = screen.getByLabelText(/发货数量/);
    await user.type(qtyInput, "0");
    await user.click(screen.getByRole("button", { name: "确认发货" }));
    expect(screen.getByText("发货数量必须大于 0")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    await user.clear(qtyInput);
    await user.type(qtyInput, "5");
    expect(screen.queryByText("发货数量必须大于 0")).not.toBeInTheDocument();
    expect(screen.queryByText("请填写发货数量")).not.toBeInTheDocument();
});

it("从订单入口打开时客户与订单已预选，订单信息直接呈现", () => {
    render(
        <SnapProvider snap={active}>
            <OutboundModal open initialOrderNo={detailOrder.orderNo} onClose={vi.fn()} />
        </SnapProvider>,
    );
    expect((screen.getByRole("combobox", { name: /^客户/ }) as HTMLInputElement).value).toContain(detailOrder.customer);
    expect((screen.getByRole("combobox", { name: /^销售订单/ }) as HTMLInputElement).value).toContain(
        detailOrder.orderNo,
    );
    expect(screen.getByText("已发 200 个")).toBeInTheDocument();
    expect(screen.getByText(detailBom.code)).toBeInTheDocument();
});

it("没有库存时客户与订单仍可选（还有待交数量即列出），可发 0 个且超发被拦", async () => {
    active = { ...snapshot, stock: {} };
    const user = userEvent.setup();
    render(
        <SnapProvider snap={active}>
            <OutboundModal open onClose={vi.fn()} />
        </SnapProvider>,
    );

    await choose(user, /^客户/, new RegExp(detailOrder.customerCode));
    await choose(user, /^销售订单/, new RegExp(detailOrder.orderNo));

    expect(screen.getByText(detailOrder.orderNo)).toBeInTheDocument();
    expect(screen.getByText("已发 200 个")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /填入全部可发数量/ })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/发货数量/), "10");
    expect(screen.getByText("发货后超过可发数量，请调整发货数量。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认发货" })).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
});

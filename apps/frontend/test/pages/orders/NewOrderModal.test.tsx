// @vitest-environment jsdom
/* 新建订单表单：BOM 编码输入即解析回显、失配/缺失拦截提交、报错后补填即时消除。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { NewOrderModal } from "@/pages/orders/OrdersPage";
import { EMPTY_SNAPSHOT } from "@/data/views";
import { detailBom, detailOrder } from "../../fixtures/recordDetails";
import type { Snapshot } from "@/api";

const mutate = vi.fn();
vi.mock("@/context/AppContext", () => ({ useApp: () => ({ role: "staff", can: () => true }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/data/queries", () => ({
    useWbSnapshot: () => ({ data: snapshot }),
    useWbRefresh: () => ({ refresh: vi.fn() }),
    useCreateOrder: () => ({ mutate, isPending: false }),
    useUpdateOrder: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteOrder: () => ({ mutate: vi.fn(), isPending: false }),
}));

const snapshot: Snapshot = {
    ...EMPTY_SNAPSHOT,
    customers: [
        {
            version: 1,
            code: detailOrder.customerCode,
            name: detailOrder.customer,
            contact: "王经理",
            phone: "138****6821",
            province: "广东省",
            city: "深圳市",
            district: "南山区",
            town: "",
            address: "科技园南路 8 号",
            cooperation: "合作中",
            owner: "销售甲",
            ownerAccount: "sales",
            payTerms: "月结 30 天",
            created: "2026-01-06",
        },
    ],
    boms: [detailBom],
};

afterEach(() => {
    cleanup();
    mutate.mockClear();
});

it("输入 BOM 编码即回显成品档案，容错大小写与首尾空格，提交携带档案真实编码", async () => {
    const user = userEvent.setup();
    render(<NewOrderModal open onClose={vi.fn()} />);
    expect(screen.queryByText("已匹配")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/BOM 编码/), " zmkw0042 ");
    expect(screen.getByText("ZMKW0042")).toBeInTheDocument();
    expect(screen.getByText("已匹配")).toBeInTheDocument();
    expect(screen.getByText(/新微动/)).toBeInTheDocument();
    expect(screen.getByText(/6.3静片：铜镀银/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^客户/), detailOrder.customerCode);
    await user.type(screen.getByLabelText(/订单数量/), "300");
    fireEvent.change(screen.getByLabelText(/交货日期/), { target: { value: "2026-09-30" } });
    await user.click(screen.getByRole("button", { name: "提交订单" }));
    expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
            customerCode: detailOrder.customerCode,
            bomCode: detailBom.code,
            qty: 300,
            deliverDate: "2026-09-30",
        }),
        expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
});

it("编码失配：输入即出现中性核对提示，提交被拦截且不发起请求", async () => {
    const user = userEvent.setup();
    render(<NewOrderModal open onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/BOM 编码/), "ZMKW9999");
    expect(screen.getByText(/未找到编码「ZMKW9999」/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "提交订单" }));
    expect(screen.getByText("未找到该 BOM 编码，请核对")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
});

it("未输入编码提交提示必填，修正输入后错误即时清除", async () => {
    const user = userEvent.setup();
    render(<NewOrderModal open onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "提交订单" }));
    expect(screen.getByText("请输入 BOM 编码")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/BOM 编码/), "zmkw0042");
    expect(screen.queryByText("请输入 BOM 编码")).not.toBeInTheDocument();
    expect(screen.getByText("ZMKW0042")).toBeInTheDocument();
});

it("提交报错后补填某字段，只消除该字段验证词，其余保留", async () => {
    const user = userEvent.setup();
    render(<NewOrderModal open onClose={vi.fn()} />);
    /* 「请选择客户」同时是下拉占位与报错文案，错误断言用 selector 限定到 role=alert 节点 */
    const error = (text: string) => screen.getByText(text, { selector: "[role=alert]" });
    const queryError = (text: string) => screen.queryByText(text, { selector: "[role=alert]" });
    await user.click(screen.getByRole("button", { name: "提交订单" }));
    expect(error("请选择客户")).toBeInTheDocument();
    expect(error("请填写订单数量")).toBeInTheDocument();
    expect(error("请选择交货日期")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^客户/), detailOrder.customerCode);
    expect(queryError("请选择客户")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/订单数量/), "300");
    expect(queryError("请填写订单数量")).not.toBeInTheDocument();
    expect(error("请选择交货日期")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/交货日期/), { target: { value: "2026-09-30" } });
    expect(queryError("请选择交货日期")).not.toBeInTheDocument();
});

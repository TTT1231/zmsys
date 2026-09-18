// @vitest-environment jsdom
/* 客户详情时间线：最近订单状态展示、点击订单号叠加订单详情逐层关闭、查看全部跳转订单页。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { CustomerDetailModal } from "@/pages/customers/CustomersPage";
import { detailOrder, detailSnapshot } from "../../fixtures/recordDetails";
import type { Customer, Order, Snapshot } from "@/api";

afterEach(cleanup);

const customer: Customer = {
    version: 1,
    code: "CUS-0002",
    name: "深圳市智造联调电子",
    contact: "刘经理",
    phone: "138****0002",
    province: "广东省",
    city: "深圳市",
    district: "",
    town: "",
    address: "",
    cooperation: "合作中",
    owner: "销售甲",
    ownerAccount: "sales01",
    payTerms: "月结 30 天",
    created: "2026-08-01",
};

/* 4 笔订单覆盖倒序取 3、已取消弱化与多种状态徽章；detailSnapshot 的 stock=200 支撑可发货判定 */
const orders: Order[] = [
    {
        ...detailOrder,
        orderNo: "ZM260915003",
        qty: 100,
        outbound: 0,
        orderDate: "2026-09-15",
        lifecycleStatus: "cancelled",
        cancelReason: "客户调整需求",
    },
    { ...detailOrder, orderNo: "ZM260915002", qty: 2400, outbound: 0, orderDate: "2026-09-15" },
    { ...detailOrder, orderNo: "ZM260914001", qty: 500, outbound: 500, orderDate: "2026-09-14" },
    { ...detailOrder },
];

const snap: Snapshot = { ...detailSnapshot, customers: [customer], orders };

const LocationProbe = () => {
    const location = useLocation();
    return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
};

const renderDetail = (onClose = vi.fn()) =>
    render(
        <MemoryRouter initialEntries={["/customers"]}>
            <LocationProbe />
            <CustomerDetailModal customer={customer} snap={snap} onClose={onClose} />
        </MemoryRouter>,
    );

it("时间线按下单日期倒序只取最近 3 笔，带状态徽章并提供查看全部入口", () => {
    renderDetail();
    // 倒序前 3 笔可点，最早的 ZM260913001 不在时间线
    expect(screen.getByRole("button", { name: "查看订单 ZM260915003 详情" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看订单 ZM260915002 详情" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看订单 ZM260914001 详情" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看订单 ZM260913001 详情" })).not.toBeInTheDocument();
    // 状态徽章：已取消 / 可发货（库存 200 充足）/ 已完成
    expect(screen.getByText("已取消")).toBeInTheDocument();
    expect(screen.getByText("可发货")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /查看全部 4 笔订单/ })).toBeInTheDocument();
});

it("点击订单号叠加订单详情，ESC 逐层关闭", () => {
    const onClose = vi.fn();
    renderDetail(onClose);
    fireEvent.click(screen.getByRole("button", { name: "查看订单 ZM260915002 详情" }));
    // 两层弹窗并存：客户详情（title 为客户名）+ 订单详情（title 为订单号）
    expect(screen.getByRole("dialog", { name: customer.name })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "ZM260915002" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "ZM260915002" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: customer.name })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
});

it("关闭订单详情后焦点回到所点的订单号按钮", () => {
    renderDetail();
    const trigger = screen.getByRole("button", { name: "查看订单 ZM260915002 详情" });
    // jsdom 的 click 不聚焦元素，先 focus 模拟键盘/已聚焦路径
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(trigger).toHaveFocus();
});

it("查看全部订单跳转订单页并携带客户名搜索", () => {
    const onClose = vi.fn();
    renderDetail(onClose);
    fireEvent.click(screen.getByRole("button", { name: /查看全部 4 笔订单/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location")).toHaveTextContent(`/orders?q=${encodeURIComponent(customer.name)}`);
});

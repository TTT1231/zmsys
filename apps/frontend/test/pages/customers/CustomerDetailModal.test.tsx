// @vitest-environment jsdom
/* 客户详情时间线：最近订单状态展示、点击订单号叠加订单详情逐层关闭、查看全部就地展开。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

/* 4 笔订单覆盖倒序取 3、归档弱化与多种状态徽章；stock=200 分配后可发 100 盖住 ZM260915002 待交 */
const orders: Order[] = [
    {
        ...detailOrder,
        orderNo: "ZM260915003",
        qty: 100,
        outbound: 40,
        orderDate: "2026-09-15",
        lifecycleStatus: "archived",
        archivedAt: "2026-09-16T00:00:00Z",
    },
    { ...detailOrder, orderNo: "ZM260915002", qty: 100, outbound: 0, orderDate: "2026-09-15" },
    { ...detailOrder, orderNo: "ZM260914001", qty: 500, outbound: 500, orderDate: "2026-09-14" },
    { ...detailOrder },
];

const snap: Snapshot = { ...detailSnapshot, customers: [customer], orders };

const renderDetail = (onClose = vi.fn()) =>
    render(<CustomerDetailModal customer={customer} snap={snap} onClose={onClose} />);

it("时间线按下单日期倒序只取最近 3 笔，带状态徽章并提供查看全部入口", () => {
    renderDetail();
    // 倒序前 3 笔可点，最早的 ZM260913001 不在时间线
    expect(screen.getByRole("button", { name: "查看订单 ZM260915003 详情" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看订单 ZM260915002 详情" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看订单 ZM260914001 详情" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看订单 ZM260913001 详情" })).not.toBeInTheDocument();
    // 状态徽章：部分发货（归档单复用交付进度口径）/ 可发货（分配后可发 100 盖住待交 100）/ 已完成
    expect(screen.getByText("部分发货")).toBeInTheDocument();
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

it("查看全部就地展开完整时间线，弹窗保持打开，收起后回到最近 3 笔", () => {
    const onClose = vi.fn();
    renderDetail(onClose);
    fireEvent.click(screen.getByRole("button", { name: /查看全部 4 笔订单/ }));
    // 最早的 ZM260913001 就地出现且可点，弹窗不关闭、不跳转
    expect(screen.getByRole("button", { name: "查看订单 ZM260913001 详情" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: customer.name })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByRole("button", { name: "查看订单 ZM260913001 详情" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: customer.name })).toBeInTheDocument();
});

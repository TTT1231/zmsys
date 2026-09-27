// @vitest-environment jsdom
/* 订单表格预览结构化规格，并正确区分取消、完成与仍待交付的订单；客户名点击打开客户档案详情。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { OrdersPage } from "@/pages/orders/OrdersPage";
import { detailBom, detailOrder, detailSnapshot } from "../../fixtures/recordDetails";
import type { Customer } from "@/api";

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
const snapshot = {
    ...detailSnapshot,
    boms: [{ ...detailBom, remark: "按钮加弹簧垫片，发货前逐个抽检" }],
    customers: [customer],
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
vi.mock("@/context/useApp", () => ({ useApp: () => ({ role: "staff", can: () => false }) }));
vi.mock("@/data/queries", () => ({
    useWbSnapshot: () => ({ data: snapshot }),
    useWbRefresh: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => vi.fn() }));
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
    // 已全部交付按组件设计只留绿色满条，语义走悬停 title（见 OrdersPage 交付情况列注释）
    expect(rows[2].querySelector(".delivery-track")).toHaveAttribute("title", "已全部交付");
    expect(rows[3]).toHaveTextContent("待交 100");
    // 移动端订单卡片：正常单展示 BOM 当前库存，取消单不展示（与待交数量同一守卫）
    const cards = [...document.querySelectorAll<HTMLElement>(".mobile-records article")];
    const cancelledCard = cards.find(node => node.textContent?.includes("CANCELLED"));
    expect(within(cancelledCard!).queryByText("库存数量")).not.toBeInTheDocument();
    const stockCard = cards.find(node => node.textContent?.includes("库存数量"));
    expect(within(stockCard!).getByText("200 个")).toBeInTheDocument();
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
    expect(screen.getByRole("dialog", { name: "CANCELLED" })).toHaveTextContent("6.3静片：铜镀银");
});
it("成品/BOM 旁的 BOM 备注列展示建档备注", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    const table = within(screen.getByRole("table"));
    expect(table.getByRole("columnheader", { name: "BOM 备注" })).toBeInTheDocument();
    expect(table.getAllByText("按钮加弹簧垫片，发货前逐个抽检")).toHaveLength(3);
});
it("点击客户名打开客户档案详情，时间线可继续叠加订单详情", () => {
    render(
        <MemoryRouter>
            <OrdersPage />
        </MemoryRouter>,
    );
    const table = within(screen.getByRole("table"));
    fireEvent.click(table.getAllByRole("button", { name: "深圳市智造联调电子" })[0]);
    const dialog = screen.getByRole("dialog", { name: "深圳市智造联调电子" });
    expect(within(dialog).getByRole("button", { name: "查看订单 ZM260913001 详情" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "查看订单 ZM260913001 详情" }));
    expect(screen.getByRole("dialog", { name: "ZM260913001" })).toBeInTheDocument();
});

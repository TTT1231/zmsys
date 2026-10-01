// @vitest-environment jsdom
/* 手机订单卡片区分归档与完成，关键指标以“标签左/值右”键值行呈现。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CardField, OrderTaskCard } from "@/components/ui/MobileList";
import { SnapProvider } from "@/context/snap";
import { deriveOrders } from "@/data/views";
import { detailOrder, detailSnapshot } from "../../fixtures/recordDetails";
afterEach(cleanup);
it.each([0, 200])("已发 %i 个后归档均显示已归档，保留实际已发数量", outbound => {
    const order = { ...detailOrder, outbound, lifecycleStatus: "archived" as const, deliverDate: "2020-01-01" };
    render(
        <SnapProvider snap={{ ...detailSnapshot, orders: [order] }}>
            <OrderTaskCard order={order} onDetail={vi.fn()} />
        </SnapProvider>,
    );
    expect(screen.getByText("已归档")).toBeInTheDocument();
    expect(screen.queryByText("已全部交付")).not.toBeInTheDocument();
    expect(screen.queryByText(/逾期/)).not.toBeInTheDocument();
    expect(screen.getByText(`${outbound} / 300 个`)).toBeInTheDocument();
    expect(screen.queryByText("待交数量")).not.toBeInTheDocument();
});
it("正常完成订单仍显示全部交付，完整规格入口可操作", () => {
    const onDetail = vi.fn();
    render(
        <SnapProvider snap={detailSnapshot}>
            <OrderTaskCard order={{ ...detailOrder, outbound: detailOrder.qty }} onDetail={onDetail} />
        </SnapProvider>,
    );
    expect(screen.getByText("已全部交付")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(onDetail).toHaveBeenCalledOnce();
});
it("CardField 标签与值分行渲染，值右对齐等宽数字", () => {
    render(<CardField label="待交" value="1,000 个" strong />);
    expect(screen.getByText("待交")).toBeInTheDocument();
    const value = screen.getByText("1,000 个");
    expect(value.className).toContain("text-right");
    expect(value.className).toContain("tnum");
});
it("传入页面级 derived（P2 一次分配）与逐卡全量派生渲染一致", () => {
    // qty 300 / 已发 200 → 待交 100；库存 200 → 本次可发 100（部分发货）；
    // 交期改未来，避免逾期徽章盖住状态徽章（断言依赖“今天”，交期过期的分支另有用例覆盖）
    const order = { ...detailOrder, deliverDate: "2999-01-01" };
    const snap = { ...detailSnapshot, orders: [order] };
    const derived = deriveOrders(snap);
    const { unmount } = render(
        <SnapProvider snap={snap}>
            <OrderTaskCard order={order} derived={derived} onDetail={vi.fn()} />
        </SnapProvider>,
    );
    expect(screen.getByText("本次可发 100 个")).toBeInTheDocument();
    expect(screen.getByText("部分发货")).toBeInTheDocument();
    unmount();
    render(
        <SnapProvider snap={snap}>
            <OrderTaskCard order={order} onDetail={vi.fn()} />
        </SnapProvider>,
    );
    expect(screen.getByText("本次可发 100 个")).toBeInTheDocument();
    expect(screen.getByText("部分发货")).toBeInTheDocument();
});

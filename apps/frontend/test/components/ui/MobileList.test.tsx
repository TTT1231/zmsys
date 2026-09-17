// @vitest-environment jsdom
/* 手机订单卡片区分取消与完成，关键指标以“标签左/值右”键值行呈现。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CardField, OrderTaskCard } from "@/components/ui/MobileList";
import { detailOrder, detailSnapshot } from "../../fixtures/recordDetails";
afterEach(cleanup);
it.each([0, 200])("已发 %i 个后取消均显示停止交付，保留实际已发数量", outbound => {
    const order = { ...detailOrder, outbound, lifecycleStatus: "cancelled" as const, deliverDate: "2020-01-01" };
    render(<OrderTaskCard order={order} snap={{ ...detailSnapshot, orders: [order] }} onDetail={vi.fn()} />);
    expect(screen.getByText("已停止交付")).toBeInTheDocument();
    expect(screen.queryByText("已全部交付")).not.toBeInTheDocument();
    expect(screen.queryByText(/逾期/)).not.toBeInTheDocument();
    expect(screen.getByText(`${outbound} / 300 个`)).toBeInTheDocument();
    expect(screen.getByText(outbound > 0 ? "部分发货后取消" : "已取消")).toBeInTheDocument();
});
it("正常完成订单仍显示全部交付，完整规格入口可操作", () => {
    const onDetail = vi.fn();
    render(
        <OrderTaskCard
            order={{ ...detailOrder, outbound: detailOrder.qty }}
            snap={detailSnapshot}
            onDetail={onDetail}
        />,
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

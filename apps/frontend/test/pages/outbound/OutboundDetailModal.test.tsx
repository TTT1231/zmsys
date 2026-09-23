// @vitest-environment jsdom
/* 出库详情保留关联订单与作废原因；打印状态与打印次数字段已随两态化移除。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OutboundDetailModal } from "@/pages/outbound/OutboundPage";
import { detailOutbound, detailSnapshot } from "../../fixtures/recordDetails";
afterEach(cleanup);
it("已登记详情呈现关联订单与规格；作废后呈现作废原因且无打印情况字段", () => {
    const { rerender } = render(<OutboundDetailModal row={detailOutbound} snap={detailSnapshot} onClose={vi.fn()} />);
    expect(screen.getByText("已登记")).toBeInTheDocument();
    expect(screen.queryByText("打印情况")).not.toBeInTheDocument();
    expect(screen.getByText(detailOutbound.orderNo)).toBeInTheDocument();
    expect(screen.getByText("6.3静片：铜镀银")).toBeInTheDocument();
    rerender(
        <OutboundDetailModal
            row={{ ...detailOutbound, state: "voided", voidReason: "纸质单已作废，货物未离开" }}
            snap={detailSnapshot}
            onClose={vi.fn()}
        />,
    );
    expect(screen.getByText("已作废")).toBeInTheDocument();
    expect(screen.getByText("纸质单已作废，货物未离开")).toBeInTheDocument();
    expect(screen.queryByText("打印情况")).not.toBeInTheDocument();
});

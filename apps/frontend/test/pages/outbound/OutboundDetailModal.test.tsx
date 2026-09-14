// @vitest-environment jsdom
/* 出库详情保留关联订单、打印次数和作废原因，规格不再拼接成段。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OutboundDetailModal } from "@/pages/outbound/OutboundPage";
import { detailOutbound, detailSnapshot } from "../../fixtures/recordDetails";
afterEach(cleanup);
it("打印情况与关联订单完整呈现，作废后仍保留历史打印次数", () => {
    const { rerender } = render(<OutboundDetailModal row={detailOutbound} snap={detailSnapshot} onClose={vi.fn()} />);
    expect(screen.getByText("已打印")).toBeInTheDocument();
    expect(screen.getByText("第 1 次打印")).toBeInTheDocument();
    expect(screen.getByText(detailOutbound.orderNo)).toBeInTheDocument();
    expect(screen.getByText("辅助动片")).toBeInTheDocument();
    rerender(
        <OutboundDetailModal
            row={{ ...detailOutbound, state: "voided", voidReason: "纸质单已作废，货物未离开" }}
            snap={detailSnapshot}
            onClose={vi.fn()}
        />,
    );
    expect(screen.getByText("已作废")).toBeInTheDocument();
    expect(screen.getByText("纸质单已作废，货物未离开")).toBeInTheDocument();
    expect(screen.getByText("第 1 次打印")).toBeInTheDocument();
});

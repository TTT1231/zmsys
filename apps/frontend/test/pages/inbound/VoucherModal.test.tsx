// @vitest-environment jsdom
/* 入库凭证保留数量、登记信息及完整规格，作废状态清楚可辨。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VoucherModal } from "@/pages/inbound/InboundPage";
import { detailInbound, detailSnapshot } from "../../fixtures/recordDetails";
afterEach(cleanup);
it("数量与状态先于规格，作废说明不隐藏原始数量和备注", () => {
    render(<VoucherModal row={{ ...detailInbound, status: "voided" }} snap={detailSnapshot} onClose={vi.fn()} />);
    const summary = screen.getByRole("region", { name: "数量与状态" });
    expect(summary).toHaveTextContent("已作废");
    expect(summary).toHaveTextContent("200个");
    expect(
        summary.compareDocumentPosition(screen.getByRole("region", { name: "BOM 详细" })) &
            Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(detailInbound.remark!)).toBeInTheDocument();
    expect(screen.getByText(detailInbound.time)).toBeInTheDocument();
});

// @vitest-environment jsdom
/* 入库台账在 BOM 编码旁直接展示 BOM 备注：同构成不同备注的成品一眼可辨；
   状态筛选（已入库/已作废）按行状态快速过滤。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { InboundPage } from "@/pages/inbound/InboundPage";
import { detailBom, detailInbound, detailSnapshot } from "../../fixtures/recordDetails";
import type { Bom, InboundRow } from "@/api";

const remarkedBom: Bom = { ...detailBom, code: "XK2005", name: "XK2 旋转开关", remark: "杆子白色4.8" };
const remarkedInbound: InboundRow = { ...detailInbound, no: "RK26091302", bomCode: remarkedBom.code };
const voidedInbound: InboundRow = { ...detailInbound, no: "RK26091303", status: "voided" };

vi.mock("@/context/useApp", () => ({
    useApp: () => ({
        role: "super",
        can: (code: string) => ["inbound:register", "inbound:edit"].includes(code),
    }),
}));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => vi.fn() }));
vi.mock("@/data/queries", () => ({
    useWbSnapshot: () => ({
        data: {
            ...detailSnapshot,
            boms: [detailBom, remarkedBom],
            inboundLedger: [remarkedInbound, detailInbound, voidedInbound],
        },
    }),
    useWbRefresh: () => ({ refresh: vi.fn() }),
    useCreateInbound: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateInbound: () => ({ mutate: vi.fn(), isPending: false }),
    useVoidInbound: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteInbound: () => ({ mutate: vi.fn(), isPending: false }),
}));
afterEach(cleanup);

it("BOM 备注列紧跟 BOM 编码：有备注突出显示，无备注占位不空缺", () => {
    render(
        <MemoryRouter>
            <InboundPage />
        </MemoryRouter>,
    );
    const table = within(screen.getByRole("table"));
    const headers = table.getAllByRole("columnheader");
    const codeIndex = headers.findIndex(header => header.textContent?.includes("BOM 编码"));
    expect(headers[codeIndex + 1]?.textContent).toBe("BOM 备注");

    expect(table.getByText("杆子白色4.8")).toHaveClass("text-warning");
    const plainRow = table.getByText(detailInbound.no).closest("tr")!;
    expect(within(plainRow).getByText("—")).toBeInTheDocument();
});

it("移动端卡片同样携带 BOM 备注", () => {
    render(
        <MemoryRouter>
            <InboundPage />
        </MemoryRouter>,
    );
    const card = [...document.querySelectorAll<HTMLElement>(".mobile-records article")].find(node =>
        node.textContent?.includes(remarkedInbound.no),
    )!;
    expect(within(card).getByText("杆子白色4.8")).toBeInTheDocument();
});

it("状态筛选：已入库只留有效记录，已作废只留作废记录，清空条件恢复", () => {
    render(
        <MemoryRouter>
            <InboundPage />
        </MemoryRouter>,
    );
    const select = screen.getByLabelText("按状态筛选");
    fireEvent.change(select, { target: { value: "已作废" } });
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent(voidedInbound.no);
    expect(table).not.toHaveTextContent(detailInbound.no);
    expect(table).not.toHaveTextContent(remarkedInbound.no);

    fireEvent.change(select, { target: { value: "已入库" } });
    expect(table).not.toHaveTextContent(voidedInbound.no);
    expect(table).toHaveTextContent(detailInbound.no);
    expect(table).toHaveTextContent(remarkedInbound.no);

    fireEvent.click(screen.getByRole("button", { name: "清空条件" }));
    expect(table).toHaveTextContent(voidedInbound.no);
});

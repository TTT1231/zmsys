// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { OutboundPage } from "@/pages/outbound/OutboundPage";
import { InboundPage } from "@/pages/inbound/InboundPage";
import { detailSnapshot, detailOutbound, detailInbound } from "../fixtures/recordDetails";

const state = vi.hoisted(() => ({
    outboundState: "registered" as "registered" | "voided",
    allowed: true,
    today: "2026-09-13",
    print: vi.fn(),
    void: vi.fn(),
}));
vi.mock("@/context/useApp", () => ({
    useApp: () => ({
        role: "super",
        can: (code: string) => state.allowed && ["outbound:print", "outbound:void", "inbound:edit"].includes(code),
    }),
}));
vi.mock("@/lib/date", () => ({ todayIso: () => state.today }));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => vi.fn() }));
vi.mock("@/data/queries", () => ({
    useWbSnapshot: () => ({
        data: { ...detailSnapshot, outboundLedger: [{ ...detailOutbound, state: state.outboundState }] },
    }),
    useWbRefresh: () => ({ refresh: vi.fn() }),
    usePrintOutbound: () => ({ mutate: state.print, isPending: false }),
    useVoidOutbound: () => ({ mutate: state.void, isPending: false }),
    useVoidInbound: () => ({ mutate: state.void, isPending: false }),
}));
afterEach(() => {
    cleanup();
    state.allowed = true;
    state.outboundState = "registered";
    state.today = "2026-09-13";
    vi.clearAllMocks();
});

function openOutbound() {
    render(
        <MemoryRouter>
            <OutboundPage />
        </MemoryRouter>,
    );
    const table = within(screen.getByRole("table"));
    expect(table.queryByRole("button", { name: "打印" })).not.toBeInTheDocument();
    expect(table.queryByRole("button", { name: "作废" })).not.toBeInTheDocument();
    fireEvent.click(table.getByRole("button", { name: "查看详情" }));
    const detail = within(screen.getByRole("dialog", { name: detailOutbound.no }));
    expect(detail.getByRole("region", { name: "详情" })).toHaveTextContent("BOM 备注：—");
    return detail;
}
it("已登记出库提供打印与作废；作废要求原因并携带乐观锁版本", () => {
    const detail = openOutbound();
    expect(detail.getByRole("button", { name: "打印" })).toBeInTheDocument();
    fireEvent.click(detail.getByRole("button", { name: "作废" }));
    const confirm = within(screen.getByRole("dialog", { name: "作废" }));
    fireEvent.change(confirm.getByRole("textbox"), { target: { value: "登记数量有误" } });
    fireEvent.click(confirm.getByRole("button", { name: "确认作废" }));
    expect(state.void).toHaveBeenCalledWith(
        { no: detailOutbound.no, expectedVersion: detailOutbound.version, reason: "登记数量有误" },
        expect.anything(),
    );
});
it("已作废出库仍可打印（打印件带作废标注），但不再提供作废", () => {
    state.outboundState = "voided";
    const detail = openOutbound();
    expect(detail.getByRole("button", { name: "打印" })).toBeInTheDocument();
    expect(detail.queryByRole("button", { name: "作废" })).not.toBeInTheDocument();
});
it("没有写权限时详情仍可读，但不提供打印和作废入口", () => {
    state.allowed = false;
    const detail = openOutbound();
    expect(detail.queryByRole("button", { name: /打印|作废/ })).not.toBeInTheDocument();
});
it("当天入库修正和作废只出现在凭证中，跨日不再提供", () => {
    const open = () => {
        render(
            <MemoryRouter>
                <InboundPage />
            </MemoryRouter>,
        );
        const table = within(screen.getByRole("table"));
        expect(table.queryByRole("button", { name: "修正" })).not.toBeInTheDocument();
        expect(table.queryByRole("button", { name: "作废" })).not.toBeInTheDocument();
        fireEvent.click(table.getByRole("button", { name: "查看详情" }));
        return within(screen.getByRole("dialog", { name: detailInbound.no }));
    };
    let detail = open();
    expect(detail.getByRole("button", { name: "修正" })).toBeInTheDocument();
    expect(detail.getByRole("button", { name: "作废" })).toBeInTheDocument();
    cleanup();
    state.today = "2026-09-14";
    detail = open();
    expect(detail.queryByRole("button", { name: /修正|作废/ })).not.toBeInTheDocument();
});

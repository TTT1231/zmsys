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
    inboundStatus: "active" as "active" | "voided",
    allowed: true,
    today: "2026-09-13",
    print: vi.fn(),
    void: vi.fn(),
    del: vi.fn(),
    extraPerms: [] as string[],
}));
vi.mock("@/context/useApp", () => ({
    useApp: () => ({
        role: "super",
        can: (code: string) =>
            state.allowed && [...state.extraPerms, "outbound:print", "outbound:void", "inbound:edit"].includes(code),
    }),
}));
/* beijingDateOf 用真实实现（fixtures 的 createdAt 为 UTC 时刻），"今天"由测试态控制 */
vi.mock("@/lib/date", async importOriginal => {
    const actual = await importOriginal<typeof import("@/lib/date")>();
    return { ...actual, todayIso: () => state.today, beijingTodayIso: () => state.today };
});
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => vi.fn() }));
vi.mock("@/data/queries", () => ({
    useWbSnapshot: () => ({
        data: {
            ...detailSnapshot,
            inboundLedger: [{ ...detailInbound, status: state.inboundStatus }],
            outboundLedger: [{ ...detailOutbound, state: state.outboundState }],
        },
    }),
    useWbRefresh: () => ({ refresh: vi.fn() }),
    usePrintOutbound: () => ({ mutate: state.print, isPending: false }),
    useVoidOutbound: () => ({ mutate: state.void, isPending: false }),
    useVoidInbound: () => ({ mutate: state.void, isPending: false }),
    useDeleteOutbound: () => ({ mutate: state.del, isPending: false }),
    useDeleteInbound: () => ({ mutate: state.del, isPending: false }),
}));
afterEach(() => {
    cleanup();
    state.allowed = true;
    state.outboundState = "registered";
    state.inboundStatus = "active";
    state.today = "2026-09-13";
    state.extraPerms = [];
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
    const confirm = within(screen.getByRole("dialog", { name: "作废出库单" }));
    expect(confirm.getByText(/库存增加/)).toBeInTheDocument();
    expect(confirm.getByText(/已发数量同时减少/)).toBeInTheDocument();
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
    expect(detail.queryByRole("button", { name: /打印|作废|删除/ })).not.toBeInTheDocument();
});
it("已作废出库对持删除权限者出现删除入口，确认后携带乐观锁版本调用", () => {
    state.outboundState = "voided";
    state.extraPerms = ["outbound:delete"];
    const detail = openOutbound();
    fireEvent.click(detail.getByRole("button", { name: "删除" }));
    const confirm = screen.getByRole("dialog", { name: "删除出库单" });
    expect(confirm).toHaveTextContent(/7 天后清理记录/);
    fireEvent.click(within(confirm).getByRole("button", { name: "确认删除" }));
    expect(state.del).toHaveBeenCalledWith(
        { no: detailOutbound.no, expectedVersion: detailOutbound.version },
        expect.anything(),
    );
});

function openInbound() {
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
}
it("当天入库修正和作废只出现在详情中，跨日不再提供（无跨天权限时）", () => {
    let detail = openInbound();
    expect(detail.getByRole("button", { name: "修正" })).toBeInTheDocument();
    expect(detail.getByRole("button", { name: "作废" })).toBeInTheDocument();
    cleanup();
    state.today = "2026-09-14";
    detail = openInbound();
    expect(detail.queryByRole("button", { name: /修正|作废|删除/ })).not.toBeInTheDocument();
});
it("持跨天作废权限时跨日仍可作废，且确认弹窗带二次确认警示", () => {
    state.today = "2026-09-14";
    state.extraPerms = ["inbound:void-any-day"];
    const detail = openInbound();
    // 跨日修正不放开，仍走库存调整
    expect(detail.queryByRole("button", { name: "修正" })).not.toBeInTheDocument();
    fireEvent.click(detail.getByRole("button", { name: "作废" }));
    const confirm = screen.getByRole("dialog", { name: "作废入库单" });
    expect(confirm).toHaveTextContent(/库存减少/);
    expect(confirm).toHaveTextContent(/作废会改动历史库存统计/);
    fireEvent.change(within(confirm).getByRole("textbox"), { target: { value: "历史登记有误" } });
    fireEvent.click(within(confirm).getByRole("button", { name: "确认跨天作废" }));
    expect(state.void).toHaveBeenCalledWith(
        { no: detailInbound.no, expectedVersion: detailInbound.version, reason: "历史登记有误" },
        expect.anything(),
    );
});
it("已作废入库对持删除权限者出现删除入口，确认后携带乐观锁版本调用", () => {
    state.inboundStatus = "voided";
    state.extraPerms = ["inbound:delete"];
    const detail = openInbound();
    fireEvent.click(detail.getByRole("button", { name: "删除" }));
    const confirm = screen.getByRole("dialog", { name: "删除入库单" });
    expect(confirm).toHaveTextContent(/7 天后清理记录/);
    fireEvent.click(within(confirm).getByRole("button", { name: "确认删除" }));
    expect(state.del).toHaveBeenCalledWith(
        { no: detailInbound.no, expectedVersion: detailInbound.version },
        expect.anything(),
    );
});
it("无删除权限时已作废入库不出现删除入口", () => {
    state.inboundStatus = "voided";
    const detail = openInbound();
    expect(detail.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
});

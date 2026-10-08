// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BusinessRelations } from "@/pages/analytics/BusinessRelations";
import { RELATION_TYPES, type RelationsData } from "@/data/relations";
import { todayIso, addDays } from "@/lib/date";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), chart: vi.fn() }));
vi.mock("@/api/workbench", () => ({ fetchWorkbenchRelations: mocks.fetch }));
vi.mock("@/pages/analytics/useRelationChart", () => ({
    useRelationChart: (...args: unknown[]) => {
        mocks.chart(...args);
        return { zoom: 1, fit: vi.fn(), reset: vi.fn(), zoomBy: vi.fn() };
    },
}));

const data: RelationsData = {
    schemaVersion: 1,
    asOf: "2026-10-08",
    generatedAt: "2026-10-08T08:00:00Z",
    filters: {
        status: "open",
        start: null,
        end: null,
        types: ["bom", "order"],
        orderNo: null,
        bomCode: null,
        customerCode: null,
    },
    counts: { open: 1, completed: 2, archived: 1, all: 4 },
    typeCounts: { bom: 1, customer: 0, order: 1, inbound: 0, outbound: 0, person: 0 },
    summary: { orderCount: 1, overdueOrderIds: [], quantitiesByUnit: [] },
    nodes: [
        {
            id: "bom:1",
            type: "bom",
            name: "KW001",
            properties: { BOM编号: "KW001" },
            facts: { type: "bom", code: "KW001", unit: "个", stock: 20, createdById: "person:1" },
        },
        {
            id: "order:2",
            type: "order",
            name: "SO001",
            properties: { 订单数量: "100 个" },
            facts: {
                type: "order",
                no: "SO001",
                date: "2026-10-01",
                due: "2026-10-10",
                qty: 100,
                shipped: 20,
                unshippedQty: 80,
                pendingQty: 80,
                archived: false,
                unit: "个",
                bomId: "bom:1",
                customerId: "customer:1",
                createdById: "person:1",
                archivedById: null,
            },
        },
    ],
    edges: [{ source: "order:2", target: "bom:1", relation: "订购", kind: "business" }],
};
const allTypes = RELATION_TYPES.map(t => t.key);
const mount = () =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
            <BusinessRelations />
        </QueryClientProvider>,
    );
beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(data);
});
afterEach(cleanup);

it("默认近30天，直接把服务端 nodes/edges 交给图表；状态和类型筛选进入请求", async () => {
    mount();
    await screen.findByRole("button", { name: "重新布局" });
    await waitFor(() => expect(mocks.chart.mock.calls.at(-1)?.slice(1, 3)).toEqual([data.nodes, data.edges]));
    expect(mocks.fetch).toHaveBeenCalledWith("open", { start: addDays(todayIso(), -29), end: todayIso() }, allTypes);
    fireEvent.click(screen.getByRole("button", { name: /^已完成/ }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenLastCalledWith("completed", expect.any(Object), allTypes));
    fireEvent.click(within(screen.getByRole("group", { name: "节点类型" })).getByRole("button", { name: /^人员/ }));
    await waitFor(() =>
        expect(mocks.fetch).toHaveBeenLastCalledWith(
            "completed",
            expect.any(Object),
            allTypes.filter(t => t !== "person"),
        ),
    );
});

it("日期先编辑后提交，逆序日期禁止提交，全部时间清除边界", async () => {
    mount();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("业务开始日期"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("业务结束日期"), { target: { value: "2026-10-10" } });
    expect(screen.getByRole("button", { name: "筛选" })).toBeDisabled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("业务开始日期"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    await waitFor(() =>
        expect(mocks.fetch).toHaveBeenLastCalledWith("open", { start: "2026-10-01", end: "2026-10-10" }, allTypes),
    );
    fireEvent.click(screen.getByRole("button", { name: "全部时间" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenLastCalledWith("open", { start: "", end: "" }, allTypes));
});

it("选择节点可查看服务端详情并沿真实关系切换，Escape 关闭", async () => {
    mount();
    const selector = await screen.findByRole("combobox", { name: "选择节点" });
    await waitFor(() => expect(selector).toBeEnabled());
    fireEvent.change(selector, { target: { value: "order:2" } });
    let details = screen.getByRole("complementary", { name: "节点信息" });
    expect(within(details).getByText("100 个")).toBeInTheDocument();
    fireEvent.click(within(details).getByRole("button", { name: /KW001.*订购/ }));
    details = screen.getByRole("complementary", { name: "节点信息" });
    expect(within(details).getByRole("heading", { name: "KW001" })).toBeInTheDocument();
    fireEvent.keyDown(details, { key: "Escape" });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});

it("请求失败显示重试，成功后可恢复关系图", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("network unavailable"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法加载关系图");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "选择节点" })).toBeEnabled();
});

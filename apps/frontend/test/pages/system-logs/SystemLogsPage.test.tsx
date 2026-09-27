// @vitest-environment jsdom
/* 系统日志页：时间线卡片渲染（动词语义/预览/details 原因）、空态、tab 与自定义范围交互。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SystemLogsPage } from "@/pages/system-logs/SystemLogsPage";
import type { SystemLogPage } from "@/api";

const useSystemLogs = vi.fn();

vi.mock("@/data/queries", () => ({
    useSystemLogs: (...args: unknown[]) => useSystemLogs(...(args as [])),
}));

const pageOf = (items: SystemLogPage["items"], nextCursor: SystemLogPage["nextCursor"] = null): SystemLogPage => ({
    items,
    nextCursor,
});

const orderEdit: SystemLogPage["items"][number] = {
    id: "229783530000000001",
    occurredAt: "2026-09-26T02:27:00.000Z",
    actor: { name: "李晓", role: "admin" },
    domain: "order",
    action: "edit",
    targetCode: "SO-202609-018",
    targetName: "华辰电器",
    changes: [
        { label: "订单数量", before: "500 个", after: "600 个" },
        { label: "交货日期", before: "2026-10-08", after: "2026-10-12" },
    ],
    reason: null,
};

const customerCreate: SystemLogPage["items"][number] = {
    id: "229783530000000002",
    occurredAt: "2026-09-25T06:51:00.000Z",
    actor: { name: "张晨", role: "sales" },
    domain: "customer",
    action: "create",
    targetCode: "CUS-0125",
    targetName: "嘉信电子",
    changes: [
        { label: "客户名称", before: null, after: "嘉信电子" },
        { label: "负责销售", before: null, after: "sales01" },
    ],
    reason: null,
};

const transfer: SystemLogPage["items"][number] = {
    id: "229783530000000003",
    occurredAt: "2026-09-24T08:38:00.000Z",
    actor: { name: "超级管理员", role: "super" },
    domain: "customer",
    action: "transfer",
    targetCode: "CUS-0107",
    targetName: "锦泰科技",
    changes: [{ label: "负责销售", before: "周宁", after: "王明" }],
    reason: "原负责人离岗，统一移交客户",
};

beforeEach(() => {
    useSystemLogs.mockReset();
    useSystemLogs.mockReturnValue({
        data: { pages: [pageOf([orderEdit, customerCreate, transfer])] },
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
    });
});
afterEach(cleanup);

const renderPage = () =>
    render(
        <MemoryRouter>
            <SystemLogsPage />
        </MemoryRouter>,
    );

it("时间线按天分组渲染卡片：动词语义、域徽章、编号与名称、北京时间", () => {
    renderPage();
    // 北京日分组：02:27Z = 北京 10:27（09-26）；06:51Z = 14:51（09-25）；08:38Z = 16:38（09-24）
    const sections = screen.getAllByRole("region");
    expect(sections.length).toBe(3);
    expect(screen.getByText("李晓")).toBeInTheDocument();
    expect(screen.getByText("编辑了")).toBeInTheDocument();
    // 域名同时出现在 tab 与卡片 meta，卡片内断言即可
    const cards = screen.getAllByRole("listitem");
    const editCard = cards.find(card => card.textContent?.includes("SO-202609-018"))!;
    expect(within(editCard).getAllByText("销售订单").length).toBeGreaterThan(0);
    expect(screen.getByText("10:27")).toBeInTheDocument();
    expect(screen.getByText("SO-202609-018")).toBeInTheDocument();
    expect(screen.getByText("华辰电器")).toBeInTheDocument();
    // 角色代号映射为中文名
    expect(screen.getByText("管理员")).toBeInTheDocument();
});

it("首条变更预览：编辑类显示旧值划线与箭头，新建类（before=null）只显示新值", () => {
    renderPage();
    const cards = screen.getAllByRole("listitem");
    const editCard = cards.find(card => card.textContent?.includes("SO-202609-018"))!;
    const createCard = cards.find(card => card.textContent?.includes("CUS-0125"))!;
    // 折叠态：明细惰性渲染，旧值仅在预览出现（划线）
    const fiveHundreds = within(editCard).getAllByText("500 个");
    expect(fiveHundreds.length).toBe(1);
    expect(fiveHundreds[0]!.className).toContain("line-through");
    expect(within(editCard).getAllByText("600 个").length).toBeGreaterThan(0);
    // 新建：无划线旧值，预览直接显示新值
    expect(within(createCard).getAllByText("嘉信电子").length).toBeGreaterThan(0);
    const struckInCreate = within(createCard).queryByText(
        (content, element) => content !== "" && element?.classList.contains("line-through") === true,
    );
    expect(struckInCreate).toBeNull();
});

it("展开详情显示全量变更与操作原因块；null-before 在明细中显示「新建记录」", () => {
    renderPage();
    const cards = screen.getAllByRole("listitem");
    const transferCard = cards.find(card => card.textContent?.includes("CUS-0107"))!;
    fireEvent.click(within(transferCard).getByRole("button", { name: /查看变更详情/ }));
    // 展开后：预览 + 明细各一处
    expect(within(transferCard).getAllByText("周宁").length).toBe(2);
    expect(within(transferCard).getAllByText("王明").length).toBe(2);
    // 原因块：strong 标签与正文同段落
    const reasonLabel = within(transferCard).getByText(/操作原因：/);
    expect(reasonLabel.parentElement).toHaveTextContent("原负责人离岗，统一移交客户");

    const createCard = cards.find(card => card.textContent?.includes("CUS-0125"))!;
    fireEvent.click(within(createCard).getByRole("button", { name: /查看变更详情/ }));
    expect(within(createCard).getAllByText("新建记录").length).toBe(2);
});

it("仅有原因无字段变更的事件也渲染详情入口与原因块", () => {
    useSystemLogs.mockReturnValue({
        data: {
            pages: [
                pageOf([
                    {
                        ...transfer,
                        changes: null,
                        reason: "离岗批量移交",
                    },
                ]),
            ],
        },
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /查看变更详情/ }));
    expect(screen.getByText(/操作原因：/).parentElement).toHaveTextContent("离岗批量移交");
    expect(screen.queryByText("本次记录")).not.toBeInTheDocument();
});

it("无结果时展示空态文案", () => {
    useSystemLogs.mockReturnValue({
        data: { pages: [pageOf([])] },
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("没有找到对应记录，试试更换业务类型、操作类型或关键词。")).toBeInTheDocument();
});

it("切换业务域 tab 时以新筛选发起查询", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "成品入库" }));
    expect(useSystemLogs).toHaveBeenLastCalledWith(expect.objectContaining({ domain: "inbound" }), true);
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(useSystemLogs).toHaveBeenLastCalledWith(expect.not.objectContaining({ domain: expect.anything() }), true);
});

it("自定义范围延迟生效：from>to 报错（role=alert），合法时点应用才并入查询", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("时间范围"), { target: { value: "custom" } });
    const from = screen.getByLabelText("开始日期");
    const to = screen.getByLabelText("结束日期");
    fireEvent.change(from, { target: { value: "2026-09-20" } });
    fireEvent.change(to, { target: { value: "2026-09-10" } });
    fireEvent.click(screen.getByRole("button", { name: "应用范围" }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("开始日期不能晚于结束日期");

    fireEvent.change(to, { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: "应用范围" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(useSystemLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ range: "custom", from: "2026-09-20", to: "2026-09-30" }),
        true,
    );
});

it("重置回到默认筛选：全部 tab、清空关键词、操作类型 all、时间范围今天", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "华辰" } });
    fireEvent.change(screen.getByLabelText("操作类型"), { target: { value: "edit" } });
    fireEvent.click(screen.getByRole("button", { name: "客户档案" }));
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    expect(useSystemLogs).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 20 }), true);
    // 关键词清空受 300ms 防抖影响：等待防抖到期后查询参数归零
    await vi.waitFor(() => {
        const last = useSystemLogs.mock.calls.at(-1)![0] as Record<string, unknown>;
        expect(last.domain).toBeUndefined();
        expect(last.action).toBeUndefined();
        expect(last.keyword).toBeUndefined();
        expect(last.range).toBe("today");
    });
});

it("还有下一批时显示加载更多，点击触发 fetchNextPage", () => {
    const fetchNextPage = vi.fn();
    useSystemLogs.mockReturnValue({
        data: { pages: [pageOf([orderEdit], { at: orderEdit.occurredAt, id: orderEdit.id })] },
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: true,
        fetchNextPage,
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "加载更多记录" }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
});

it("自定义范围未应用时不发起查询，显示引导空态；应用后恢复", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("时间范围"), { target: { value: "custom" } });
    // 未点应用：查询被禁用（enabled=false）且页面提示选择日期
    const lastCall = useSystemLogs.mock.calls.at(-1)!;
    expect(lastCall[1]).toBe(false);
    expect(screen.getByText("请选择开始与结束日期，并点击「应用范围」后查看。")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: "应用范围" }));
    expect(useSystemLogs.mock.calls.at(-1)![1]).toBe(true);
    expect(useSystemLogs.mock.calls.at(-1)![0]).toMatchObject({
        range: "custom",
        from: "2026-09-20",
        to: "2026-09-30",
    });
});

it("查询失败时显示错误态与重试入口，不误报为空结果", () => {
    useSystemLogs.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error("网络超时"),
        refetch: vi.fn(),
        isFetchingNextPage: false,
        isFetchNextPageError: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/日志加载失败：网络超时/)).toBeInTheDocument();
    expect(screen.queryByText(/没有找到对应记录/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
});

it("关键词防抖：输入停顿 300ms 后才并入查询", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "华辰" } });
    // 防抖窗口内不触发新查询参数
    expect(useSystemLogs.mock.calls.at(-1)![0]).not.toMatchObject({ keyword: "华辰" });
    await vi.waitFor(() => expect(useSystemLogs.mock.calls.at(-1)![0]).toMatchObject({ keyword: "华辰" }), {
        timeout: 1000,
    });
});

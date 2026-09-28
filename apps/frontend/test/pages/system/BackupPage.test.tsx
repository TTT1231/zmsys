// @vitest-environment jsdom
/* 备份页：目录渲染（sequences 不出现）、勾选联动与「自动包含」角标、格式弹窗（gzip 选择）与下载回调。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BackupPage } from "@/pages/system/BackupPage";
import type { BackupCatalog } from "@/api";

const fetchBackupCatalog = vi.fn();
const runBackup = vi.fn();
const toast = vi.fn();

vi.mock("@/api", () => ({
    fetchBackupCatalog: (...args: unknown[]) => fetchBackupCatalog(...(args as [])),
    runBackup: (...args: unknown[]) => runBackup(...(args as [])),
}));
vi.mock("@/context/useApp", () => ({
    useApp: () => ({ can: () => true }),
}));
vi.mock("@/components/ui/toastContexts", () => ({
    useToast: () => toast,
}));

/* 与后端 backup.catalog.ts 同构的目录（groups 顺序即勾选集顺序） */
const GROUPS: BackupCatalog["groups"] = [
    {
        key: "users",
        label: "用户与权限",
        tables: ["sys_role", "sys_user", "sys_grant", "sys_grant_log", "sys_user_change_log"],
        dependsOn: [],
    },
    { key: "sequences", label: "单号计数器", tables: ["biz_sequence"], dependsOn: [] },
    {
        key: "customers",
        label: "客户档案",
        tables: ["custom_table", "customer_owner_history"],
        dependsOn: ["users", "sequences"],
    },
    {
        key: "bom",
        label: "物料与BOM",
        tables: ["bom_category", "material_group", "material_item", "bom_table", "bom_item"],
        dependsOn: ["users", "sequences"],
    },
    {
        key: "orders",
        label: "销售订单",
        tables: ["sales_order_table", "sales_order_change_log"],
        dependsOn: ["customers", "bom", "users", "sequences"],
    },
    {
        key: "inbound",
        label: "成品入库",
        tables: ["inbound_ledger", "inbound_change_log", "stock_adjustment"],
        dependsOn: ["bom", "users", "sequences", "outbound"],
    },
    {
        key: "outbound",
        label: "成品出库",
        tables: ["outbound_shipment", "outbound_ledger", "outbound_state_log"],
        dependsOn: ["orders", "sequences", "inbound"],
    },
    { key: "system", label: "系统与日志", tables: ["op_log"], dependsOn: ["users"] },
];

const CATALOG: BackupCatalog = { groups: GROUPS, allGroupKeys: GROUPS.map(group => group.key) };

const ALL_KEYS = CATALOG.allGroupKeys;

beforeEach(() => {
    fetchBackupCatalog.mockReset();
    runBackup.mockReset();
    toast.mockReset();
    fetchBackupCatalog.mockResolvedValue(CATALOG);
    runBackup.mockResolvedValue({ fileName: "zmdb-full-20260928.sql", data: new Blob(["backup"]) });
    Object.defineProperty(URL, "createObjectURL", {
        value: vi.fn(() => "blob:mock"),
        configurable: true,
        writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true, writable: true });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const renderPage = () =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <BackupPage />
        </QueryClientProvider>,
    );

it("目录加载后默认全选：七个业务组可见、sequences 不出现、描述含依赖与表数", async () => {
    renderPage();
    expect(await screen.findByText("用户与权限")).toBeInTheDocument();
    expect(screen.queryByText("单号计数器")).toBeNull();
    // 默认全选：无「自动包含」角标
    expect(screen.queryByText("自动包含")).toBeNull();
    const selectAll = screen.getByRole("checkbox", { name: "全部" }) as HTMLInputElement;
    expect(selectAll.checked).toBe(true);
    // 三段式说明：描述 · 依赖（过滤内部组）· 表数
    expect(screen.getByText(/依赖：客户档案、物料与 BOM、用户与权限 · 2 张数据表/)).toBeInTheDocument();
});

it("取消后再勾选触发联动：闭包带出的组显示「自动包含」角标", async () => {
    renderPage();
    await screen.findByText("用户与权限");
    // 取消销售订单：outbound（依赖 orders）、inbound（依赖 outbound）被级联净化
    // 组名锚定标题匹配：成品出库的描述含「依赖：销售订单」，裸正则会双命中
    fireEvent.click(screen.getByRole("checkbox", { name: /^销售订单/ }));
    expect(screen.getByRole("checkbox", { name: /^成品出库/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^成品入库/ })).not.toBeChecked();
    // 重新勾选成品入库：闭包补齐 outbound 与其依赖 orders，二者均非人工勾选
    fireEvent.click(screen.getByRole("checkbox", { name: /^成品入库/ }));
    expect(screen.getByRole("checkbox", { name: /^销售订单/ })).toBeChecked();
    const chips = screen.getAllByText("自动包含");
    expect(chips).toHaveLength(2);
});

it("备份按钮打开格式弹窗：默认压缩版，可选未压缩版后执行下载", async () => {
    renderPage();
    await screen.findByText("用户与权限");
    fireEvent.click(screen.getByRole("button", { name: /备份/ }));
    const dialog = await screen.findByRole("dialog", { name: "备份" });
    expect(within(dialog).getByText("文件格式")).toBeInTheDocument();
    expect(within(dialog).getByText("将备份全部 7 个数据组")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("radio", { name: /未压缩版/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /开始备份/ }));
    // mutate 的 mutationFn 在微任务里才执行：等 onSuccess 落地后断言下载与提示
    await waitFor(() => expect(toast).toHaveBeenCalledWith("备份完成：zmdb-full-20260928.sql"));
    expect(runBackup).toHaveBeenCalledWith(ALL_KEYS, false);
    expect(URL.createObjectURL).toHaveBeenCalled();
});

it("部分备份时弹窗提示不能整库还原", async () => {
    renderPage();
    await screen.findByText("用户与权限");
    fireEvent.click(screen.getByRole("checkbox", { name: /操作记录/ }));
    fireEvent.click(screen.getByRole("button", { name: /备份/ }));
    const dialog = await screen.findByRole("dialog", { name: "备份" });
    expect(within(dialog).getByText("将备份 6 / 7 个数据组")).toBeInTheDocument();
    expect(within(dialog).getByText(/当前为部分备份，仅可用于合并补缺，不能整库还原/)).toBeInTheDocument();
});

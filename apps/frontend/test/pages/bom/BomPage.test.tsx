// @vitest-environment jsdom
/* BOM 页接入独立查询：表格渲染物料行，移动卡片库存列在余量未加载时降级为占位符；
   删除入口仅对持 bom:delete、订单引用与库存已成功加载、未被引用且无余量的档案显示；
   点击后需二次确认，确认才发起删除请求、取消不发起。
   使用状态筛选「未使用」= 无销售订单与成品出入库引用，行沿用作废单弱化样式。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { BomPage } from "@/pages/bom/BomPage";
import type { Bom } from "@/api";
import { detailBom } from "../../fixtures/recordDetails";

/* can() 经 ref 切换角色权限：默认 staff 无任何写权限 */
const authRef = vi.hoisted(() => ({ current: { can: (perm: string): boolean => perm === "never" } }));
vi.mock("@/context/useApp", () => ({ useApp: () => ({ role: "staff", can: authRef.current.can }) }));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => vi.fn() }));
const copyText = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("@/lib/clipboard", () => ({ copyText }));

/* 用例间替换库存余量/使用关系返回值：工厂被提升到模块顶部，须经 ref 惰性读取；
   usageRef 只给页面实际消费的字段（orders + 出入库台账），undefined = 引用未加载 */
const stocksRef = vi.hoisted(() => ({ current: undefined as Record<string, number> | undefined }));
const bomsRef = vi.hoisted(() => ({ current: undefined as Bom[] | undefined }));
const usageRef = vi.hoisted(() => ({
    current: undefined as
        | {
              orders: Array<{ bomCode: string }>;
              inboundLedger: Array<{ bomCode: string }>;
              outboundLedger: Array<{ bomCode: string }>;
          }
        | undefined,
}));
const usageErrorRef = vi.hoisted(() => ({ current: false }));
const deleteMutate = vi.hoisted(() => vi.fn());
vi.mock("@/data/queries", () => ({
    useBoms: () => ({ data: bomsRef.current ?? [detailBom], isLoading: false, isFetching: false }),
    useBomCategories: () => ({ data: [], isLoading: false, isFetching: false }),
    useBomStocks: () => ({ data: stocksRef.current, isLoading: false, isFetching: false }),
    useBomUsage: () => ({
        data: usageRef.current,
        isLoading: usageRef.current === undefined && !usageErrorRef.current,
        isFetching: false,
        isError: usageErrorRef.current,
    }),
    useBomRefresh: () => ({ refresh: vi.fn() }),
    useCreateBom: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteBom: () => ({ mutate: deleteMutate, isPending: false }),
}));

const renderPage = () =>
    render(
        <MemoryRouter>
            <BomPage />
        </MemoryRouter>,
    );
afterEach(() => {
    cleanup();
    stocksRef.current = undefined;
    bomsRef.current = undefined;
    usageRef.current = undefined;
    usageErrorRef.current = false;
    authRef.current = { can: () => false };
    deleteMutate.mockClear();
    copyText.mockClear();
});

it("表格渲染 BOM 行，编码入口可打开详情", () => {
    stocksRef.current = { [detailBom.code]: 200 };
    renderPage();
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent(detailBom.code);
    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[0]);
    expect(screen.getByRole("dialog")).toHaveTextContent("6.3支架：铜镀银");
});

it("库存余量已加载时移动卡片显示数量，未加载时降级为占位符", () => {
    stocksRef.current = { [detailBom.code]: 200 };
    const { unmount } = renderPage();
    expect(screen.getByText("当前库存")).toBeInTheDocument();
    expect(screen.getByText("200 个")).toBeInTheDocument();
    unmount();

    stocksRef.current = undefined;
    renderPage();
    // 库存与备注两个卡片字段都降级为占位符
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("200 个")).not.toBeInTheDocument();
});

it("全部状态下按每条 BOM 的使用关系标注未使用行，筛选后保留同样的标注", () => {
    const usedBom = { ...detailBom, code: "KQ011" };
    bomsRef.current = [detailBom, usedBom];
    usageRef.current = { orders: [{ bomCode: usedBom.code }], inboundLedger: [], outboundLedger: [] };
    renderPage();

    const table = screen.getByRole("table");
    expect(screen.getByRole("combobox", { name: "按使用状态筛选" })).toHaveValue("全部状态");
    expect(within(table).getByRole("button", { name: detailBom.code }).closest("tr")).toHaveClass("row-voided");
    expect(within(table).getByRole("button", { name: usedBom.code }).closest("tr")).not.toHaveClass("row-voided");

    fireEvent.change(screen.getByRole("combobox", { name: "按使用状态筛选" }), {
        target: { value: "未使用" },
    });
    expect(within(table).getByRole("button", { name: detailBom.code }).closest("tr")).toHaveClass("row-voided");
    expect(within(table).queryByRole("button", { name: usedBom.code })).not.toBeInTheDocument();
});

it("未使用筛选排除订单和成品台账引用，库存余量未加载不影响筛选", () => {
    stocksRef.current = undefined;
    usageRef.current = { orders: [], inboundLedger: [], outboundLedger: [] };
    const { unmount } = renderPage();
    fireEvent.change(screen.getByRole("combobox", { name: "按使用状态筛选" }), {
        target: { value: "未使用" },
    });
    expect(screen.getByRole("table")).toHaveTextContent(detailBom.code);
    expect(screen.getByRole("table").querySelector("tbody tr.row-voided")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清空条件" }));
    expect(screen.getByRole("combobox", { name: "按使用状态筛选" })).toHaveValue("全部状态");
    unmount();

    for (const references of [
        { orders: [{ bomCode: detailBom.code }], inboundLedger: [], outboundLedger: [] },
        { orders: [], inboundLedger: [{ bomCode: detailBom.code }], outboundLedger: [] },
        { orders: [], inboundLedger: [], outboundLedger: [{ bomCode: detailBom.code }] },
    ]) {
        usageRef.current = references;
        const { unmount: removePage } = renderPage();
        fireEvent.change(screen.getByRole("combobox", { name: "按使用状态筛选" }), {
            target: { value: "未使用" },
        });
        expect(screen.getByText("没有未使用的 BOM")).toBeInTheDocument();
        removePage();
    }
});

it("使用关系未加载或加载失败时不误报为未使用", () => {
    const { unmount } = renderPage();
    expect(screen.getByRole("table").querySelector("tbody tr.row-voided")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "按使用状态筛选" }), {
        target: { value: "未使用" },
    });
    expect(screen.queryByText("没有未使用的 BOM")).not.toBeInTheDocument();
    unmount();

    usageErrorRef.current = true;
    renderPage();
    fireEvent.change(screen.getByRole("combobox", { name: "按使用状态筛选" }), {
        target: { value: "未使用" },
    });
    expect(screen.getAllByText("使用状态加载失败，请刷新重试")).toHaveLength(2);
});

it("删除入口仅超级管理员且未被订单引用时显示；确认后才发起请求，取消不发起", () => {
    // 无删除权限（员工/管理员等）：桌面与移动端都不出现删除入口
    usageRef.current = { orders: [], inboundLedger: [], outboundLedger: [] };
    stocksRef.current = { [detailBom.code]: 0 };
    const { unmount } = renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[0]);
    expect(screen.queryByRole("button", { name: "删除 BOM" })).not.toBeInTheDocument();
    unmount();

    // 超级管理员 + 未被订单引用 + 无库存余量：出现删除入口
    authRef.current = { can: (perm: string) => perm === "bom:delete" };
    renderPage();
    expect(screen.queryByRole("button", { name: "删除 BOM" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "删除 BOM" }));
    expect(screen.getByRole("dialog", { name: "删除 BOM" })).toBeInTheDocument();
    expect(screen.getByText(/未被任何销售订单引用/)).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();

    // 二次确认的“取消”退出弹窗，不发起删除
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "删除 BOM" })).not.toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();

    // 再次进入并“确认删除”：按编码发起请求
    fireEvent.click(screen.getByRole("button", { name: "删除 BOM" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(deleteMutate).toHaveBeenCalledWith(detailBom.code, expect.anything());
});

it("被销售订单或成品台账引用、或有库存余量的档案不显示删除入口", () => {
    authRef.current = { can: (perm: string) => perm === "bom:delete" };

    // 被订单引用（含已取消订单）不可删
    usageRef.current = { orders: [{ bomCode: detailBom.code }], inboundLedger: [], outboundLedger: [] };
    stocksRef.current = { [detailBom.code]: 0 };
    const { unmount } = renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[0]);
    expect(screen.queryByRole("button", { name: "删除 BOM" })).not.toBeInTheDocument();
    unmount();

    // 入库后即使余量为 0，历史流水也不允许删除
    usageRef.current = { orders: [], inboundLedger: [{ bomCode: detailBom.code }], outboundLedger: [] };
    const { unmount: removeLedgerPage } = renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[0]);
    expect(screen.queryByRole("button", { name: "删除 BOM" })).not.toBeInTheDocument();
    removeLedgerPage();

    // 有库存余量（必有流水）同样不显示，后端权威校验兜底
    usageRef.current = { orders: [], inboundLedger: [], outboundLedger: [] };
    stocksRef.current = { [detailBom.code]: 120 };
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[0]);
    expect(screen.queryByRole("button", { name: "删除 BOM" })).not.toBeInTheDocument();
});

it("订单引用或库存余量未加载（含首次请求失败）时，不能把“没有数据”当成“没有引用”", () => {
    authRef.current = { can: (perm: string) => perm === "bom:delete" };

    // 订单引用未加载：即使库存为 0 也不显示删除入口
    usageRef.current = undefined;
    stocksRef.current = { [detailBom.code]: 0 };
    const { unmount } = renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[0]);
    expect(screen.queryByRole("button", { name: "删除 BOM" })).not.toBeInTheDocument();
    unmount();

    // 库存余量未加载：即使无订单引用也不显示删除入口
    usageRef.current = { orders: [], inboundLedger: [], outboundLedger: [] };
    stocksRef.current = undefined;
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[0]);
    expect(screen.queryByRole("button", { name: "删除 BOM" })).not.toBeInTheDocument();
});

it("详情弹窗 BOM 编号旁的复制按钮把编码写入剪贴板", async () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[0]);
    // Modal 的 aria-label 取 title（BOM 编码）
    expect(screen.getByRole("dialog", { name: detailBom.code })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "复制 BOM 编号" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(detailBom.code));
});

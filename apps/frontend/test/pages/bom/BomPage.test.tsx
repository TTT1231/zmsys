// @vitest-environment jsdom
/* BOM 页接入独立查询：表格渲染物料行，移动卡片库存列在余量未加载时降级为占位符；
   删除入口仅对持 bom:delete 且未被订单引用、无库存余量的档案显示。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { BomPage } from "@/pages/bom/BomPage";
import { detailBom } from "../../fixtures/recordDetails";

/* can() 经 ref 切换角色权限：默认 staff 无任何写权限 */
const authRef = vi.hoisted(() => ({ current: { can: (perm: string): boolean => perm === "never" } }));
vi.mock("@/context/AppContext", () => ({ useApp: () => ({ role: "staff", can: authRef.current.can }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));

/* 用例间替换库存余量/订单引用返回值：工厂被提升到模块顶部，须经 ref 惰性读取 */
const stocksRef = vi.hoisted(() => ({ current: undefined as Record<string, number> | undefined }));
const ordersRef = vi.hoisted(() => ({ current: [] as Array<{ bomCode: string }> }));
vi.mock("@/data/queries", () => ({
    useBoms: () => ({ data: [detailBom], isLoading: false, isFetching: false }),
    useBomCategories: () => ({ data: [], isLoading: false, isFetching: false }),
    useBomStocks: () => ({ data: stocksRef.current, isLoading: false, isFetching: false }),
    useOrders: () => ({ data: ordersRef.current, isLoading: false, isFetching: false }),
    useBomRefresh: () => ({ refresh: vi.fn() }),
    useCreateBom: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteBom: () => ({ mutate: vi.fn(), isPending: false }),
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
    ordersRef.current = [];
    authRef.current = { can: () => false };
});

it("表格渲染 BOM 行，编码入口可打开详情", () => {
    stocksRef.current = { [detailBom.code]: 200 };
    renderPage();
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent(detailBom.code);
    expect(table).toHaveTextContent("6.3支架：铜镀银");
});

it("库存余量已加载时移动卡片显示数量，未加载时降级为占位符", () => {
    stocksRef.current = { [detailBom.code]: 200 };
    const { unmount } = renderPage();
    expect(screen.getByText("当前库存")).toBeInTheDocument();
    expect(screen.getByText("200 件")).toBeInTheDocument();
    unmount();

    stocksRef.current = undefined;
    renderPage();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("200 件")).not.toBeInTheDocument();
});

it("删除入口仅超级管理员且未被订单引用时显示，点击后需二次确认", () => {
    // 无删除权限（员工/管理员等）：桌面与移动端都不出现删除入口
    stocksRef.current = { [detailBom.code]: 0 };
    const { unmount } = renderPage();
    expect(screen.queryAllByRole("button", { name: "删除" })).toHaveLength(0);
    unmount();

    // 超级管理员 + 未被订单引用 + 无库存余量：出现删除入口
    authRef.current = { can: (perm: string) => perm === "bom:delete" };
    renderPage();
    // 移动卡片与桌面表格各一个入口
    const entries = screen.getAllByRole("button", { name: "删除" });
    expect(entries).toHaveLength(2);
    fireEvent.click(entries[0]!);
    expect(screen.getByText("删除 BOM")).toBeInTheDocument();
    expect(screen.getByText(/未被任何销售订单引用/)).toBeInTheDocument();
});

it("被销售订单引用或有库存余量的档案不显示删除入口", () => {
    authRef.current = { can: (perm: string) => perm === "bom:delete" };

    // 被订单引用（含已取消订单）不可删
    ordersRef.current = [{ bomCode: detailBom.code }];
    stocksRef.current = { [detailBom.code]: 0 };
    const { unmount } = renderPage();
    expect(screen.queryAllByRole("button", { name: "删除" })).toHaveLength(0);
    unmount();

    // 有库存余量（必有流水）同样不显示，后端权威校验兜底
    ordersRef.current = [];
    stocksRef.current = { [detailBom.code]: 120 };
    renderPage();
    expect(screen.queryAllByRole("button", { name: "删除" })).toHaveLength(0);
});

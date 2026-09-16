// @vitest-environment jsdom
/* BOM 页接入独立查询：表格渲染物料行，移动卡片库存列在余量未加载时降级为占位符。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { BomPage } from "@/pages/bom/BomPage";
import { detailBom } from "../../fixtures/recordDetails";

vi.mock("@/context/AppContext", () => ({ useApp: () => ({ role: "staff", can: () => false }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));

/* 用例间替换库存余量返回值：工厂被提升到模块顶部，须经 ref 惰性读取 */
const stocksRef = vi.hoisted(() => ({ current: undefined as Record<string, number> | undefined }));
vi.mock("@/data/queries", () => ({
    useBoms: () => ({ data: [detailBom], isLoading: false, isFetching: false }),
    useBomCategories: () => ({ data: [], isLoading: false, isFetching: false }),
    useBomStocks: () => ({ data: stocksRef.current, isLoading: false, isFetching: false }),
    useBomRefresh: () => ({ refresh: vi.fn() }),
    useCreateBom: () => ({ mutate: vi.fn(), isPending: false }),
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

// @vitest-environment jsdom
/* BOM 独立查询的缓存与失效：staleTime 内不重复请求，createBom 只失效列表，
   台账写操作失效库存余量，BOM 页刷新会重取使用关系。 */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { detailBom, detailInbound } from "../fixtures/recordDetails";
import {
    useBomRefresh,
    useBomStocks,
    useBomUsage,
    useBoms,
    useCreateBom,
    useCreateInbound,
    useWbRefresh,
} from "@/data/queries";

const api = vi.hoisted(() => ({
    fetchBoms: vi.fn(),
    fetchBomCategories: vi.fn(),
    fetchBomStocks: vi.fn(),
    fetchOrders: vi.fn(),
    fetchInboundLedger: vi.fn(),
    fetchOutboundLedger: vi.fn(),
    createBom: vi.fn(),
    createInbound: vi.fn(),
}));
vi.mock("@/api", () => api);

/* 同一用例内多次挂载共享一个 client，才能命中同一份 react-query 缓存 */
function mount<T>(hook: () => T, client: QueryClient): { result: { current: T }; unmount: () => void } {
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(hook, { wrapper });
}

beforeEach(() => {
    vi.clearAllMocks();
    api.fetchBoms.mockResolvedValue([detailBom]);
    api.fetchBomStocks.mockResolvedValue({ [detailBom.code]: 200 });
    api.fetchOrders.mockResolvedValue([]);
    api.fetchInboundLedger.mockResolvedValue([]);
    api.fetchOutboundLedger.mockResolvedValue([]);
});

it("BOM 列表在长 staleTime 内二次挂载命中缓存，不重复请求", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = mount(() => useBoms(), client);
    await waitFor(() => expect(first.result.current.data).toEqual([detailBom]));
    first.unmount();

    const second = mount(() => useBoms(), client);
    expect(second.result.current.data).toEqual([detailBom]);
    expect(api.fetchBoms).toHaveBeenCalledTimes(1);
});

it("新建 BOM 成功后 BOM 列表失效重新拉取", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const list = mount(() => useBoms(), client);
    await waitFor(() => expect(list.result.current.data).toEqual([detailBom]));
    list.unmount();

    api.createBom.mockResolvedValue({ ...detailBom, code: "KW043" });
    const mutation = mount(() => useCreateBom(), client);
    await act(() => mutation.result.current.mutateAsync({ name: detailBom.name, materialItemIds: ["3101", "3103"] }));
    mutation.unmount();

    const refreshed = mount(() => useBoms(), client);
    await waitFor(() => expect(api.fetchBoms).toHaveBeenCalledTimes(2));
    expect(refreshed.result.current.data).toEqual([detailBom]);
});

it("台账写操作（登记入库）成功后库存余量失效，重新挂载时重新拉取", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stocks = mount(() => useBomStocks(), client);
    await waitFor(() => expect(stocks.result.current.data).toEqual({ [detailBom.code]: 200 }));
    stocks.unmount();

    api.createInbound.mockResolvedValue(detailInbound);
    const mutation = mount(() => useCreateInbound(), client);
    await act(() =>
        mutation.result.current.mutateAsync({
            bomCode: detailBom.code,
            qty: 50,
            date: "2026-09-14",
            remark: "",
        }),
    );
    mutation.unmount();

    const refreshed = mount(() => useBomStocks(), client);
    await waitFor(() => {
        expect(api.fetchBomStocks).toHaveBeenCalledTimes(2);
        expect(refreshed.result.current.data).toEqual({ [detailBom.code]: 200 });
    });
});

it("BOM 页刷新同时重取订单及成品出入库引用", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const usage = mount(() => useBomUsage(), client);
    await waitFor(() =>
        expect(usage.result.current.data).toEqual({ orders: [], inboundLedger: [], outboundLedger: [] }),
    );
    expect(api.fetchOrders).toHaveBeenCalledTimes(1);
    expect(api.fetchInboundLedger).toHaveBeenCalledTimes(1);
    expect(api.fetchOutboundLedger).toHaveBeenCalledTimes(1);

    const refresh = mount(() => useBomRefresh(), client);
    act(() => refresh.result.current.refresh());
    await waitFor(() => {
        expect(api.fetchOrders).toHaveBeenCalledTimes(2);
        expect(api.fetchInboundLedger).toHaveBeenCalledTimes(2);
        expect(api.fetchOutboundLedger).toHaveBeenCalledTimes(2);
    });
});

it("全局刷新失效挂载中的业务查询并立即重新请求，长 staleTime 缓存也不例外", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const list = mount(() => useBoms(), client);
    await waitFor(() => expect(list.result.current.data).toEqual([detailBom]));
    expect(api.fetchBoms).toHaveBeenCalledTimes(1);

    const refresh = mount(() => useWbRefresh(), client);
    expect(refresh.result.current.refreshing).toBe(false);
    act(() => refresh.result.current.refresh());
    // useBoms 仍在挂载中：invalidate 立刻触发重新请求，而不是等 staleTime 过期
    await waitFor(() => expect(api.fetchBoms).toHaveBeenCalledTimes(2));
});

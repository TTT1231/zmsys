import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GrantMap, RoleId } from "./permissions";
import type { Snapshot, UpdateCustomerInput, UpdateUserInput } from "@/api";
import { useApp } from "@/context/AppContext";
import {
    cancelOrder,
    createBom,
    createCustomer,
    createInbound,
    createOrder,
    createOutbound,
    createStockAdjustment,
    createUser,
    deleteBom,
    deleteOrder as deleteOrderReq,
    emergencyVoidOutbound,
    fetchBomCategories,
    fetchBoms,
    fetchBomStocks,
    fetchCustomerOwnerOptions,
    fetchCustomers,
    fetchGrantLog,
    fetchGrants,
    fetchInboundLedger,
    fetchOrders,
    fetchOutboundLedger,
    fetchStockAdjustments,
    fetchUsers,
    printOutboundDocument,
    resetUserPassword as resetUserPasswordReq,
    saveRoleGrants,
    setUserActive as setUserActiveReq,
    updateCustomer as updateCustomerReq,
    updateInbound,
    updateOrder as updateOrderReq,
    updateUser as updateUserReq,
    voidInbound,
    voidOutbound,
} from "@/api";

export const wbKeys = {
    all: ["wb"] as const,
    grants: ["roles", "grants"] as const,
    grantLog: ["roles", "grants", "log"] as const,
};

/* BOM 慢变主数据独立缓存：列表页/选择器只拉所需接口，不再等聚合快照 */
export const bomKeys = {
    all: ["boms"] as const,
    list: ["boms", "list"] as const,
    categories: ["boms", "categories"] as const,
    stocks: ["boms", "stocks"] as const,
};

/** BOM 与品类目录变化频率低，放宽 staleTime 到 5 分钟；写操作后仍精准失效 */
const BOM_STALE_MS = 5 * 60_000;

export function useBoms() {
    return useQuery({ queryKey: bomKeys.list, queryFn: fetchBoms, staleTime: BOM_STALE_MS });
}

export function useBomCategories() {
    return useQuery({
        queryKey: bomKeys.categories,
        queryFn: fetchBomCategories,
        staleTime: BOM_STALE_MS,
    });
}

/** 库存余量随台账写操作实时变化：staleTime 沿用全局 30s，台账 mutation 后主动失效 */
export function useBomStocks() {
    return useQuery({ queryKey: bomKeys.stocks, queryFn: fetchBomStocks });
}

/** 刷新 BOM 域三个查询；页面本地筛选/分页不受影响 */
export function useBomRefresh() {
    const queryClient = useQueryClient();
    return { refresh: () => void queryClient.invalidateQueries({ queryKey: bomKeys.all }) };
}

/** 订单列表独立查询：BOM 页据此判断档案是否被订单引用（引用关系低频变化，挂载即取） */
export function useOrders() {
    return useQuery({ queryKey: ["orders", "list"], queryFn: fetchOrders });
}

/* 过渡实现：并发拉取当前完整计算窗口；库存按有效入库 + 库存调整 − 有效出库推导。
 * 真实后端启用分页前必须先提供工作台聚合端点，不能用分页局部数据计算全局库存。 */
async function fetchWbSnapshot(includeCustomers: boolean, includeUsers: boolean): Promise<Snapshot> {
    const [
        orders,
        boms,
        bomCategories,
        customers,
        inboundLedger,
        outboundLedger,
        stockAdjustments,
        users,
        customerOwnerOptions,
    ] = await Promise.all([
        fetchOrders(),
        fetchBoms(),
        fetchBomCategories(),
        includeCustomers ? fetchCustomers() : Promise.resolve([]),
        fetchInboundLedger(),
        fetchOutboundLedger(),
        fetchStockAdjustments(),
        includeUsers ? fetchUsers() : Promise.resolve([]),
        includeCustomers ? fetchCustomerOwnerOptions() : Promise.resolve([]),
    ]);
    const stock: Record<string, number> = {};
    inboundLedger
        .filter(row => row.status === "active")
        .forEach(row => {
            stock[row.bomCode] = (stock[row.bomCode] ?? 0) + row.qty;
        });
    stockAdjustments.forEach(row => {
        stock[row.bomCode] = (stock[row.bomCode] ?? 0) + row.qtyDelta;
    });
    outboundLedger
        .filter(row => row.state !== "voided")
        .forEach(row => {
            stock[row.bomCode] = (stock[row.bomCode] ?? 0) - row.qty;
        });
    return {
        version: Date.now(),
        orders,
        boms,
        bomCategories,
        customers,
        inboundLedger,
        outboundLedger,
        stockAdjustments,
        stock,
        users,
        customerOwnerOptions,
    };
}

export function useWbSnapshot() {
    const { can } = useApp();
    const includeCustomers = can("customers:view");
    const includeUsers = can("permissions:view");
    return useQuery({
        queryKey: [...wbKeys.all, { includeCustomers, includeUsers }],
        queryFn: () => fetchWbSnapshot(includeCustomers, includeUsers),
    });
}

/** 刷新快照:refetch 同一 query(全站共享,一处刷新全局生效)。
 *  保留页面本地筛选/页码——与「重置」(清筛选)职责分离 */
export function useWbRefresh() {
    const { refetch, isFetching } = useWbSnapshot();
    return { refresh: () => void refetch(), refreshing: isFetching };
}

function useWbMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: wbKeys.all });
            queryClient.invalidateQueries({ queryKey: bomKeys.stocks });
        },
    });
}

export const useCreateOrder = () => useWbMutation(createOrder);
export const useCancelOrder = () =>
    useWbMutation((input: { orderNo: string; expectedVersion: number; reason: string }) => {
        const { orderNo, ...body } = input;
        return cancelOrder(orderNo, body);
    });
export const useDeleteOrder = () =>
    useWbMutation((input: { orderNo: string; expectedVersion: number }) => {
        const { orderNo, ...body } = input;
        return deleteOrderReq(orderNo, body);
    });

/* 页面沿用旧签名 {orderNo, ...变更}，此处拆参适配契约 PUT /orders/:orderNo */
export const useUpdateOrder = () =>
    useWbMutation(
        (input: { orderNo: string; expectedVersion: number; qty?: number; deliverDate?: string; remark?: string }) => {
            const { orderNo, ...body } = input;
            return updateOrderReq(orderNo, body);
        },
    );

export const useCreateCustomer = () => useWbMutation(createCustomer);
export const useUpdateCustomer = () =>
    useWbMutation((input: { code: string } & UpdateCustomerInput) => updateCustomerReq(input.code, input));
/** 新建 BOM 只失效 BOM 列表与聚合快照；不动随台账变化的库存余量 */
export const useCreateBom = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: createBom,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: bomKeys.list });
            queryClient.invalidateQueries({ queryKey: wbKeys.all });
        },
    });
};
/** 删除 BOM 仅超级管理员可用；同新建只失效 BOM 列表与聚合快照 */
export const useDeleteBom = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: deleteBom,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: bomKeys.list });
            queryClient.invalidateQueries({ queryKey: wbKeys.all });
        },
    });
};
export const useCreateInbound = () => useWbMutation(createInbound);
export const useUpdateInbound = () =>
    useWbMutation((input: { no: string } & Parameters<typeof updateInbound>[1]) => {
        const { no, ...body } = input;
        return updateInbound(no, body);
    });
export const useVoidInbound = () =>
    useWbMutation((input: { no: string; expectedVersion: number; reason: string }) =>
        voidInbound(input.no, { expectedVersion: input.expectedVersion, reason: input.reason }),
    );
export const useCreateStockAdjustment = () => useWbMutation(createStockAdjustment);
export const useCreateOutbound = () => useWbMutation(createOutbound);
export const useVoidOutbound = () =>
    useWbMutation((input: { no: string; expectedVersion: number; reason: string }) =>
        voidOutbound(input.no, { expectedVersion: input.expectedVersion, reason: input.reason }),
    );
export const usePrintOutbound = () =>
    useWbMutation((input: { no: string; expectedVersion: number; reason?: string }) =>
        printOutboundDocument(input.no, { expectedVersion: input.expectedVersion, reason: input.reason }),
    );
export const useEmergencyVoidOutbound = () =>
    useWbMutation((input: { no: string; expectedVersion: number; reason: string }) =>
        emergencyVoidOutbound(input.no, {
            expectedVersion: input.expectedVersion,
            reason: input.reason,
            goodsNotDeparted: true,
            paperInvalidated: true,
        }),
    );
export const useCreateUser = () => useWbMutation(createUser);

export const useUpdateUser = () =>
    useWbMutation((input: { account: string } & UpdateUserInput) => {
        const { account, ...body } = input;
        return updateUserReq(account, body);
    });

export const useSetUserActive = () =>
    useWbMutation((input: { account: string } & Parameters<typeof setUserActiveReq>[1]) => {
        const { account, ...body } = input;
        return setUserActiveReq(account, body);
    });

export const useResetUserPassword = () =>
    useWbMutation((input: { account: string } & Parameters<typeof resetUserPasswordReq>[1]) => {
        const { account, ...body } = input;
        return resetUserPasswordReq(account, body);
    });

/* ---- 用户与权限 ---- */

export function useGrants() {
    return useQuery({ queryKey: wbKeys.grants, queryFn: fetchGrants });
}

export function useGrantLog() {
    return useQuery({ queryKey: wbKeys.grantLog, queryFn: fetchGrantLog });
}

/** 保存单角色授权：成功后同时失效聚合快照与授权日志 */
export function useSaveGrants() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: { roleId: RoleId; grant: GrantMap[RoleId]; note: string }) =>
            saveRoleGrants(input.roleId, {
                grant: input.grant,
                expectedVersion: input.grant.version,
                note: input.note,
            }),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: wbKeys.grants });
            queryClient.invalidateQueries({ queryKey: wbKeys.grantLog });
            queryClient.invalidateQueries({ queryKey: wbKeys.all });
            void variables; // roleId：如影响当前登录角色，调用方负责 refreshProfile
        },
    });
}

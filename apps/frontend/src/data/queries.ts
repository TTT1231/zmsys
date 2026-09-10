import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GrantMap, RoleId } from "./permissions";
import type { Snapshot, UpdateCustomerInput } from "@/api";
import {
    createBom,
    createCustomer,
    createInbound,
    createOrder,
    createOutbound,
    createUser,
    fetchBoms,
    fetchCustomers,
    fetchGrantLog,
    fetchGrants,
    fetchInboundLedger,
    fetchOrders,
    fetchOutboundLedger,
    fetchUsers,
    saveRoleGrants,
    setUserActive as setUserActiveReq,
    updateCustomer as updateCustomerReq,
    updateOrder as updateOrderReq,
    updateUser as updateUserReq,
} from "@/api";

export const wbKeys = {
    all: ["wb"] as const,
    grants: ["roles", "grants"] as const,
    grantLog: ["roles", "grants", "log"] as const,
};

/* 过渡实现：原 src/api/snapshot.ts 聚合逻辑内联于此，工作台与数据层后续统一重构。
 * 并发拉取各资源端点；库存由出入库台账推导（Σ入库 − Σ出库）。 */
async function fetchWbSnapshot(): Promise<Snapshot> {
    const [orders, boms, customers, inboundLedger, outboundLedger, users] = await Promise.all([
        fetchOrders(),
        fetchBoms(),
        fetchCustomers(),
        fetchInboundLedger(),
        fetchOutboundLedger(),
        fetchUsers(),
    ]);
    const stock: Record<string, number> = {};
    inboundLedger.forEach(row => {
        stock[row.bomCode] = (stock[row.bomCode] ?? 0) + row.qty;
    });
    outboundLedger.forEach(row => {
        stock[row.bomCode] = Math.max(0, (stock[row.bomCode] ?? 0) - row.qty);
    });
    return {
        version: Date.now(),
        orders,
        boms,
        customers,
        inboundLedger,
        outboundLedger,
        stock,
        users,
    };
}

export function useWbSnapshot() {
    return useQuery({ queryKey: wbKeys.all, queryFn: fetchWbSnapshot });
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
        onSuccess: () => queryClient.invalidateQueries({ queryKey: wbKeys.all }),
    });
}

export const useCreateOrder = () => useWbMutation(createOrder);

/* 页面沿用旧签名 {orderNo, ...变更}，此处拆参适配契约 PUT /orders/:orderNo */
export const useUpdateOrder = () =>
    useWbMutation(
        (input: {
            orderNo: string;
            qty?: number;
            deliverStart?: string;
            deliverEnd?: string;
            remark?: string;
            reason?: string;
        }) => {
            const { orderNo, ...body } = input;
            return updateOrderReq(orderNo, body);
        },
    );

export const useCreateCustomer = () => useWbMutation(createCustomer);
export const useUpdateCustomer = () =>
    useWbMutation((input: { code: string } & UpdateCustomerInput) => updateCustomerReq(input.code, input));
export const useCreateBom = () => useWbMutation(createBom);
export const useCreateInbound = () => useWbMutation(createInbound);
export const useCreateOutbound = () => useWbMutation(createOutbound);
export const useCreateUser = () => useWbMutation(createUser);

export const useUpdateUser = () =>
    useWbMutation((input: { account: string; name: string; role: RoleId }) => updateUserReq(input.account, input));

export const useSetUserActive = () =>
    useWbMutation((input: { account: string; active: boolean }) => setUserActiveReq(input.account, input.active));

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
            saveRoleGrants(input.roleId, input),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: wbKeys.grants });
            queryClient.invalidateQueries({ queryKey: wbKeys.grantLog });
            queryClient.invalidateQueries({ queryKey: wbKeys.all });
            void variables; // roleId：如影响当前登录角色，调用方负责 refreshProfile
        },
    });
}

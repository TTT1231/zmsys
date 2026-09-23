/* api 出口（barrel）：业务层一律从 "@/api" 导入，类型同样走本桶；本文件只做 re-export。 */
export type * from "./types";
export { login, logout, fetchProfile, changePassword } from "./auth";
export { fetchOrders, createOrder, updateOrder, cancelOrder, archiveOrder, deleteOrder } from "./orders";
export { fetchCustomers, createCustomer, updateCustomer, fetchCustomerPhone } from "./customers";
export { fetchBoms, fetchBomCategories, fetchBomStocks, fetchBomStockLedger, createBom, deleteBom } from "./boms";
export {
    fetchInboundLedger,
    createInbound,
    updateInbound,
    voidInbound,
    fetchStockAdjustments,
    createStockAdjustment,
} from "./inbound";
export {
    fetchOutboundLedger,
    createOutbound,
    voidOutbound,
    printOutboundDocument,
    emergencyVoidOutbound,
} from "./outbound";
export {
    fetchUsers,
    fetchCustomerOwnerOptions,
    createUser,
    updateUser,
    setUserActive,
    resetUserPassword,
} from "./users";
export { fetchRoles, fetchGrants, saveRoleGrants, fetchGrantLog } from "./permissions";

/* api 出口（barrel）：业务层一律从 "@/api" 导入，类型同样走本桶。
 * 本文件只做 re-export，不放任何业务逻辑（聚合见 ./snapshot.ts）。 */
export type * from "./types";
export { login, logout, fetchProfile, updateProfile, changePassword } from "./auth";
export { fetchOrders, createOrder, updateOrder } from "./orders";
export { fetchCustomers, createCustomer, updateCustomer } from "./customers";
export { fetchBoms, createBom } from "./boms";
export { fetchInboundLedger, createInbound } from "./inbound";
export { fetchOutboundLedger, createOutbound } from "./outbound";
export { fetchUsers, createUser, updateUser, setUserActive } from "./users";
export { fetchRoles, fetchGrants, saveRoleGrants, fetchGrantLog } from "./permissions";

import type {
    CreateUserInput,
    CustomerOwnerOption,
    ResetUserPasswordInput,
    SetUserStatusInput,
    UpdateUserInput,
    WbUser,
} from "./types";
import { requestClient } from "@/http";
import { idempotencyConfig } from "./idempotency";

export function fetchUsers(): Promise<WbUser[]> {
    return requestClient.get<WbUser[]>("/users");
}

export function fetchCustomerOwnerOptions(): Promise<CustomerOwnerOption[]> {
    return requestClient.get<CustomerOwnerOption[]>("/customer-owner-options");
}

export function createUser(input: CreateUserInput): Promise<WbUser> {
    return requestClient.post<WbUser>("/users", input, idempotencyConfig());
}

/** account 创建后不可改，以 account 定位用户 */
export function updateUser(account: string, input: UpdateUserInput): Promise<WbUser> {
    return requestClient.put<WbUser>(`/users/${account}`, input);
}

export function setUserActive(account: string, input: SetUserStatusInput): Promise<WbUser> {
    return requestClient.patch<WbUser>(`/users/${account}/status`, input);
}

/** 重置为初始密码 123456；服务端递增 token_version 使对方旧会话失效 */
export function resetUserPassword(account: string, input: ResetUserPasswordInput): Promise<WbUser> {
    return requestClient.post<WbUser>(`/users/${account}/reset-password`, input);
}

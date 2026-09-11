import type { CreateUserInput, CustomerOwnerOption, SetUserStatusInput, UpdateUserInput, WbUser } from "./types";
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

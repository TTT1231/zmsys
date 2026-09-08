import type { CreateUserInput, UpdateUserInput, WbUser } from "./types";
import { requestClient } from "@/http";

export function fetchUsers(): Promise<WbUser[]> {
    return requestClient.get<WbUser[]>("/users");
}

export function createUser(input: CreateUserInput): Promise<WbUser> {
    return requestClient.post<WbUser>("/users", input);
}

/** account 创建后不可改，以 account 定位用户 */
export function updateUser(account: string, input: UpdateUserInput): Promise<WbUser> {
    return requestClient.put<WbUser>(`/users/${account}`, input);
}

export function setUserActive(account: string, active: boolean): Promise<WbUser> {
    return requestClient.patch<WbUser>(`/users/${account}/status`, { active });
}

import type { ChangePasswordInput, LoginInput, LoginResult, ProfileResult } from "./types";
import { clearToken, requestClient, setToken } from "@/http";

export async function login(input: LoginInput): Promise<LoginResult> {
    const result = await requestClient.post<LoginResult>("/auth/login", input);
    setToken(result.accessToken);
    return result;
}

export async function logout(): Promise<void> {
    try {
        await requestClient.post("/auth/logout");
    } catch {
        // 本地退出必须成功；服务端 token 已失效或网络不可用都不应阻止清理会话。
    } finally {
        clearToken();
    }
}

export function fetchProfile(): Promise<ProfileResult> {
    return requestClient.get<ProfileResult>("/auth/profile");
}

/** 个人中心:修改自己的密码(旧密码校验,新密码 ≥6 位;不强制);姓名等资料由管理员在用户权限页维护 */
export function changePassword(input: ChangePasswordInput): Promise<null> {
    return requestClient.put<null>("/auth/password", input);
}

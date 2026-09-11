import type { ChangePasswordInput, LoginInput, LoginResult, ProfileResult, WbUser } from "./types";
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

/** 个人中心:更新自己的姓名(账号/角色/状态为管理员域,不可自行修改) */
export function updateProfile(input: { name: string }): Promise<WbUser> {
    return requestClient.put<WbUser>("/auth/profile", input);
}

/** 个人中心:修改自己的密码(旧密码校验,新密码 ≥6 位;不强制) */
export function changePassword(input: ChangePasswordInput): Promise<null> {
    return requestClient.put<null>("/auth/password", input);
}

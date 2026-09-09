import type { LoginInput, LoginResult, ProfileResult, WbUser } from "./types";
import { clearToken, requestClient, setToken } from "@/http";

export async function login(input: LoginInput): Promise<LoginResult> {
    const result = await requestClient.post<LoginResult>("/auth/login", input);
    setToken(result.accessToken);
    return result;
}

export async function logout(): Promise<void> {
    try {
        await requestClient.post("/auth/logout");
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

import type { LoginInput, LoginResult, ProfileResult } from "./types";
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

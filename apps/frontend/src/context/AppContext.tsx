import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProfileResult, WbUser } from "@/api";
import { fetchProfile, login as loginRequest, logout as logoutRequest } from "@/api";
import { getToken } from "@/lib/token";
import { can as checkPerm, type PermCode, type RoleGrant } from "@/data/permissions";
import { AppContext, EMPTY_GRANT, type AuthStatus, type Role } from "./useApp";

/* 此文件只导出 AppProvider 组件;useApp/ROLE_META 等非组件导出在 ./useApp.ts */

export function AppProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<AuthStatus>(() => (getToken() ? "loading" : "guest"));
    const [user, setUser] = useState<WbUser | null>(null);
    const [grant, setGrant] = useState<RoleGrant>(EMPTY_GRANT);
    const [globalSearch, setGlobalSearch] = useState("");

    const applyProfile = useCallback((profile: ProfileResult) => {
        setUser(profile.user);
        setGrant(profile.grant);
        setStatus("authenticated");
    }, []);

    // 启动：本地 token 有效则恢复会话，否则停留 guest（由路由守卫送去登录页）
    useEffect(() => {
        if (!getToken()) return;
        let cancelled = false;
        fetchProfile()
            .then(profile => {
                if (!cancelled) applyProfile(profile);
            })
            .catch(() => {
                if (!cancelled) setStatus("guest");
            });
        return () => {
            cancelled = true;
        };
    }, [applyProfile]);

    const login = useCallback(
        async (account: string, password: string) => {
            await loginRequest({ account, password });
            const profile = await fetchProfile();
            applyProfile(profile);
            return profile.user;
        },
        [applyProfile],
    );

    const logout = useCallback(async () => {
        try {
            await logoutRequest();
        } catch {
            // 退出以本地会话清理为准；token 已失效或网络失败都不能把用户困在登录态。
        } finally {
            setUser(null);
            setGrant(EMPTY_GRANT);
            setStatus("guest");
        }
    }, []);

    const refreshProfile = useCallback(async () => {
        if (!getToken()) return;
        applyProfile(await fetchProfile());
    }, [applyProfile]);

    const role: Role = user?.role ?? "admin";
    const can = useCallback((perm: PermCode) => checkPerm(grant, perm), [grant]);

    const value = useMemo(
        () => ({
            status,
            user,
            role,
            globalSearch,
            setGlobalSearch,
            grant,
            can,
            login,
            logout,
            refreshProfile,
        }),
        [status, user, role, globalSearch, grant, can, login, logout, refreshProfile],
    );
    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

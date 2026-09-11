import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProfileResult, WbUser } from "@/api";
import { fetchProfile, login as loginRequest, logout as logoutRequest } from "@/api";
import { getToken } from "@/http";
import { can as checkPerm, type PermCode, type RoleGrant, type RoleId } from "@/data/permissions";

export type Role = RoleId;

/** 各角色工作台的标题与角色名（用户身份来自登录用户，不再硬编码人员） */
export const ROLE_META: Record<Role, { label: string; roleName: string }> = {
    super: { label: "超级管理员工作台", roleName: "超级管理员" },
    admin: { label: "管理员工作台", roleName: "管理员" },
    sales: { label: "销售工作台", roleName: "销售" },
    warehouse: { label: "仓管工作台", roleName: "仓管" },
    staff: { label: "员工工作台", roleName: "员工" },
};

const EMPTY_GRANT: RoleGrant = { version: 0, menus: [], actions: {} };

export type AuthStatus = "loading" | "authenticated" | "guest";

interface AppState {
    /** loading = 启动时校验本地 token 中 */
    status: AuthStatus;
    user: WbUser | null;
    /** 登录用户的角色（侧边栏/工作台标题等既有用法保持不变） */
    role: Role;
    globalSearch: string;
    setGlobalSearch: (value: string) => void;
    /** 当前角色的授权（含菜单与操作权限码），由 /auth/profile 下发 */
    grant: RoleGrant;
    /** 权限码判断：can("outbound:print") */
    can: (perm: PermCode) => boolean;
    /** 登录成功后建立会话并返回登录用户（供欢迎提示等使用）；失败抛出带 message 的错误供登录页展示 */
    login: (account: string, password: string) => Promise<WbUser | null>;
    logout: () => Promise<void>;
    /** 重新拉取 /auth/profile（角色授权变更后刷新自身权限） */
    refreshProfile: () => Promise<void>;
}

const AppContext = createContext<AppState>({
    status: "guest",
    user: null,
    role: "admin",
    globalSearch: "",
    setGlobalSearch: () => {},
    grant: EMPTY_GRANT,
    can: () => false,
    login: async () => null,
    logout: async () => {},
    refreshProfile: async () => {},
});

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

export const useApp = () => useContext(AppContext);

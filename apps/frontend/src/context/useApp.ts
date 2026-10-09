import { createContext, useContext } from "react";
import type { ProfileResult, WbUser } from "@/api";
import { type PermCode, type RoleGrant, type RoleId } from "@/data/permissions";

/* 认证上下文的非组件部分（context 对象、hook、角色元数据）单独成文件，
   避免与 AppProvider 混在一个文件导出而破坏 React Fast Refresh */

export type Role = RoleId;

/** 各角色工作台的标题与角色名（用户身份来自登录用户，不再硬编码人员） */
export const ROLE_META: Record<Role, { label: string; roleName: string }> = {
    super: { label: "超级管理员工作台", roleName: "超级管理员" },
    admin: { label: "管理员工作台", roleName: "管理员" },
    sales: { label: "销售工作台", roleName: "销售" },
    warehouse: { label: "仓管工作台", roleName: "仓管" },
    staff: { label: "员工工作台", roleName: "员工" },
};

export const EMPTY_GRANT: RoleGrant = { version: 0, menus: [], actions: {} };

export type AuthStatus = "loading" | "authenticated" | "guest";

interface AppState {
    /** loading = 启动时校验本地 token 中 */
    status: AuthStatus;
    user: WbUser | null;
    /** 登录用户的角色（侧边栏/工作台标题等既有用法保持不变） */
    role: Role;
    /** 当前角色的授权（含菜单与操作权限码），由 /auth/profile 下发 */
    grant: RoleGrant;
    /** 权限码判断：can("outbound:ship") */
    can: (perm: PermCode) => boolean;
    /** 登录成功后建立会话并返回完整 profile（用户 + 授权：欢迎提示用 user，落地页用 grant）；失败抛出带 message 的错误供登录页展示 */
    login: (account: string, password: string) => Promise<ProfileResult>;
    logout: () => Promise<void>;
    /** 重新拉取 /auth/profile（角色授权变更后刷新自身权限） */
    refreshProfile: () => Promise<void>;
}

export const AppContext = createContext<AppState>({
    status: "guest",
    user: null,
    role: "admin",
    grant: EMPTY_GRANT,
    can: () => false,
    login: async () => ({ user: {} as WbUser, grant: EMPTY_GRANT }),
    logout: async () => {},
    refreshProfile: async () => {},
});

export const useApp = () => useContext(AppContext);

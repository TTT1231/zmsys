import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  can as checkPerm,
  getGrants,
  grantFor,
  ROLE_IDS,
  subscribeGrants,
  type PermCode,
  type RoleGrant,
  type RoleId,
} from "../data/permissions";

export type Role = RoleId;

const ROLE_KEY = "zm-role";

export const ROLE_META: Record<Role, { label: string; person: string; initial: string; roleName: string }> = {
  super: { label: "超级管理员工作台", person: "系统管理员", initial: "系", roleName: "超级管理员" },
  admin: { label: "管理员工作台", person: "李晓梅", initial: "李", roleName: "管理员" },
  sales: { label: "销售工作台", person: "陈洁", initial: "陈", roleName: "销售" },
  warehouse: { label: "仓管工作台", person: "周丽", initial: "周", roleName: "仓管" },
  staff: { label: "员工工作台", person: "刘敏", initial: "刘", roleName: "员工" },
};

interface AppState {
  role: Role;
  setRole: (role: Role) => void;
  globalSearch: string;
  setGlobalSearch: (value: string) => void;
  /** 当前角色的授权（含菜单与操作权限码） */
  grant: RoleGrant;
  /** 权限码判断：can("outbound:print") */
  can: (perm: PermCode) => boolean;
}

const AppContext = createContext<AppState>({
  role: "admin",
  setRole: () => {},
  globalSearch: "",
  setGlobalSearch: () => {},
  grant: grantFor(getGrants(), "admin"),
  can: () => false,
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => {
    const saved = localStorage.getItem(ROLE_KEY);
    return saved && (ROLE_IDS as string[]).includes(saved) ? (saved as Role) : "admin";
  });
  const setRole = useCallback((next: Role) => {
    setRoleState(next);
    try {
      localStorage.setItem(ROLE_KEY, next);
    } catch {
      // 存储失败仅影响下次进入的默认角色
    }
  }, []);
  const [globalSearch, setGlobalSearch] = useState("");
  const grants = useSyncExternalStore(subscribeGrants, getGrants);
  const grant = useMemo(() => grantFor(grants, role), [grants, role]);
  const can = useCallback((perm: PermCode) => checkPerm(grant, perm), [grant]);
  const value = useMemo(
    () => ({ role, setRole, globalSearch, setGlobalSearch, grant, can }),
    [role, globalSearch, grant, can],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);

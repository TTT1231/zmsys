import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Role = "admin" | "sales" | "warehouse";

export const ROLE_META: Record<Role, { label: string; person: string; initial: string; roleName: string }> = {
  admin: { label: "管理员工作台", person: "李晓梅", initial: "李", roleName: "管理员" },
  sales: { label: "销售工作台", person: "陈洁", initial: "陈", roleName: "销售" },
  warehouse: { label: "仓管工作台", person: "周丽", initial: "周", roleName: "仓管" },
};

interface AppState {
  role: Role;
  setRole: (role: Role) => void;
  globalSearch: string;
  setGlobalSearch: (value: string) => void;
}

const AppContext = createContext<AppState>({
  role: "admin",
  setRole: () => {},
  globalSearch: "",
  setGlobalSearch: () => {},
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("admin");
  const [globalSearch, setGlobalSearch] = useState("");
  const value = useMemo(() => ({ role, setRole, globalSearch, setGlobalSearch }), [role, globalSearch]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);

import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { Icon } from "../../lib/icons";
import { useApp, ROLE_META, type Role } from "../../context/AppContext";
import { buildNavSections, type NavItem } from "../../data/permissions";
import { NoteDialog } from "../../pages/workbench/dialogs";

/* 侧边栏导航：由「角色 + 授权」生成（见 data/permissions.ts） */
function useNavSections(): Array<{ group: string; items: NavItem[] }> {
  const { role, grant } = useApp();
  return buildNavSections(role, grant);
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  open,
  onClose,
}: SidebarProps) {
  const navigate = useNavigate();
  const [desktop, setDesktop] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const location = useLocation();
  const { role } = useApp();
  const isWorkbench = location.pathname.startsWith("/workbench");
  const sections = useNavSections();
  const [note, setNote] = useState<{
    title: string;
    description: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <>
      <aside
        aria-label="主导航"
        inert={!desktop && !open}
        className={`fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden bg-gradient-to-b from-[#101828] to-[#162033] transition-[width,transform] duration-200 lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${
          collapsed ? "lg:w-[76px]" : "lg:w-[230px]"
        } w-[min(82vw,300px)] shadow-[8px_0_30px_rgba(16,24,40,.08)] lg:shadow-[8px_0_30px_rgba(16,24,40,.08)] ${
          open ? "translate-x-0" : "-translate-x-[103%] lg:translate-x-0"
        }`}
      >
        <div className="relative px-4 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-[#6366f1] to-[#4f46e5] text-white shadow-[0_6px_18px_rgba(79,70,229,.45)]">
              <Icon name="brand" size={17} />
            </span>
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-[14.5px] font-semibold text-white">
                  智造管理系统
                </span>
                {isWorkbench && (
                  <span className="block text-[10px] tracking-[0.14em] text-[#aeb8c8] uppercase">
                    Z · M Manager
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        {isWorkbench && !collapsed && (
          <div className="mx-3 mb-3 rounded-[12px] border border-white/10 bg-white/[.06] px-3 py-2.5">
            <div className="text-[10.5px] tracking-[0.06em] text-[#aeb8c8]">
              当前角色工作区
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-[#818cf8]" />
              {ROLE_META[role].roleName}
            </div>
          </div>
        )}

        <div className="px-4 pb-3 lg:hidden">
          <label className="text-[12px] text-white">
            角色工作区
            <select
              aria-label="切换角色"
              value={role}
              onChange={(event) => {
                navigate(`/workbench/${event.target.value}`);
                onClose();
              }}
              className="mt-1 min-h-11 w-full rounded-btn bg-white px-3 text-ink"
            >
              {(Object.keys(ROLE_META) as Role[]).map((key) => (
                <option key={key} value={key}>
                  {ROLE_META[key].label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
          {sections.map((section) => (
            <div key={section.group}>
              {!collapsed && isWorkbench && (
                <div className="px-2.5 pt-3 pb-1.5 text-[10.5px] font-semibold tracking-[0.1em] text-[#7a8699] uppercase">
                  {section.group}
                </div>
              )}
              {collapsed && (
                <div className="mx-2 my-2 border-t border-white/8" />
              )}
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) =>
                  item.note ? (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setNote({ title: item.label, description: item.note! });
                        onClose();
                      }}
                      title={collapsed ? item.label : undefined}
                      className={`group relative flex min-h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-[13px] text-[#aeb8c8] transition hover:bg-white/[.06] hover:text-white ${collapsed ? "justify-center" : ""}`}
                    >
                      <Icon name={item.icon} size={19} className="shrink-0" />
                      {!collapsed && (
                        <span className="min-w-0 flex-1 truncate text-left">
                          {item.label}
                        </span>
                      )}
                      {!collapsed && item.tag && isWorkbench && (
                        <span className="rounded-full bg-[rgba(99,102,241,.18)] px-1.5 py-px text-[10px] font-medium whitespace-nowrap text-[#c7d2fe]">
                          {item.tag}
                        </span>
                      )}
                    </button>
                  ) : (
                    <NavLink
                      key={item.to}
                      to={item.to!}
                      end={item.end}
                      onClick={onClose}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        `group relative flex min-h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-[13px] transition ${
                          isActive
                            ? "bg-gradient-to-r from-[rgba(99,102,241,.30)] to-[rgba(79,70,229,.16)] font-semibold text-white shadow-[inset_3px_0_0_0_#818cf8]"
                            : "text-[#aeb8c8] hover:bg-white/[.06] hover:text-white"
                        } ${collapsed ? "justify-center" : ""}`
                      }
                    >
                      <Icon name={item.icon} size={19} className="shrink-0" />
                      {!collapsed && (
                        <span className="min-w-0 flex-1 truncate">
                          {item.label}
                        </span>
                      )}
                      {!collapsed && item.tag && isWorkbench && (
                        <span className="rounded-full bg-[rgba(99,102,241,.18)] px-1.5 py-px text-[10px] font-medium whitespace-nowrap text-[#c7d2fe]">
                          {item.tag}
                        </span>
                      )}
                    </NavLink>
                  ),
                )}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* 折叠开关（桌面端左缘悬浮） */}
      <button
        type="button"
        aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
        onClick={onToggleCollapse}
        className="fixed top-[74px] z-40 hidden h-7 w-7 items-center justify-center rounded-full border border-line bg-white text-muted shadow-xs transition hover:text-primary lg:flex"
        style={{ left: collapsed ? 62 : 216 }}
      >
        <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={14} />
      </button>

      {/* 移动端遮罩 */}
      {open && (
        <button
          type="button"
          aria-label="关闭主导航"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-[rgba(15,23,42,.48)] backdrop-blur-[2px] lg:hidden"
        />
      )}

      <NoteDialog note={note} onClose={() => setNote(null)} />
    </>
  );
}

/* 移动端底部导航：中间入口按菜单授权过滤（客户档案等未授权模块不可达） */
export function MobileBottomNav({
  onOpenDrawer,
}: {
  onOpenDrawer: () => void;
}) {
  const { role, grant } = useApp();
  const centerItems = [
    { key: "orders", label: role === "warehouse" ? "待发货" : "订单", icon: "order", to: "/orders" },
    { key: "customers", label: "客户", icon: "users", to: "/customers" },
    { key: "inbound", label: "入库", icon: "inbound", to: "/inbound" },
    { key: "outbound", label: "出库", icon: "truck", to: "/outbound" },
  ]
    .filter((item) => grant.menus.includes(item.key))
    .slice(0, 3);

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    `flex flex-col items-center justify-center gap-0.5 text-[10.5px] transition ${
      isActive ? "bg-primary-soft font-semibold text-primary" : "text-muted"
    }`;

  return (
    <nav
      aria-label="移动导航"
      className="fixed inset-x-0 bottom-0 z-40 grid min-h-[64px] border-t border-line bg-white/90 backdrop-blur-lg lg:hidden"
      style={{
        gridTemplateColumns: `repeat(${centerItems.length + 2}, minmax(0, 1fr))`,
        paddingBottom: "env(safe-area-inset-bottom)",
        height: "calc(64px + env(safe-area-inset-bottom))",
      }}
    >
      <NavLink to={`/workbench/${role}`} className={itemClass} end>
        <Icon name="grid" size={19} />
        工作台
      </NavLink>
      {centerItems.map((item) => (
        <NavLink key={item.to + item.label} to={item.to} className={itemClass}>
          <Icon name={item.icon} size={19} />
          {item.label}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onOpenDrawer}
        className="flex flex-col items-center justify-center gap-0.5 text-[10.5px] text-muted"
      >
        <Icon name="more" size={19} />
        更多
      </button>
    </nav>
  );
}

/* 顶栏 */
export function Topbar({
  title,
  onOpenDrawer,
}: {
  title: string;
  onOpenDrawer: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { role, setRole } = useApp();
  const isWorkbench = location.pathname.startsWith("/workbench");

  const switchRole = (next: string) => {
    setRole(next as Role);
    navigate(`/workbench/${next}`);
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-line bg-white/88 px-4 backdrop-blur-[18px] saturate-150 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-label="打开主导航"
          onClick={onOpenDrawer}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-line text-ink lg:hidden"
        >
          <Icon name="menu" size={19} />
        </button>
        <strong className="block truncate text-[15px] font-semibold text-ink lg:hidden">
          {title}
        </strong>
        <button
          type="button"
          onClick={() => navigate("/search")}
          className="hidden min-h-11 w-[300px] items-center gap-2 rounded-btn border border-line px-3 text-left text-muted lg:flex"
        >
          <Icon name="search" size={17} /> 搜索订单、客户、产品
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2.5 sm:gap-3">
        <button
          type="button"
          aria-label="全局搜索"
          onClick={() => navigate("/search")}
          className="flex h-11 w-11 items-center justify-center rounded-btn text-muted lg:hidden"
        >
          <Icon name="search" size={20} />
        </button>
        <select
          aria-label="切换角色工作台"
          value={isWorkbench ? `/workbench/${role}` : ""}
          onChange={(event) =>
            event.target.value &&
            switchRole(event.target.value.split("/").pop() as Role)
          }
          className="hidden h-10 rounded-[10px] border border-line bg-white px-2.5 text-[12.5px] text-ink sm:block"
        >
          {isWorkbench ? null : <option value="">角色工作台</option>}
          {(Object.keys(ROLE_META) as Role[]).map((key) => (
            <option key={key} value={`/workbench/${key}`}>
              {ROLE_META[key].label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2.5 py-1.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#4f46e5] text-[13px] font-semibold text-white">
            {ROLE_META[role].initial}
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-[12.5px] font-semibold text-ink">
              {ROLE_META[role].person}
            </span>
            <span className="block text-[11px] text-muted">
              {ROLE_META[role].roleName}
            </span>
          </span>
        </div>
      </div>
    </header>
  );
}

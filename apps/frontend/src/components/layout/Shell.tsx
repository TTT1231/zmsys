import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { Icon } from "@/lib/icons";
import { useApp } from "@/context/useApp";
import { usePreferences } from "@/context/usePreferences";
import { buildNavSections, type NavItem } from "@/data/permissions";
import { useWbRefresh } from "@/data/queries";
import { NoteDialog } from "@/components/ui/NoteDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PreferencesDrawer } from "./PreferencesDrawer";
import { UserMenu } from "./UserMenu";
import { useFullscreen } from "./useFullscreen";
import { useThemeToggle } from "./useThemeToggle";

/* 侧边栏导航：由「登录用户角色 + 授权」生成（见 data/permissions.ts） */
function useNavSections(): Array<{ group: string; items: NavItem[] }> {
    const { role, grant } = useApp();
    return buildNavSections(role, grant);
}

interface SidebarProps {
    collapsed: boolean;
    onToggleCollapse: () => void;
    open: boolean;
    onClose: () => void;
    /** 内容最大化时桌面端宽度过渡到 0（不卸载以保留收起/展开动画） */
    maximized?: boolean;
}

export function Sidebar({ collapsed, onToggleCollapse, open, onClose, maximized = false }: SidebarProps) {
    const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
    useEffect(() => {
        const query = window.matchMedia("(min-width: 1024px)");
        const update = () => setDesktop(query.matches);
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
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
                className={`fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden border-r border-line bg-sidebar transition-[width,transform] duration-300 lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${
                    maximized ? "lg:w-0 lg:border-r-0 lg:shadow-none" : collapsed ? "lg:w-19" : "lg:w-57.5"
                } w-[min(82vw,300px)] shadow-[8px_0_30px_rgba(16,24,40,.08)] lg:shadow-[8px_0_30px_rgba(16,24,40,.08)] ${
                    open ? "translate-x-0" : "-translate-x-[103%] lg:translate-x-0"
                }`}
            >
                <div className="relative px-4 pt-5 pb-4">
                    <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-input bg-linear-to-br from-[var(--color-primary)] to-[var(--color-primary-strong)] text-white shadow-glow">
                            <Icon name="brand" size={17} />
                        </span>
                        {!collapsed && (
                            <span className="min-w-0">
                                <span className="block truncate text-14.5 font-semibold text-ink">智造管理系统</span>
                            </span>
                        )}
                    </div>
                </div>

                <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
                    {sections.map(section => (
                        <div key={section.group}>
                            {collapsed && <div className="mx-2 my-2 border-t border-line" />}
                            <div className="flex flex-col gap-0.5">
                                {section.items.map(item =>
                                    item.note ? (
                                        <button
                                            key={item.label}
                                            type="button"
                                            onClick={() => {
                                                setNote({ title: item.label, description: item.note! });
                                                onClose();
                                            }}
                                            title={collapsed ? item.label : undefined}
                                            className={`group relative flex min-h-10 max-lg:min-h-[44px] items-center gap-2.5 rounded-btn px-2.5 text-14 text-td transition-colors hover:bg-soft ${collapsed ? "justify-center" : ""}`}
                                        >
                                            <Icon
                                                name={item.icon}
                                                size={17}
                                                className="shrink-0 transition-transform duration-200 group-hover:scale-115"
                                            />
                                            {!collapsed && (
                                                <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
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
                                                `group relative flex min-h-10 max-lg:min-h-[44px] items-center gap-2.5 rounded-btn px-2.5 text-14 transition-colors ${
                                                    isActive
                                                        ? "bg-primary-soft font-semibold text-primary-strong"
                                                        : "text-td hover:bg-soft"
                                                } ${collapsed ? "justify-center" : ""}`
                                            }
                                        >
                                            <Icon
                                                name={item.icon}
                                                size={17}
                                                className="shrink-0 transition-transform duration-200 group-hover:scale-115"
                                            />
                                            {!collapsed && (
                                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                            )}
                                        </NavLink>
                                    ),
                                )}
                            </div>
                        </div>
                    ))}
                </nav>
            </aside>

            {/* 折叠开关（桌面端左缘悬浮）。
                left 用 rem 跟随侧栏宽度(lg:w-19/lg:w-57.5):侧栏宽 − 按钮半宽(w-7/2=0.875rem),
                中心恒骑在侧栏右缘上;html 根字号变化(16→14px 迁移)时不再错位。
                内容最大化时随侧栏一起收起(宽度过渡中不遮挡内容) */}
            <button
                type="button"
                aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
                onClick={onToggleCollapse}
                className={`fixed top-18.5 z-40 h-7 w-7 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-xs transition hover:text-primary ${maximized ? "hidden" : "hidden lg:flex"}`}
                style={{ left: collapsed ? "3.875rem" : "13.5rem" }}
            >
                <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={14} />
            </button>

            {/* 移动端遮罩 */}
            {open && (
                <button
                    type="button"
                    aria-label="关闭主导航"
                    onClick={onClose}
                    className="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px] lg:hidden"
                />
            )}

            <NoteDialog note={note} onClose={() => setNote(null)} />
        </>
    );
}

/* 移动端底部导航：中间入口按菜单授权过滤（客户档案等未授权模块不可达） */
export function MobileBottomNav({ onOpenDrawer }: { onOpenDrawer: () => void }) {
    const { role, grant } = useApp();
    const centerItems = [
        { key: "orders", label: role === "warehouse" ? "待发货" : "订单", icon: "order", to: "/orders" },
        { key: "customers", label: "客户", icon: "users", to: "/customers" },
        { key: "inbound", label: "入库", icon: "inbound", to: "/inbound" },
        { key: "outbound", label: "出库", icon: "truck", to: "/outbound" },
    ]
        .filter(item => grant.menus.includes(item.key))
        .slice(0, 3);

    const itemClass = ({ isActive }: { isActive: boolean }) =>
        `flex flex-col items-center justify-center gap-0.5 text-10.5 transition ${
            isActive ? "bg-primary-soft font-semibold text-primary-strong" : "text-muted"
        }`;

    return (
        <nav
            aria-label="移动导航"
            className="fixed inset-x-0 bottom-0 z-40 grid min-h-16 border-t border-line bg-surface/90 backdrop-blur-lg lg:hidden"
            style={{
                gridTemplateColumns: `repeat(${centerItems.length + 2}, minmax(0, 1fr))`,
                paddingBottom: "env(safe-area-inset-bottom)",
                height: "calc(64px + env(safe-area-inset-bottom))",
            }}
        >
            <NavLink to="/workbench" className={itemClass} end>
                <Icon name="grid" size={19} />
                工作台
            </NavLink>
            {centerItems.map(item => (
                <NavLink key={item.to + item.label} to={item.to} className={itemClass}>
                    <Icon name={item.icon} size={19} />
                    {item.label}
                </NavLink>
            ))}
            <button
                type="button"
                onClick={onOpenDrawer}
                className="flex flex-col items-center justify-center gap-0.5 text-10.5 text-muted"
            >
                <Icon name="more" size={19} />
                更多
            </button>
        </nav>
    );
}

/* 顶栏：偏好设置 / 主题切换 / 全局刷新 / 全屏 / 用户菜单（真实登录用户）。
    内容最大化时高度过渡到 0（不卸载以保留收起/展开动画），内容裁掉且不可交互 */
export function Topbar({
    title,
    onOpenDrawer,
    maximized = false,
}: {
    title: string;
    onOpenDrawer: () => void;
    maximized?: boolean;
}) {
    const { refresh, refreshing } = useWbRefresh();
    const { supported, isFullscreen, toggle } = useFullscreen();
    const { isDark } = usePreferences();
    const toggleTheme = useThemeToggle();
    const [prefsOpen, setPrefsOpen] = useState(false);

    const iconBtn =
        "flex h-11 w-11 shrink-0 max-lg:min-h-[44px] max-lg:min-w-[44px] items-center justify-center rounded-btn text-muted transition hover:bg-soft hover:text-ink active:scale-90";

    return (
        <>
            <header
                className={`sticky top-0 z-30 flex items-center justify-between gap-4 overflow-hidden border-line bg-surface/88 px-4 backdrop-blur-[18px] saturate-150 transition-[height] duration-300 sm:px-6 ${maximized ? "h-0 border-b-0" : "h-16 border-b"}`}
            >
                <div className={`flex min-w-0 items-center gap-3 ${maximized ? "pointer-events-none" : ""}`}>
                    <button
                        type="button"
                        aria-label="打开主导航"
                        onClick={onOpenDrawer}
                        tabIndex={maximized ? -1 : 0}
                        className="flex h-11 w-11 shrink-0 max-lg:min-h-[44px] max-lg:min-w-[44px] items-center justify-center rounded-btn border border-line text-ink lg:hidden"
                    >
                        <Icon name="menu" size={19} />
                    </button>
                    <strong className="block truncate text-15 font-semibold text-ink lg:hidden">{title}</strong>
                </div>

                <div
                    className={`flex shrink-0 items-center gap-1.5 sm:gap-2.5 ${maximized ? "pointer-events-none" : ""}`}
                >
                    <TooltipProvider delayDuration={250}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="偏好设置"
                                    onClick={() => setPrefsOpen(true)}
                                    tabIndex={maximized ? -1 : 0}
                                    className={iconBtn}
                                >
                                    <Icon name="settings" size={20} />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>偏好设置</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="主题"
                                    onClick={toggleTheme}
                                    tabIndex={maximized ? -1 : 0}
                                    className={iconBtn}
                                >
                                    <Icon name={isDark ? "sun" : "moon"} size={20} />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>主题</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="刷新"
                                    onClick={refresh}
                                    tabIndex={maximized ? -1 : 0}
                                    className={iconBtn}
                                >
                                    <Icon name="refresh" size={20} className={refreshing ? "animate-spin" : ""} />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>刷新</TooltipContent>
                        </Tooltip>
                        {supported && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        aria-label="全屏"
                                        onClick={toggle}
                                        tabIndex={maximized ? -1 : 0}
                                        className={`${iconBtn} hidden sm:flex`}
                                    >
                                        <Icon name={isFullscreen ? "minimize" : "maximize"} size={20} />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>全屏</TooltipContent>
                            </Tooltip>
                        )}
                    </TooltipProvider>
                    <UserMenu />
                </div>
            </header>
            <PreferencesDrawer open={prefsOpen} onClose={() => setPrefsOpen(false)} />
        </>
    );
}

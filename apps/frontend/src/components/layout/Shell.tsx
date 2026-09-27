import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { Icon } from "@/lib/icons";
import { BrandLogo } from "@/components/BrandLogo";
import { useApp } from "@/context/useApp";
import { FONT_BASE, usePreferences } from "@/context/usePreferences";
import { buildNavSections, findActiveGroup, type NavSection } from "@/data/permissions";
import { useWbRefresh } from "@/data/queries";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HeaderMenu } from "./HeaderMenu";
import { MenuPanel } from "./MenuPanel";
import { MenuRail } from "./MenuRail";
import { PreferencesDrawer } from "./PreferencesDrawer";
import { SidebarMenu } from "./SidebarMenu";
import type { SidebarForm } from "./useLayoutFlags";
import { UserMenu } from "./UserMenu";
import { useFullscreen } from "./useFullscreen";
import { useThemeToggle } from "./useThemeToggle";

/* 侧边栏导航：由「登录用户角色 + 授权」生成（见 data/permissions.ts） */
function useNavSections(): NavSection[] {
    const { role, grant } = useApp();
    return buildNavSections(role, grant);
}

/* 品牌 logo 块：侧栏（展开/收起）与通栏顶栏共用 */
function BrandMark({ withText }: { withText: boolean }) {
    return (
        <span className="flex min-w-0 items-center gap-3">
            <BrandLogo decorative={withText} />
            {withText && (
                <span className="min-w-0">
                    <span className="block truncate text-15 font-semibold text-ink">众茂生产系统</span>
                </span>
            )}
        </span>
    );
}

interface SidebarProps {
    collapsed: boolean;
    open: boolean;
    onClose: () => void;
    /** 内容最大化时桌面端 clip-path 裁剪到 0（不卸载以保留收起/展开动画） */
    maximized?: boolean;
    /** 侧栏形态（useLayoutFlags 派生）：tree / mixed / group / none */
    form: SidebarForm;
    /** 通栏顶栏模式：桌面端侧栏从顶栏下方开始 */
    belowHeader?: boolean;
}

export function Sidebar({ collapsed, open, onClose, maximized = false, form, belowHeader = false }: SidebarProps) {
    const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
    useEffect(() => {
        const query = window.matchMedia("(min-width: 1024px)");
        const update = () => setDesktop(query.matches);
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    const sections = useNavSections();
    const location = useLocation();
    const activeGroup = findActiveGroup(sections, location.pathname);
    const activeGroupName = activeGroup?.group ?? null;
    // 双列模式手选的组：路由变化时跟随激活组（按组名对比，游离路由 /search 等组名不变，保留上次选择）。
    // 渲染期校正：React 检测到状态更新会立即以最新状态重渲染，不经 effect 级联
    const [selectedGroup, setSelectedGroup] = useState<string | null>(activeGroupName);
    const [lastActiveGroup, setLastActiveGroup] = useState(activeGroupName);
    if (lastActiveGroup !== activeGroupName) {
        setLastActiveGroup(activeGroupName);
        if (activeGroupName) setSelectedGroup(activeGroupName);
    }
    const panelSection =
        sections.find(section => section.group === (selectedGroup ?? activeGroup?.group)) ?? sections[0];

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

    /* 桌面端（vben 式动画）：aside 盒子恒宽（布局不参与动画），可见宽度变化拆成两半——
       前置占位 div 瞬变到位（内容区一次重排），aside 用 clip-path 过渡逐帧裁剪（合成器动画，
       零布局）。mixed 盒 = 图标轨 76 + 子面板 256 = 332，其余形态盒 256。
       折叠可见宽：树形/双列留图标轨 76，group 面板全收；最大化一律归零。
       宽度均按 FONT_BASE=16 的设计 px 计，实际渲染为 rem（根字号随偏好缩放，见 index.css）。
       裁剪类是手写 CSS（index.css），类名值必须完整出现以便逐状态选择 */
    const boxWidth = form === "mixed" ? 332 : 256;
    const visibleWidth = maximized ? 0 : collapsed ? (form === "group" ? 0 : 76) : boxWidth;
    const clipLg = `sidebar-clip-${boxWidth - visibleWidth}`;
    const placeholderWidth = form === "none" ? 0 : visibleWidth;
    // 占位与 aside 盒宽同为 rem 基（FONT_BASE 是根字号设计基准），字号偏好缩放时同倍变化
    const placeholderRem = placeholderWidth / FONT_BASE;

    return (
        <>
            {form !== "none" && (
                <div
                    aria-hidden="true"
                    className="hidden shrink-0 lg:block"
                    style={{ width: `${placeholderRem}rem` }}
                />
            )}
            <aside
                id="mainNavigation"
                aria-label="主导航"
                inert={!desktop && !open}
                className={`fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden border-r border-line bg-sidebar transition-[clip-path,transform] duration-300 ease-out ${clipLg} ${
                    belowHeader ? "lg:top-16 lg:h-[calc(100dvh-4rem)]" : "lg:top-0 lg:h-dvh"
                } ${form === "mixed" ? "lg:w-fit" : "lg:w-64"} w-[min(82vw,300px)] shadow-[8px_0_30px_rgba(16,24,40,.08)] lg:shadow-[8px_0_30px_rgba(16,24,40,.08)] ${
                    open ? "translate-x-0" : "-translate-x-[103%] lg:translate-x-0"
                } ${form === "none" ? "lg:hidden" : ""}`}
            >
                {!desktop || form === "tree" ? (
                    // 移动端抽屉 / 桌面树形：logo + 完整二级菜单（树形折叠态换图标轨弹出）。
                    // 通栏顶栏模式下 logo 只在顶栏，侧栏不重复。
                    // 折叠态盒子仍全宽（clip-path 动画），内容必须收进左缘 76px 裁剪可见区，
                    // 否则随盒子拉伸居中后被整个裁掉（表现为折叠后菜单空白）
                    <>
                        {!belowHeader && (
                            <div className={`relative px-4 pt-5 pb-4 ${collapsed && desktop ? "w-19 shrink-0" : ""}`}>
                                <div
                                    className={`flex items-center gap-3 ${collapsed && desktop ? "justify-center" : ""}`}
                                >
                                    <BrandMark withText={!collapsed || !desktop} />
                                </div>
                            </div>
                        )}
                        {collapsed && desktop ? (
                            <div className="w-19 shrink-0">
                                <MenuRail sections={sections} activeGroup={activeGroup?.group} variant="popup" />
                            </div>
                        ) : (
                            <SidebarMenu sections={sections} onNavigate={desktop ? undefined : onClose} />
                        )}
                    </>
                ) : form === "mixed" ? (
                    // 双列菜单：图标轨（logo 图标居中）+ 子面板
                    <div className="flex h-full min-h-0 w-full">
                        <div className="flex w-19 shrink-0 flex-col items-center border-r border-line">
                            <div className="flex h-16 shrink-0 items-center justify-center">
                                <BrandMark withText={false} />
                            </div>
                            <MenuRail
                                sections={sections}
                                activeGroup={activeGroup?.group}
                                onSelectGroup={setSelectedGroup}
                                variant="panel"
                            />
                        </div>
                        {/* 面板恒宽：折叠/最大化的收起由 aside 的 clip-path 统一裁剪 */}
                        <div className="w-64 min-w-0 overflow-hidden">
                            <MenuPanel section={panelSection} />
                        </div>
                    </div>
                ) : (
                    // 混合垂直：仅激活组面板（logo 在通栏顶栏）
                    <MenuPanel section={panelSection} />
                )}
            </aside>

            {/* 移动端遮罩 */}
            {open && (
                <button
                    type="button"
                    aria-label="关闭主导航"
                    onClick={onClose}
                    className="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px] lg:hidden"
                />
            )}
        </>
    );
}

/* 移动端底部导航：中间入口按菜单授权过滤（客户档案等未授权模块不可达） */
export function MobileBottomNav({ onOpenDrawer }: { onOpenDrawer: () => void }) {
    const { role, grant } = useApp();
    const centerItems = [
        { key: "orders", label: role === "warehouse" ? "待发货" : "订单", icon: "order", to: "/orders" },
        { key: "customers", label: "客户", icon: "contacts", to: "/customers" },
        { key: "inbound", label: "入库", icon: "inbound", to: "/inbound" },
        { key: "outbound", label: "出库", icon: "outbound", to: "/outbound" },
    ]
        .filter(item => grant.menus.includes(item.key))
        .slice(0, 3);

    const itemClass = ({ isActive }: { isActive: boolean }) =>
        `flex flex-col items-center justify-center gap-0.5 text-11 transition ${
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
                <Icon name="grid" size={20} strokeWidth={1.7} />
                工作台
            </NavLink>
            {centerItems.map(item => (
                <NavLink key={item.to + item.label} to={item.to} className={itemClass}>
                    <Icon name={item.icon} size={20} strokeWidth={1.7} />
                    {item.label}
                </NavLink>
            ))}
            <button
                type="button"
                onClick={onOpenDrawer}
                className="flex flex-col items-center justify-center gap-0.5 text-11 text-muted"
            >
                <Icon name="more" size={19} />
                更多
            </button>
        </nav>
    );
}

/* 顶栏：偏好设置 / 主题切换 / 全局刷新 / 全屏 / 用户菜单（真实登录用户）。
    variant="full"（通栏顶栏）：含品牌 logo；showMenu 时以水平组菜单替代面包屑（桌面）。
    内容最大化时高度过渡到 0（不卸载以保留收起/展开动画），内容裁掉且不可交互 */
export function Topbar({
    title,
    group,
    icon,
    routeKey,
    collapsed,
    onToggleCollapse,
    onOpenDrawer,
    maximized = false,
    variant = "default",
    showMenu = false,
    showCollapse = true,
    showBrand = true,
}: {
    title: string;
    group?: string;
    icon: string;
    routeKey: string;
    collapsed: boolean;
    onToggleCollapse: () => void;
    onOpenDrawer: () => void;
    maximized?: boolean;
    variant?: "default" | "full";
    /** variant="full" 时渲染水平组菜单（水平 / 混合垂直 / 混合双列） */
    showMenu?: boolean;
    /** 水平模式无侧栏：隐藏折叠按钮 */
    showCollapse?: boolean;
    /** 混合双列的 logo 留在图标轨，顶栏不重复显示 */
    showBrand?: boolean;
}) {
    const { refresh, refreshing } = useWbRefresh();
    const { supported, isFullscreen, toggle } = useFullscreen();
    const { isDark } = usePreferences();
    const toggleTheme = useThemeToggle();
    const [prefsOpen, setPrefsOpen] = useState(false);
    const sections = useNavSections();

    const iconBtn =
        "flex h-11 w-11 shrink-0 max-lg:min-h-[44px] max-lg:min-w-[44px] items-center justify-center rounded-btn text-muted transition hover:bg-soft hover:text-ink active:scale-90";

    return (
        <>
            {/* 最大化收起（vben fullContent 同款）：高度瞬变归零、不参与过渡——
                vben 的 sticky 头部同样如此（hidden 态只动画 transform，maximize 时高度直接归零）。
                sticky 会把负 margin clamp 回 top 约束，margin 过渡方案对 sticky 头部无效 */}
            <header
                className={`sticky top-0 z-30 flex items-center justify-between gap-4 overflow-hidden border-line bg-surface/88 px-4 backdrop-blur-[18px] saturate-150 sm:px-6 ${maximized ? "h-0 border-b-0" : "h-16 border-b"}`}
            >
                <div className={`flex min-w-0 flex-1 items-center gap-3 ${maximized ? "pointer-events-none" : ""}`}>
                    {variant === "full" && showBrand && <BrandMark withText />}

                    <button
                        type="button"
                        aria-label="打开主导航"
                        aria-controls="mainNavigation"
                        onClick={onOpenDrawer}
                        tabIndex={maximized ? -1 : 0}
                        className="flex h-11 w-11 shrink-0 max-lg:min-h-[44px] max-lg:min-w-[44px] items-center justify-center rounded-btn border border-line text-ink lg:hidden"
                    >
                        <Icon name="menu" size={19} />
                    </button>
                    {showCollapse && (
                        <button
                            type="button"
                            aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
                            aria-controls="mainNavigation"
                            aria-expanded={!collapsed}
                            onClick={onToggleCollapse}
                            tabIndex={maximized ? -1 : 0}
                            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-btn text-muted transition hover:bg-soft hover:text-ink active:scale-90 lg:flex"
                        >
                            <Icon name="menu" size={19} />
                        </button>
                    )}
                    <strong
                        key={`mobile-${routeKey}`}
                        className="animate-breadcrumb-enter block truncate text-15 font-semibold text-ink lg:hidden"
                    >
                        {title}
                    </strong>
                    {showMenu ? (
                        <HeaderMenu sections={sections} />
                    ) : (
                        <nav
                            aria-label="面包屑"
                            className="hidden min-w-0 items-center gap-2 whitespace-nowrap lg:flex"
                        >
                            {group && (
                                <>
                                    <span className="text-14 text-muted">{group}</span>
                                    <span aria-hidden="true" className="text-14 text-subtle">
                                        /
                                    </span>
                                </>
                            )}
                            <span
                                key={routeKey}
                                aria-current="page"
                                className="animate-breadcrumb-enter flex min-w-0 items-center gap-1.5 text-14 font-semibold text-ink"
                            >
                                <Icon name={icon} size={16} className="shrink-0" />
                                <span className="truncate">{title}</span>
                            </span>
                        </nav>
                    )}
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

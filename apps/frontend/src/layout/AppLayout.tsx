import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { ROLE_META, useApp, type Role } from "@/context/useApp";
import { ContentMaximizeContext } from "@/context/useContentMaximize";
import { usePreferences } from "@/context/usePreferences";
import { MENU_CATALOG, menuLabelFor } from "@/data/permissions";
import { MobileBottomNav, Sidebar, Topbar } from "@/components/layout/Shell";
import { useLayoutFlags } from "@/components/layout/useLayoutFlags";
import { PageLoading } from "@/components/ui/PageLoading";
import { GlobalWatermark } from "@/components/ui/Watermark";
import { AppContentErrorBoundary, ErrorPage } from "@/pages/error/ErrorPage";

// 工作台标题随登录角色；其余页面标题取菜单字典（含仓管在订单页的「待发货订单」别名）
function resolveTitle(pathname: string, role: Role) {
    if (pathname.startsWith("/workbench")) return ROLE_META[role].label;
    if (pathname.startsWith("/search")) return "搜索";
    const menu = MENU_CATALOG.find(menu => menu.to && pathname.startsWith(menu.to));
    return menu ? menuLabelFor(menu, role) : "页面不存在";
}

/* 登录后各页面的共享外壳：标题同步、认证/菜单守卫、侧边栏 + 内容区 + 移动端导航。
   按布局偏好渲染两种骨架（vben 式）：A 侧栏全高 + 顶栏在内容列；B 通栏顶栏 + 侧栏在下方 */
export function AppLayout() {
    const location = useLocation();
    const { status, role, grant, user } = useApp();
    const { preferences } = usePreferences();
    const { sidebarForm, headerFull, headerMenu } = useLayoutFlags();
    const showSidebar = sidebarForm !== "none";
    // 抽屉只在打开它的那个路由上可见，路由一变自动收起（兜底重定向/浏览器回退等非点击导航）
    const [drawerPath, setDrawerPath] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    // 内容最大化（vben 式）：与抽屉同理，记录触发的路由，路由一变派生为 false
    const [maximizedPath, setMaximizedPath] = useState<string | null>(null);
    const maximized = maximizedPath === location.pathname;
    const toggleMaximize = useCallback(() => {
        setMaximizedPath(current => (current === location.pathname ? null : location.pathname));
    }, [location.pathname]);

    // Esc 退出最大化；有弹窗打开时让弹窗先消费 Esc（弹窗自身也监听 Escape 关闭）
    useEffect(() => {
        if (!maximized) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || document.querySelector('[role="dialog"]')) return;
            event.preventDefault();
            setMaximizedPath(null);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [maximized]);

    // 切换布局模式时重置折叠态：不同形态对 collapsed 的语义不同（树形/面板收起 vs 双列收子栏）。
    // 依赖用布局枚举而非 sidebarForm：垂直↔侧边导航同属 tree 形态，形态不变也要回到展开态
    useEffect(() => {
        setCollapsed(false);
    }, [preferences.layout]);

    // 首屏(含登录后首次进入)不播页面进入动画,避免拖慢首次内容感知;此后路由切换播放
    const firstRender = useRef(true);
    useEffect(() => {
        firstRender.current = false;
    });

    const activeMenu = MENU_CATALOG.find(
        menu => menu.to && menu.key !== "workbench" && location.pathname.startsWith(menu.to),
    );
    const breadcrumbMenu = MENU_CATALOG.find(menu => menu.to && location.pathname.startsWith(menu.to));
    const accessDenied = Boolean(activeMenu && !grant.menus.includes(activeMenu.key));
    // 授权未就绪（loading/guest）时不按空 grant 判无权限、不动标题：
    // title effect 在 early return 之前，加载期 grant 恒空会闪"没有访问权限"
    const title =
        status === "authenticated" ? (accessDenied ? "没有访问权限" : resolveTitle(location.pathname, role)) : "";

    useEffect(() => {
        if (title) document.title = `${title} · 众茂生产系统`;
    }, [title]);

    // 认证守卫：未登录进登录页；本地 token 校验中显示全屏加载画面（避免未授权请求）
    if (status === "guest") return <Navigate to="/login" replace />;
    if (status === "loading") return <PageLoading routeLevel className="min-h-dvh bg-canvas" />;

    const sidebarProps = {
        collapsed,
        open: drawerPath === location.pathname,
        onClose: () => setDrawerPath(null),
        maximized,
    };
    const topbarProps = {
        title,
        group: breadcrumbMenu?.group,
        icon: breadcrumbMenu?.icon ?? (location.pathname.startsWith("/search") ? "search" : "info"),
        routeKey: location.pathname,
        collapsed,
        onToggleCollapse: () => setCollapsed(value => !value),
        onOpenDrawer: () => setDrawerPath(location.pathname),
        maximized,
    };

    /* 内容区：两骨架共用。最大化时 padding 瞬变（不参与过渡）：布局占位的让位一次完成，
       避免表格随 padding 逐帧重排（vben 式，动画只剩侧栏裁剪与顶栏推出） */
    const mainElement = (
        <main
            id="mainContent"
            className={
                maximized
                    ? "mx-auto flex w-full min-w-0 flex-1 flex-col overflow-hidden p-3 lg:p-4"
                    : "mx-auto w-full min-w-0 flex-1 px-[clamp(16px,2vw,32px)] pt-6 pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-8"
            }
        >
            {accessDenied ? (
                <ErrorPage kind="forbidden" />
            ) : (
                <AppContentErrorBoundary>
                    <Suspense fallback={<PageLoading routeLevel />}>
                        {/* key 只用 pathname(不含 search):改筛选参数不重播进入动画 */}
                        <div key={location.pathname} className={firstRender.current ? "" : "animate-page-enter"}>
                            <Outlet />
                        </div>
                    </Suspense>
                </AppContentErrorBoundary>
            )}
        </main>
    );

    return (
        <ContentMaximizeContext.Provider value={{ maximized, toggle: toggleMaximize }}>
            {headerFull ? (
                // 骨架 B：通栏顶栏（水平 / 侧边导航 / 混合垂直 / 混合双列），侧栏从顶栏下方开始。
                // Sidebar 始终渲染：水平模式仅桌面隐藏（lg:hidden），移动端抽屉仍由它承载
                <div
                    className={maximized ? "flex h-dvh flex-col overflow-hidden" : "flex min-h-dvh flex-col"}
                    data-maximized={maximized || undefined}
                >
                    <Topbar
                        variant="full"
                        showMenu={headerMenu}
                        showCollapse={showSidebar}
                        showBrand={sidebarForm !== "mixed"}
                        {...topbarProps}
                    />
                    <div className="flex min-w-0 flex-1">
                        <Sidebar form={sidebarForm} belowHeader {...sidebarProps} />
                        {mainElement}
                    </div>
                </div>
            ) : (
                // 骨架 A（现状）：侧栏全高，顶栏只在内容区上方
                <div
                    className={maximized ? "flex h-dvh overflow-hidden" : "flex min-h-dvh"}
                    data-maximized={maximized || undefined}
                >
                    <Sidebar form={sidebarForm} {...sidebarProps} />
                    <div className="flex min-w-0 flex-1 flex-col">
                        <Topbar {...topbarProps} />
                        {mainElement}
                    </div>
                </div>
            )}
            {!maximized && <MobileBottomNav onOpenDrawer={() => setDrawerPath(location.pathname)} />}
            {user && <GlobalWatermark text={user.name} />}
        </ContentMaximizeContext.Provider>
    );
}

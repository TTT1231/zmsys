import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { ROLE_META, useApp, type Role } from "@/context/useApp";
import { ContentMaximizeContext } from "@/context/useContentMaximize";
import { MENU_CATALOG, menuLabelFor } from "@/data/permissions";
import { MobileBottomNav, Sidebar, Topbar } from "@/components/layout/Shell";
import { PageLoading } from "@/components/ui/PageLoading";
import { GlobalWatermark } from "@/components/ui/Watermark";
import { Icon } from "@/lib/icons";
import { AppContentErrorBoundary, ErrorPage } from "@/pages/error/ErrorPage";

// 工作台标题随登录角色；其余页面标题取菜单字典（含仓管在订单页的「待发货订单」别名）
function resolveTitle(pathname: string, role: Role) {
    if (pathname.startsWith("/workbench")) return ROLE_META[role].label;
    if (pathname.startsWith("/search")) return "搜索";
    const menu = MENU_CATALOG.find(menu => menu.to && pathname.startsWith(menu.to));
    return menu ? menuLabelFor(menu, role) : "页面不存在";
}

/* 登录后各页面的共享外壳：标题同步、认证/菜单守卫、侧边栏 + 内容区 + 移动端导航 */
export function AppLayout() {
    const location = useLocation();
    const { status, role, grant, user } = useApp();
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

    // 首屏(含登录后首次进入)不播页面进入动画,避免拖慢首次内容感知;此后路由切换播放
    const firstRender = useRef(true);
    useEffect(() => {
        firstRender.current = false;
    });

    const activeMenu = MENU_CATALOG.find(
        menu => menu.to && menu.key !== "workbench" && location.pathname.startsWith(menu.to),
    );
    const accessDenied = Boolean(activeMenu && !grant.menus.includes(activeMenu.key));
    // 授权未就绪（loading/guest）时不按空 grant 判无权限、不动标题：
    // title effect 在 early return 之前，加载期 grant 恒空会闪"没有访问权限"
    const title =
        status === "authenticated" ? (accessDenied ? "没有访问权限" : resolveTitle(location.pathname, role)) : "";

    useEffect(() => {
        if (title) document.title = `${title} · 智造管理系统`;
    }, [title]);

    // 认证守卫：未登录进登录页；本地 token 校验中显示全屏加载画面（避免未授权请求）
    if (status === "guest") return <Navigate to="/login" replace />;
    if (status === "loading") return <PageLoading routeLevel className="min-h-dvh bg-canvas" />;

    return (
        <ContentMaximizeContext.Provider value={{ maximized, toggle: toggleMaximize }}>
            <div
                className={maximized ? "flex h-dvh overflow-hidden" : "flex min-h-dvh"}
                data-maximized={maximized || undefined}
            >
                {/* 侧边栏/顶栏最大化时收起但不卸载，宽度/高度过渡产生收起动画 */}
                <Sidebar
                    collapsed={collapsed}
                    onToggleCollapse={() => setCollapsed(value => !value)}
                    open={drawerPath === location.pathname}
                    onClose={() => setDrawerPath(null)}
                    maximized={maximized}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                    <Topbar title={title} onOpenDrawer={() => setDrawerPath(location.pathname)} maximized={maximized} />
                    <main
                        id="mainContent"
                        className={
                            maximized
                                ? "mx-auto flex w-full min-w-0 flex-1 flex-col overflow-hidden p-3 transition-[padding] duration-300 lg:p-4"
                                : "mx-auto w-full min-w-0 flex-1 px-[clamp(16px,2vw,32px)] pt-6 pb-[calc(76px+env(safe-area-inset-bottom))] transition-[padding] duration-300 lg:pb-8"
                        }
                    >
                        {accessDenied ? (
                            <ErrorPage kind="forbidden" />
                        ) : (
                            <AppContentErrorBoundary>
                                <Suspense fallback={<PageLoading routeLevel />}>
                                    {/* key 只用 pathname(不含 search):改筛选参数不重播进入动画 */}
                                    <div
                                        key={location.pathname}
                                        className={firstRender.current ? "" : "animate-page-enter"}
                                    >
                                        <Outlet />
                                    </div>
                                </Suspense>
                            </AppContentErrorBoundary>
                        )}
                    </main>
                </div>
                {!maximized && <MobileBottomNav onOpenDrawer={() => setDrawerPath(location.pathname)} />}
                {/* 最大化时页头(含进入按钮)已隐藏，右上角浮动退出按钮接替 */}
                {maximized && (
                    <button
                        type="button"
                        aria-label="退出内容最大化"
                        title="退出内容最大化（Esc）"
                        onClick={toggleMaximize}
                        className="fixed top-2.5 right-2.5 z-50 flex h-9 w-9 items-center justify-center rounded-btn border border-line bg-white/92 text-muted shadow-card backdrop-blur transition hover:bg-soft hover:text-ink active:scale-90"
                    >
                        <Icon name="minimize" size={16} />
                    </button>
                )}
                {user && <GlobalWatermark text={user.name} />}
            </div>
        </ContentMaximizeContext.Provider>
    );
}

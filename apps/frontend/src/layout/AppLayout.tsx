import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { ROLE_META, useApp, type Role } from "@/context/AppContext";
import { MENU_CATALOG, menuLabelFor } from "@/data/permissions";
import { MobileBottomNav, Sidebar, Topbar } from "@/components/layout/Shell";

// 工作台标题随登录角色；其余页面标题取菜单字典（含仓管在订单页的「待发货订单」别名）
function resolveTitle(pathname: string, role: Role) {
    if (pathname.startsWith("/workbench")) return ROLE_META[role].label;
    if (pathname.startsWith("/search")) return "搜索";
    const menu = MENU_CATALOG.find(menu => menu.to && pathname.startsWith(menu.to));
    return menu ? menuLabelFor(menu, role) : "智造管理系统";
}

/* 登录后各页面的共享外壳：标题同步、认证/菜单守卫、侧边栏 + 内容区 + 移动端导航 */
export function AppLayout() {
    const location = useLocation();
    const { status, role, grant } = useApp();
    // 抽屉只在打开它的那个路由上可见，路由一变自动收起（兜底重定向/浏览器回退等非点击导航）
    const [drawerPath, setDrawerPath] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);

    const title = resolveTitle(location.pathname, role);

    useEffect(() => {
        document.title = `${title} · 智造管理系统`;
    }, [title]);

    // 认证守卫：未登录进登录页；本地 token 校验中先不渲染（避免未授权请求）
    if (status === "guest") return <Navigate to="/login" replace />;
    if (status === "loading") return null;

    // 集中菜单守卫：当前路径对应的菜单未授权时回自己角色的工作台
    //（工作台自身不设守卫，/search 由搜索页按类目过滤）
    const activeMenu = MENU_CATALOG.find(
        menu => menu.to && menu.key !== "workbench" && location.pathname.startsWith(menu.to),
    );
    if (activeMenu && !grant.menus.includes(activeMenu.key)) {
        return <Navigate to="/workbench" replace />;
    }

    return (
        <div className="flex min-h-dvh">
            <Sidebar
                collapsed={collapsed}
                onToggleCollapse={() => setCollapsed(value => !value)}
                open={drawerPath === location.pathname}
                onClose={() => setDrawerPath(null)}
            />
            <div className="flex min-w-0 flex-1 flex-col">
                <Topbar title={title} onOpenDrawer={() => setDrawerPath(location.pathname)} />
                <main
                    id="mainContent"
                    className="mx-auto w-full max-w-390 flex-1 px-[clamp(16px,3vw,48px)] pt-6 pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-11"
                >
                    <Outlet />
                </main>
            </div>
            <MobileBottomNav onOpenDrawer={() => setDrawerPath(location.pathname)} />
        </div>
    );
}

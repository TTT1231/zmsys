import { SearchPage } from "./pages/workbench/SearchPage";
import { useEffect, useState } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router";
import { MobileBottomNav, Sidebar, Topbar } from "./components/layout/Shell";
import { ROLE_META, useApp } from "./context/AppContext";
import { MENU_CATALOG } from "./data/permissions";
import { LoginPage } from "./pages/login/LoginPage";
import { WorkbenchPage } from "./pages/workbench/WorkbenchPage";
import { OrdersPage } from "./pages/orders/OrdersPage";
import { CustomersPage } from "./pages/customers/CustomersPage";
import { BomPage } from "./pages/bom/BomPage";
import { InboundPage } from "./pages/inbound/InboundPage";
import { OutboundPage } from "./pages/outbound/OutboundPage";
import { PermissionsPage } from "./pages/permissions/PermissionsPage";

const PAGE_TITLES: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^\/search/, () => "搜索"],
    [/^\/orders/, () => "销售订单"],
    [/^\/customers/, () => "客户档案"],
    [/^\/bom/, () => "物料与 BOM"],
    [/^\/inbound/, () => "成品入库"],
    [/^\/outbound/, () => "成品出库"],
    [/^\/permissions/, () => "用户与权限"],
];

// 工作台标题随登录角色；仓库角色在订单页关注发货，标题跟随其工作台入口
function resolveTitle(pathname: string, role: string) {
    if (pathname.startsWith("/workbench")) return ROLE_META[role as keyof typeof ROLE_META]?.label ?? "智造管理系统";
    const match = PAGE_TITLES.find(([pattern]) => pattern.test(pathname));
    const title = match ? match[1](pathname.match(match[0])!) : "智造管理系统";
    return title === "销售订单" && role === "warehouse" ? "待发货订单" : title;
}

function AppLayout() {
    const location = useLocation();
    const { status, role, grant } = useApp();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        setDrawerOpen(false);
        document.title = `${resolveTitle(location.pathname, role)} · 智造管理系统`;
    }, [location.pathname, role]);

    const title = resolveTitle(location.pathname, role);

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
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            />
            <div className="flex min-w-0 flex-1 flex-col">
                <Topbar title={title} onOpenDrawer={() => setDrawerOpen(true)} />
                <main
                    id="mainContent"
                    className="mx-auto w-full max-w-390 flex-1 px-[clamp(16px,3vw,48px)] pt-6 pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-11"
                >
                    <Outlet />
                </main>
            </div>
            <MobileBottomNav onOpenDrawer={() => setDrawerOpen(true)} />
        </div>
    );
}

export const router = createBrowserRouter([
    { path: "/login", element: <LoginPage /> },
    {
        element: <AppLayout />,
        children: [
            { path: "/", element: <Navigate to="/workbench" replace /> },
            { path: "/workbench", element: <WorkbenchPage /> },
            // 兼容旧版 /workbench/:role 演示链接
            { path: "/workbench/:role", element: <Navigate to="/workbench" replace /> },
            { path: "/search", element: <SearchPage /> },
            { path: "/orders", element: <OrdersPage /> },
            { path: "/customers", element: <CustomersPage /> },
            { path: "/bom", element: <BomPage /> },
            { path: "/production", element: <Navigate to="/orders" replace /> },
            { path: "/inbound", element: <InboundPage /> },
            { path: "/outbound", element: <OutboundPage /> },
            { path: "/permissions", element: <PermissionsPage /> },
            { path: "*", element: <Navigate to="/workbench" replace /> },
        ],
    },
]);

import { useEffect, useState } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router";
import { MobileBottomNav, Sidebar, Topbar } from "./components/layout/Shell";
import { ROLE_META, useApp, type Role } from "./context/AppContext";
import { WorkbenchPage } from "./pages/workbench/WorkbenchPage";
import { OrdersPage } from "./pages/orders/OrdersPage";
import { CustomersPage } from "./pages/customers/CustomersPage";
import { BomPage } from "./pages/bom/BomPage";
import { ProductionPage } from "./pages/production/ProductionPage";
import { InboundPage } from "./pages/inbound/InboundPage";
import { OutboundPage } from "./pages/outbound/OutboundPage";
import { PermissionsPage } from "./pages/permissions/PermissionsPage";

const PAGE_TITLES: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^\/workbench\/(admin|sales|warehouse)/, (match) => ROLE_META[match[1] as Role].label],
  [/^\/orders/, () => "销售订单"],
  [/^\/customers/, () => "客户档案"],
  [/^\/bom/, () => "物料与 BOM"],
  [/^\/production/, () => "生产进度"],
  [/^\/inbound/, () => "成品入库"],
  [/^\/outbound/, () => "成品出库"],
  [/^\/permissions/, () => "用户与权限"],
];

function AppLayout() {
  const location = useLocation();
  const { setRole } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // URL 中的角色工作台同步到全局角色状态（侧边栏/顶栏用户身份跟随）
  useEffect(() => {
    const match = location.pathname.match(/^\/workbench\/(admin|sales|warehouse)$/);
    if (match) setRole(match[1] as Role);
  }, [location.pathname, setRole]);

  useEffect(() => {
    setDrawerOpen(false);
    const match = PAGE_TITLES.find(([pattern]) => pattern.test(location.pathname));
    const title = match ? match[1](location.pathname.match(match[0])!) : "智造管理系统";
    document.title = `${title} · 智造管理系统`;
  }, [location.pathname]);

  const title = (() => {
    const match = PAGE_TITLES.find(([pattern]) => pattern.test(location.pathname));
    return match ? match[1](location.pathname.match(match[0])!) : "智造管理系统";
  })();

  return (
    <div className="flex min-h-dvh">
      <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((value) => !value)} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} onOpenDrawer={() => setDrawerOpen(true)} />
        <main id="mainContent" className="mx-auto w-full max-w-[1560px] flex-1 px-[clamp(16px,3vw,48px)] pt-6 pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-11">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav onOpenDrawer={() => setDrawerOpen(true)} />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <Navigate to="/workbench/admin" replace /> },
      { path: "/workbench/:role", element: <WorkbenchPage /> },
      { path: "/orders", element: <OrdersPage /> },
      { path: "/customers", element: <CustomersPage /> },
      { path: "/bom", element: <BomPage /> },
      { path: "/production", element: <ProductionPage /> },
      { path: "/inbound", element: <InboundPage /> },
      { path: "/outbound", element: <OutboundPage /> },
      { path: "/permissions", element: <PermissionsPage /> },
      { path: "*", element: <Navigate to="/workbench/admin" replace /> },
    ],
  },
]);

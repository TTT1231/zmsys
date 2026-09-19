import { lazy } from "react";

/* 页面懒加载:路由 chunk 分离,首次访问由 Suspense fallback(PageLoading)兜底,
   同时驱动顶部路由进度条;布局外壳保持静态,切换路由时顶栏/侧栏不重挂 */

export const LoginPage = lazy(() => import("./pages/login/LoginPage").then(m => ({ default: m.LoginPage })));
export const WorkbenchPage = lazy(() =>
    import("./pages/workbench/WorkbenchPage").then(m => ({ default: m.WorkbenchPage })),
);
export const SearchPage = lazy(() => import("./pages/workbench/SearchPage").then(m => ({ default: m.SearchPage })));
export const OrdersPage = lazy(() => import("./pages/orders/OrdersPage").then(m => ({ default: m.OrdersPage })));
export const CustomersPage = lazy(() =>
    import("./pages/customers/CustomersPage").then(m => ({ default: m.CustomersPage })),
);
export const BomPage = lazy(() => import("./pages/bom/BomPage").then(m => ({ default: m.BomPage })));
export const InboundPage = lazy(() => import("./pages/inbound/InboundPage").then(m => ({ default: m.InboundPage })));
export const OutboundPage = lazy(() =>
    import("./pages/outbound/OutboundPage").then(m => ({ default: m.OutboundPage })),
);
export const PermissionsPage = lazy(() =>
    import("./pages/permissions/PermissionsPage").then(m => ({ default: m.PermissionsPage })),
);

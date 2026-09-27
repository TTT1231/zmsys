import { lazy } from "react";

/* 页面懒加载:路由 chunk 分离,首次访问由 Suspense fallback(PageLoading)兜底,
   同时驱动顶部路由进度条;布局外壳保持静态,切换路由时顶栏/侧栏不重挂 */

export const LoginPage = lazy(() => import("./pages/login/LoginPage").then(m => ({ default: m.LoginPage })));
export const WorkbenchPage = lazy(() =>
    import("./pages/workbench/WorkbenchPage").then(m => ({ default: m.WorkbenchPage })),
);
export const SearchPage = lazy(() => import("./pages/workbench/SearchPage").then(m => ({ default: m.SearchPage })));
export const OrdersPage = lazy(() => import("./pages/orders/OrdersPage").then(m => ({ default: m.OrdersPage })));
export const ArchivedOrdersPage = lazy(() =>
    import("./pages/orders/ArchivedOrdersPage").then(m => ({ default: m.ArchivedOrdersPage })),
);
export const CustomersPage = lazy(() =>
    import("./pages/customers/CustomersPage").then(m => ({ default: m.CustomersPage })),
);
export const BomPage = lazy(() => import("./pages/bom/BomPage").then(m => ({ default: m.BomPage })));
export const InboundPage = lazy(() => import("./pages/inbound/InboundPage").then(m => ({ default: m.InboundPage })));
export const OutboundPage = lazy(() =>
    import("./pages/outbound/OutboundPage").then(m => ({ default: m.OutboundPage })),
);
export const StockPage = lazy(() => import("./pages/stock/StockPage").then(m => ({ default: m.StockPage })));
export const PermissionsPage = lazy(() =>
    import("./pages/permissions/PermissionsPage").then(m => ({ default: m.PermissionsPage })),
);
export const BackupPage = lazy(() => import("./pages/system/BackupPage").then(m => ({ default: m.BackupPage })));
export const RestorePage = lazy(() => import("./pages/system/RestorePage").then(m => ({ default: m.RestorePage })));
export const SystemLogsPage = lazy(() =>
    import("./pages/system-logs/SystemLogsPage").then(m => ({ default: m.SystemLogsPage })),
);

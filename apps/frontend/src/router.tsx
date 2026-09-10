import { Suspense, lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { AppLayout } from "./layout/AppLayout";
import { PageLoading } from "./components/ui/PageLoading";
import { ProgressLayout } from "./components/RouteProgressBar";
import { ErrorPage, RouterErrorPage } from "./pages/error/ErrorPage";

/* 页面懒加载:路由 chunk 分离,首次访问由 Suspense fallback(PageLoading)兜底,
   同时驱动顶部路由进度条;布局外壳保持静态,切换路由时顶栏/侧栏不重挂 */
const LoginPage = lazy(() => import("./pages/login/LoginPage").then(m => ({ default: m.LoginPage })));
const WorkbenchPage = lazy(() => import("./pages/workbench/WorkbenchPage").then(m => ({ default: m.WorkbenchPage })));
const SearchPage = lazy(() => import("./pages/workbench/SearchPage").then(m => ({ default: m.SearchPage })));
const OrdersPage = lazy(() => import("./pages/orders/OrdersPage").then(m => ({ default: m.OrdersPage })));
const CustomersPage = lazy(() => import("./pages/customers/CustomersPage").then(m => ({ default: m.CustomersPage })));
const BomPage = lazy(() => import("./pages/bom/BomPage").then(m => ({ default: m.BomPage })));
const InboundPage = lazy(() => import("./pages/inbound/InboundPage").then(m => ({ default: m.InboundPage })));
const OutboundPage = lazy(() => import("./pages/outbound/OutboundPage").then(m => ({ default: m.OutboundPage })));
const PermissionsPage = lazy(() =>
    import("./pages/permissions/PermissionsPage").then(m => ({ default: m.PermissionsPage })),
);

export const router = createBrowserRouter([
    {
        /* 根布局:进度条覆盖所有路由(login ↔ 应用互切) */
        element: <ProgressLayout />,
        errorElement: <RouterErrorPage />,
        children: [
            {
                path: "/login",
                element: (
                    <Suspense fallback={<PageLoading className="min-h-dvh bg-canvas" />}>
                        <LoginPage />
                    </Suspense>
                ),
            },
            {
                element: <AppLayout />,
                children: [
                    { path: "/", element: <Navigate to="/workbench" replace /> },
                    { path: "/workbench", element: <WorkbenchPage /> },
                    { path: "/search", element: <SearchPage /> },
                    { path: "/orders", element: <OrdersPage /> },
                    { path: "/customers", element: <CustomersPage /> },
                    { path: "/bom", element: <BomPage /> },
                    { path: "/inbound", element: <InboundPage /> },
                    { path: "/outbound", element: <OutboundPage /> },
                    { path: "/permissions", element: <PermissionsPage /> },
                    { path: "*", element: <ErrorPage kind="not-found" /> },
                ],
            },
        ],
    },
]);

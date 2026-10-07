import { Suspense } from "react";
import { createBrowserRouter } from "react-router";
import { AppLayout } from "./layout/AppLayout";
import { PageLoading } from "./components/ui/PageLoading";
import { ProgressLayout } from "./components/RouteProgressBar";
import { ErrorPage, RouterErrorPage } from "./pages/error/ErrorPage";
/* 懒加载页面组件单独成文件(RouterPages.tsx):本文件还要导出 router 实例,
   混放组件定义会破坏 React Fast Refresh */
import {
    ArchivedOrdersPage,
    BackupPage,
    BomPage,
    CustomersPage,
    HomeRedirect,
    InboundPage,
    LoginPage,
    OrdersPage,
    OutboundPage,
    PermissionsPage,
    RestorePage,
    SearchPage,
    StockPage,
    SystemLogsPage,
    WorkbenchPage,
} from "./RouterPages";

export const router = createBrowserRouter([
    {
        /* 根布局:进度条覆盖所有路由(login ↔ 应用互切) */
        element: <ProgressLayout />,
        errorElement: <RouterErrorPage />,
        children: [
            {
                path: "/login",
                element: (
                    <Suspense fallback={<PageLoading routeLevel className="min-h-dvh bg-canvas" />}>
                        <LoginPage />
                    </Suspense>
                ),
            },
            {
                element: <AppLayout />,
                children: [
                    { path: "/", element: <HomeRedirect /> },
                    { path: "/workbench", element: <WorkbenchPage /> },
                    { path: "/search", element: <SearchPage /> },
                    { path: "/orders", element: <OrdersPage /> },
                    { path: "/archived-orders", element: <ArchivedOrdersPage /> },
                    { path: "/customers", element: <CustomersPage /> },
                    { path: "/bom", element: <BomPage /> },
                    { path: "/inbound", element: <InboundPage /> },
                    { path: "/outbound", element: <OutboundPage /> },
                    { path: "/stock", element: <StockPage /> },
                    { path: "/permissions", element: <PermissionsPage /> },
                    { path: "/system/backup", element: <BackupPage /> },
                    { path: "/system/restore", element: <RestorePage /> },
                    { path: "/system-logs", element: <SystemLogsPage /> },
                    { path: "*", element: <ErrorPage kind="not-found" /> },
                ],
            },
        ],
    },
]);

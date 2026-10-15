import { Suspense } from "react";
import { Navigate, createBrowserRouter } from "react-router";
import { AppLayout } from "./layout/AppLayout";
import { PageLoading } from "./components/ui/PageLoading";
import { ProgressLayout } from "./components/RouteProgressBar";
import { ErrorPage, RouterErrorPage } from "./pages/error/ErrorPage";
/* 懒加载页面组件单独成文件(RouterPages.tsx):本文件还要导出 router 实例,
   混放组件定义会破坏 React Fast Refresh */
import {
    AiWorkbenchPage,
    AnalyticsPage,
    ArchivedOrdersPage,
    BackupPage,
    BomPage,
    BomStructurePage,
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
                    /* 旧工作台甘特图地址：迁移到独立分析页后保留重定向兜底 */
                    { path: "/workbench/delivery-gantt", element: <Navigate to="/analytics" replace /> },
                    { path: "/analytics", element: <AnalyticsPage /> },
                    { path: "/search", element: <SearchPage /> },
                    { path: "/orders", element: <OrdersPage /> },
                    { path: "/archived-orders", element: <ArchivedOrdersPage /> },
                    { path: "/customers", element: <CustomersPage /> },
                    { path: "/bom", element: <BomPage /> },
                    /* BOM 结构（仅超管）：路径不以 /bom 开头——AppLayout 守卫按 startsWith
                     * 匹配菜单，/bom-structure 会被 /bom 菜单抢先命中 */
                    { path: "/product-structure", element: <BomStructurePage /> },
                    { path: "/inbound", element: <InboundPage /> },
                    { path: "/outbound", element: <OutboundPage /> },
                    { path: "/stock", element: <StockPage /> },
                    { path: "/permissions", element: <PermissionsPage /> },
                    { path: "/system/backup", element: <BackupPage /> },
                    { path: "/system/restore", element: <RestorePage /> },
                    { path: "/system-logs", element: <SystemLogsPage /> },
                    { path: "/ai-workbench", element: <AiWorkbenchPage /> },
                    { path: "*", element: <ErrorPage kind="not-found" /> },
                ],
            },
        ],
    },
]);

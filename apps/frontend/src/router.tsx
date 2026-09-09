import { createBrowserRouter, Navigate } from "react-router";
import { AppLayout } from "./layout/AppLayout";
import { LoginPage } from "./pages/login/LoginPage";
import { WorkbenchPage } from "./pages/workbench/WorkbenchPage";
import { SearchPage } from "./pages/workbench/SearchPage";
import { OrdersPage } from "./pages/orders/OrdersPage";
import { CustomersPage } from "./pages/customers/CustomersPage";
import { BomPage } from "./pages/bom/BomPage";
import { InboundPage } from "./pages/inbound/InboundPage";
import { OutboundPage } from "./pages/outbound/OutboundPage";
import { PermissionsPage } from "./pages/permissions/PermissionsPage";

export const router = createBrowserRouter([
    { path: "/login", element: <LoginPage /> },
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
            { path: "*", element: <Navigate to="/workbench" replace /> },
        ],
    },
]);

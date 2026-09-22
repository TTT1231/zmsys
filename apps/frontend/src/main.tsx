import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProvider } from "./context/AppContext";
import { PreferencesProvider } from "./context/PreferencesContext";
import { ToastProvider } from "./components/ui/Toast";
import { VersionCheck } from "./components/VersionCheck";
import { router } from "./router";
import "./index.css";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    },
});

/* 所有数据来自后端 API。 */
createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <AppProvider>
                <PreferencesProvider>
                    <ToastProvider>
                        <RouterProvider router={router} />
                    </ToastProvider>
                </PreferencesProvider>
            </AppProvider>
            {/* 新版本检测放在会话树之外：后端不可达/会话校验阻塞时同样生效，
                部署重启的窗口期用户仍能收到刷新提示 */}
            <VersionCheck />
        </QueryClientProvider>
    </StrictMode>,
);

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
            {/* 版本强制更新：挂在会话树外（后端不可达时同样生效）；遮罩 portal 到 body，
                与应用树的相对位置无布局影响 */}
            <VersionCheck />
            <AppProvider>
                <PreferencesProvider>
                    <ToastProvider>
                        <RouterProvider router={router} />
                    </ToastProvider>
                </PreferencesProvider>
            </AppProvider>
        </QueryClientProvider>
    </StrictMode>,
);

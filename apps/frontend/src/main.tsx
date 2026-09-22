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
            {/* 版本检测：挂在会话树外（后端不可达时同样生效），且必须位于应用树之前——
                横幅留在文档流顶部才能推下整个应用并在滚动时吸顶 */}
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

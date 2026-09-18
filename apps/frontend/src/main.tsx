import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProvider } from "./context/AppContext";
import { ToastProvider } from "./components/ui/Toast";
import { router } from "./router";
import "./index.css";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    },
});

/* Mock 开关：默认直连真实后端；仅开发模式显式 VITE_ENABLE_MSW=true 才启用 MSW
 * （后端未就绪时离线开发用）。生产构建无论配置如何一律禁止 mock——
 * import.meta.env.PROD 在构建期被静态替换，动态 import 分支不可达，msw 不会进产物。 */
async function enableMocking() {
    if (import.meta.env.PROD) return;
    if (import.meta.env.VITE_ENABLE_MSW !== "true") return;
    const { worker } = await import("../mocks/browser");
    await worker.start({ onUnhandledRequest: "bypass" });
}

enableMocking().finally(() => {
    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            <QueryClientProvider client={queryClient}>
                <AppProvider>
                    <ToastProvider>
                        <RouterProvider router={router} />
                    </ToastProvider>
                </AppProvider>
            </QueryClientProvider>
        </StrictMode>,
    );
});

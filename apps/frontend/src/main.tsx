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

/* Mock 开关：仅开发模式启用（VITE_ENABLE_MSW=false 可强制关闭以联调真实后端）。
 * 动态 import 保证 msw 不进生产包。 */
async function enableMocking() {
    if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_MSW === "false") return;
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

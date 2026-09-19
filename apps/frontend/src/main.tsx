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

/* 所有数据来自后端 API。 */
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

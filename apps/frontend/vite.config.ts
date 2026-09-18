import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss()],
    // env 统一在仓库根 .env（仅 VITE_ 前缀变量会暴露给客户端代码）
    envDir: "../../",
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    // 联调真实后端（zmsys-backend）：auth/roles/users 走代理打到 127.0.0.1:5000，
    // 未实现的业务端点继续由 MSW mock 兜底（onUnhandledRequest: bypass 穿透）
    server: {
        proxy: {
            "/api": { target: "http://127.0.0.1:5000", changeOrigin: true },
        },
    },
});

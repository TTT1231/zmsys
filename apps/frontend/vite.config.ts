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
    // 全部 /api 请求代理到真实后端（apps/backend:5000）；MSW 仅开发模式显式
    // VITE_ENABLE_MSW=true 时启用，生产构建一律禁止 mock
    server: {
        proxy: {
            "/api": { target: "http://127.0.0.1:5000", changeOrigin: true },
        },
    },
});

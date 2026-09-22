import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

/* 构建标识：每次构建生成唯一值注入 index.html <meta name="app-build-id">。
   VersionCheck 运行时拉取线上 index.html 对比该标识判断是否发了新版本
   （不比对 ETag/Last-Modified：部署链路保留 mtime 且体积可能不变，头不会变） */
function appBuildId(): Plugin {
    const buildId = Date.now().toString(36);
    return {
        name: "inject-app-build-id",
        transformIndexHtml() {
            return [{ tag: "meta", attrs: { name: "app-build-id", content: buildId } }];
        },
    };
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss(), appBuildId()],
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

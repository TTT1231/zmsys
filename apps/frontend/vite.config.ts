import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { envSchema } from "./src/env.schema.ts";

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
export default defineConfig(({ mode }) => {
    // VITE_ 变量在构建期被静态替换进产物：与运行时（src/env.ts）同一 schema 校验，
    // 非法值在 dev/build 启动即失败，而不是等页面加载白屏
    envSchema.parse(loadEnv(mode, fileURLToPath(new URL("../../", import.meta.url)), "VITE_"));

    return {
        plugins: [react(), tailwindcss(), appBuildId()],
        // env 统一在仓库根 .env（仅 VITE_ 前缀变量会暴露给客户端代码）
        envDir: "../../",
        resolve: {
            alias: {
                "@": fileURLToPath(new URL("./src", import.meta.url)),
            },
        },
        // 全部 /api 请求代理到真实后端（apps/backend:5000）
        server: {
            proxy: {
                "/api": { target: "http://127.0.0.1:5000", changeOrigin: true },
            },
        },
    };
});

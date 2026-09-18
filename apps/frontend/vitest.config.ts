import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 独立于 vite.config.ts：vitest 只读此文件，测试管线不加载 tailwind 等应用插件。
// 单元测试默认跑在 node 环境；组件测试文件顶部用 `// @vitest-environment jsdom` 注释切换。
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    test: {
        environment: "node",
        coverage: {
            provider: "v8",
            include: ["src/**/*.{ts,tsx}", "mocks/**/*.ts"],
        },
    },
});

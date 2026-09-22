import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 独立于 vite.config.ts：vitest 只读此文件，测试管线不加载 tailwind 等应用插件。
// 单元测试默认跑在 node 环境；组件测试文件顶部用 `// @vitest-environment jsdom` 注释切换。
export default defineConfig({
    plugins: [react()],
    envDir: "../../",
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    test: {
        environment: "node",
        // 固定业务时区：formatDateTime 按本地时区渲染带偏移的 ISO 时间戳，
        // CI runner 在 UTC 下断言会漂移 8 小时，测试一律按 +08:00 断言。
        env: { TZ: "Asia/Shanghai" },
        // 保持默认 isolate: true：关闭隔离会让测试文件共享模块注册表，
        // vi.mock 偶发失效（CI 冷缓存下复现为 "No QueryClient set"）。
        // vitest 提示的 "~4s/文件启动" 是重叠并行的，实测全量仅多 ~15s。
        coverage: {
            provider: "v8",
            include: ["src/**/*.{ts,tsx}"],
        },
    },
});

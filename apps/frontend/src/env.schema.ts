import { z } from "zod";

/**
 * 前端环境变量契约：根 .env 中仅 VITE_ 前缀变量会被 Vite 注入（其余属于后端，
 * 绝不能进入客户端包）。本文件是类型与校验的唯一事实源——vite-env.d.ts 的
 * ImportMetaEnv 据此推导，vite.config.ts 构建期与 src/env.ts 运行时用同一
 * schema 校验。新增变量须同步三处：此处、src/env.ts 的 raw 枚举、根 .env.example。
 * 保持纯定义（无 import.meta 引用）：node 侧的 vite.config.ts 也能安全引入。
 */
export const envSchema = z.object({
    /** API 基础路径，默认 /api（dev 由 Vite 代理到 backend:5000） */
    VITE_API_BASE_URL: z.string().default("/api"),
});

export type FrontendEnv = z.infer<typeof envSchema>;

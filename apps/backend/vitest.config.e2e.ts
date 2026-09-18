import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        globals: true,
        root: './',
        include: ['**/*.e2e-spec.ts'],
        // 与 src/process-tz.ts 一致：mariadb driver 按 Node 本地时区解释 DATETIME 字面量
        env: { TZ: 'UTC' },
        // 并发专项（死锁/取号）对时序敏感，e2e 文件间禁止并行
        fileParallelism: false,
    },
});

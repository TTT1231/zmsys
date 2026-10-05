import { defineConfig } from "vitest/config";

export default defineConfig({
    // Resolves the path aliases declared in tsconfig.json, including the ones
    // added by `nest g library`.
    resolve: {
        tsconfigPaths: true,
    },
    test: {
        globals: true,
        root: "./",
        include: ["**/*.spec.ts"],
        env: {
            TZ: "UTC",
            // 单测不连库，但 openapi-coverage 会编译整个 AppModule，配置契约校验
            // 要求以下变量存在（CI checkout 没有 gitignored 的根 .env；
            // NODE_ENV 由 vitest 自动设为 test，不触发生产专属校验）
            JWT_SECRET: "unit-test-secret-0123456789abcdef0123456789",
            DB_HOST: "127.0.0.1",
            DB_USERNAME: "unit-test",
            DB_PASSWORD: "unit-test",
            DB_DATABASE: "unit-test",
        },
    },
});

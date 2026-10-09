import "./process-tz";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { AppModule } from "./app.module";
import { DEFAULT_NODE_ENV, type AppConfig } from "./configuration";
import { MAX_UPLOAD_BYTES } from "./system/system.service";

/** 请求日志脱敏：绝不记录凭据类头与字段 */
const LOG_REDACT_PATHS = [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.body.password",
    "req.body.oldPassword",
    "req.body.newPassword",
    'res.headers["set-cookie"]',
];

/** 与生产一致的 HTTP 管线配置；e2e 复用，避免测试与真实管线漂移 */
export function configureApp(app: NestFastifyApplication, corsOrigins: string[] = []): void {
    app.setGlobalPrefix("api");
    // 未知字段拒绝（db-scheme.md §1.4：API 层负责未知字段拒绝）
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );
    if (corsOrigins.length > 0) {
        // Fastify 插件为链式注册，统一在 ready()/listen() 时结算，无需在此等待
        void app.register(cors, { origin: corsOrigins, credentials: true });
    }
    // 恢复文件上传：512MiB/1 文件，字段大小另限（db-scheme.md §10.1）
    void app.register(multipart, {
        limits: {
            fileSize: MAX_UPLOAD_BYTES,
            files: 1,
            fields: 8,
            fieldSize: 64 * 1024,
        },
    });
}

async function bootstrap() {
    // 与 configuration 同一兜底：未显式设置时按生产运行（dist 即生产构建）
    const isProduction = (process.env.NODE_ENV ?? DEFAULT_NODE_ENV) === "production";
    const app = await NestFactory.create<NestFastifyApplication>(
        AppModule,
        new FastifyAdapter({
            // Fastify 原生 pino：结构化 JSON、自带 reqId 请求日志；开发用 pretty 格式化
            logger: {
                level: isProduction ? "info" : "debug",
                redact: { paths: LOG_REDACT_PATHS, censor: "[REDACTED]" },
                ...(isProduction
                    ? {}
                    : { transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } } }),
            },
            // 大文件上传/完整预检/流式备份不受请求超时约束（nginx 层 1800s 兜底）
            requestTimeout: 0,
        }),
    );
    void app.register(helmet);
    const config = app.get(ConfigService<AppConfig>);
    configureApp(app, config.getOrThrow("cors.origins", { infer: true }));
    // SIGINT/SIGTERM 触发 onModuleDestroy 链（Prisma disconnect + mariadb 池关闭）
    app.enableShutdownHooks();
    const port = config.getOrThrow("server.port", { infer: true });
    const host = config.getOrThrow("server.host", { infer: true });
    await app.listen(port, host);
}

// 仅作为主模块运行时启动（node dist/main）；e2e 只 import configureApp，
// 此前模块顶层直接调用会在测试进程里隐式监听真实端口（多 spec 并行时 EADDRINUSE）
if (typeof require !== "undefined" && require.main === module) {
    void bootstrap();
}

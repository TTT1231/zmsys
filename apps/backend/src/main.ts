import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';

/** 与生产一致的 HTTP 管线配置；e2e 复用，避免测试与真实管线漂移 */
export function configureApp(app: NestFastifyApplication): void {
    app.setGlobalPrefix('api');
    // 未知字段拒绝（db-scheme.md §1.4：API 层负责未知字段拒绝）
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );
}

async function bootstrap() {
    const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
    app.register(helmet);
    configureApp(app);
    const port = Number.parseInt(process.env.PORT ?? '5000', 10) || 5000;
    await app.listen(port);
}
bootstrap();

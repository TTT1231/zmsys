/**
 * Web 层基础设施 e2e：健康探针、CORS、登录限流、请求日志脱敏。
 * ready 503 用例通过 mock 健康探针 provider 验证——Prisma 在 onModuleInit
 * 主动连接，坏连接串会让应用根本起不来，无法经 HTTP 触发 503。
 */
import './db-guard';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { HealthModule } from '../src/health/health.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoginThrottleGuard } from '../src/common/guards/login-throttle.guard';

describe('Web 层基础设施 (e2e)', () => {
    let app: NestFastifyApplication;
    const logLines: string[] = [];

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(
            new FastifyAdapter({
                // 捕获日志行用于脱敏断言（生产走 stdout，测试收集到内存流）
                logger: { level: 'info', stream: { write: (chunk: string) => logLines.push(chunk) } },
            }),
        );
        configureApp(app, ['http://localhost:5173']);
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    it('health/live 返回 200（不触数据库）', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/health/live' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ code: 0, data: { status: 'ok' }, message: 'ok' });
    });

    it('health/ready 数据库正常时返回 200', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/health/ready' });
        expect(res.statusCode).toBe(200);
    });

    it('CORS：白名单 origin 的预检返回允许头', async () => {
        const res = await app.inject({
            method: 'OPTIONS',
            url: '/api/auth/login',
            headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
        });
        expect(res.statusCode).toBeLessThan(400);
        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    it('登录限流：超阈值后返回 429 信封', async () => {
        const originalMax = LoginThrottleGuard.maxAttempts;
        LoginThrottleGuard.maxAttempts = 2;
        try {
            for (let i = 0; i < 2; i++) {
                const res = await app.inject({
                    method: 'POST',
                    url: '/api/auth/login',
                    payload: { account: 'nobody', password: 'wrong' },
                });
                expect(res.statusCode).toBe(400); // 限流内的正常失败（凭据错误）
            }
            const throttled = await app.inject({
                method: 'POST',
                url: '/api/auth/login',
                payload: { account: 'nobody', password: 'wrong' },
            });
            expect(throttled.statusCode).toBe(429);
            expect(throttled.json()).toEqual({ code: 429, data: null, message: '登录尝试过于频繁，请稍后再试' });
        } finally {
            LoginThrottleGuard.maxAttempts = originalMax;
        }
    });

    it('请求日志不含 Authorization 与 password 值（脱敏）', async () => {
        const token = (
            await app.inject({
                method: 'POST',
                url: '/api/auth/login',
                payload: { account: 'guojun', password: '123456' },
            })
        ).json().data.accessToken as string;
        await app.inject({
            method: 'GET',
            url: '/api/auth/profile',
            headers: { authorization: `Bearer ${token}` },
        });

        const allLogs = logLines.join('\n');
        expect(allLogs.length).toBeGreaterThan(0);
        expect(allLogs).not.toContain(token);
        expect(allLogs).not.toContain('123456');
    });
});

describe('health/ready 数据库不可用 (e2e, mock 探针)', () => {
    it('SELECT 1 抛错时返回 503 信封', async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [HealthModule, PrismaModule] })
            .overrideProvider(PrismaService)
            .useValue({
                $queryRaw: async () => {
                    throw new Error('connection refused');
                },
            })
            .compile();
        const app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();

        const res = await app.inject({ method: 'GET', url: '/api/health/ready' });
        expect(res.statusCode).toBe(503);
        expect(res.json().message).toBe('数据库不可用');
        await app.close();
    });
});

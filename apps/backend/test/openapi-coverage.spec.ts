/**
 * 契约漂移检查（最小实现）：后端注册路由（HTTP method + route）必须 ⊆ 契约 paths。
 * 不比对 schema 细节；/health/* 等基础设施路由白名单。
 * 契约路径经 CONTRACT_PATH 可配置，默认 ../admin-manage/docs/api/openapi.yaml
 * （CI 两仓库分发未解决前，路径缺失时整体 skip）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

const CONTRACT_PATH =
    process.env.CONTRACT_PATH ?? join(__dirname, '..', '..', 'admin-manage', 'docs', 'api', 'openapi.yaml');

/** Nest 稳定内部元数据键：路由装饰器写入的 path / method */
const PATH_METADATA = '__path__';
const METHOD_METADATA = '__method__';

/** 基础设施路由（不在业务契约内） */
const INFRA_WHITELIST = new Set(['GET /health/live', 'GET /health/ready']);

const METHOD_NAMES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ALL'] as const;

const contractExists = existsSync(CONTRACT_PATH);

describe('OpenAPI 契约覆盖（method + route 漂移）', () => {
    describe.skipIf(!contractExists)(`契约文件 ${contractExists ? CONTRACT_PATH : '（缺失，跳过）'}`, () => {
        let app: NestFastifyApplication;

        beforeAll(async () => {
            const moduleFixture = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] }).compile();
            app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
            configureApp(app);
            await app.init();
        });

        afterAll(async () => {
            await app.close();
        });

        it('后端注册路由 ⊆ 契约 paths（白名单除外）', async () => {
            const contract = parse(readFileSync(CONTRACT_PATH, 'utf8')) as {
                paths: Record<string, Record<string, unknown>>;
            };
            const contractRoutes = new Set<string>();
            for (const [path, operations] of Object.entries(contract.paths ?? {})) {
                for (const method of Object.keys(operations)) {
                    if (METHOD_NAMES.includes(method.toUpperCase() as (typeof METHOD_NAMES)[number])) {
                        contractRoutes.add(`${method.toUpperCase()} ${path}`);
                    }
                }
            }

            const discovery = app.get(DiscoveryService);
            const backendRoutes = new Set<string>();
            for (const wrapper of await discovery.getControllers()) {
                const metatype = wrapper.metatype;
                if (!metatype) {
                    continue;
                }
                const prefix = Reflect.getMetadata(PATH_METADATA, metatype) as string | string[] | undefined;
                const prefixText = Array.isArray(prefix) ? prefix[0] : (prefix ?? '');
                const prototype = metatype.prototype;
                for (const methodName of Object.getOwnPropertyNames(prototype)) {
                    if (methodName === 'constructor') {
                        continue;
                    }
                    const methodValue = Reflect.getMetadata(METHOD_METADATA, prototype, methodName) as
                        number | undefined;
                    if (methodValue === undefined) {
                        continue;
                    }
                    const routePath = Reflect.getMetadata(PATH_METADATA, prototype, methodName) as
                        string | string[] | undefined;
                    const routeText = Array.isArray(routePath) ? routePath[0] : (routePath ?? '');
                    const httpMethod = METHOD_NAMES[methodValue] ?? 'ALL';
                    const normalized = `${prefixText}/${routeText}`.replace(/\/+/g, '/').replace(/\/$/, '');
                    backendRoutes.add(`${httpMethod} ${normalized === '' ? '/' : normalized}`);
                }
            }

            const violations = [...backendRoutes].filter(
                route => !INFRA_WHITELIST.has(route) && !contractRoutes.has(route),
            );
            expect(violations.length === 0 ? '' : `以下路由未在契约中声明：\n${violations.join('\n')}`).toBe('');
        });
    });
});

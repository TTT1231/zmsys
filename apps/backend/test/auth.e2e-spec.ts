/**
 * 认证与授权底座集成测试：真实 HTTP 管线 + 真实数据库（zmdb 种子数据）。
 * 仅执行幂等操作（登录/读取），不修改种子账号状态；
 * 依赖 .env 的 DB_* 指向本地 MariaDB 且已执行 prisma db seed。
 */
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

describe('认证与授权底座 (e2e)', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        // 必须显式传入 FastifyAdapter，测试默认创建的是 Express 适配器
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    async function login(account: string, password: string): Promise<string> {
        const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { account, password } });
        expect(res.statusCode).toBe(200);
        return res.json().data.accessToken;
    }

    it('无 token 访问受保护端点返回 401 信封', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/auth/profile' });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ code: 401, data: null, message: '登录已过期，请重新登录' });
    });

    it('错误密码登录返回 400，不泄露账号存在性', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/auth/login',
            payload: { account: 'guojun', password: 'wrong-password' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ code: 400, data: null, message: '账号或密码错误' });
    });

    it('请求体携带未知字段被拒绝（forbidNonWhitelisted）', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/auth/login',
            payload: { account: 'guojun', password: '123456', hack: '1' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toContain('hack');
    });

    it('super 登录成功返回信封与用户信息', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/auth/login',
            payload: { account: 'guojun', password: '123456' },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.code).toBe(0);
        expect(body.message).toBe('ok');
        expect(body.data.accessToken).toBeTruthy();
        expect(body.data.user).toMatchObject({ account: 'guojun', name: '郭均', role: 'super', active: true });
    });

    it('super 的 profile 返回全量授权（含受保护菜单）', async () => {
        const token = await login('guojun', '123456');
        const res = await app.inject({
            method: 'GET',
            url: '/api/auth/profile',
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const grant = res.json().data.grant;
        expect(grant.menus).toContain('permissions');
        expect(grant.menus.length).toBeGreaterThan(5);
    });

    it('无 permissions:view 的角色访问 /roles 返回 403', async () => {
        const token = await login('test', '123456');
        const res = await app.inject({
            method: 'GET',
            url: '/api/roles',
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ code: 403, data: null, message: '无权查看角色' });
    });

    it('super 访问角色目录返回 5 个固定角色', async () => {
        const token = await login('guojun', '123456');
        const res = await app.inject({
            method: 'GET',
            url: '/api/roles',
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.map((role: { id: string }) => role.id)).toEqual([
            'super',
            'admin',
            'warehouse',
            'sales',
            'staff',
        ]);
    });

    it('保存未知角色授权返回 404', async () => {
        const token = await login('guojun', '123456');
        const res = await app.inject({
            method: 'PUT',
            url: '/api/roles/hacker/grants',
            headers: { authorization: `Bearer ${token}` },
            payload: { grant: { version: 1, menus: [], actions: {} }, expectedVersion: 1, note: '' },
        });
        expect(res.statusCode).toBe(404);
        expect(res.json().message).toBe('角色不存在');
    });

    it('幂等退出始终返回成功空信封', async () => {
        const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ code: 0, data: null, message: 'ok' });
    });
});

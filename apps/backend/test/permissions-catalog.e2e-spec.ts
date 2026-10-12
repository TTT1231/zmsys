/**
 * 权限目录保护开关集成测试：真实 HTTP 管线 + 真实测试库（*_test 种子数据）。
 * 会真实解锁/加锁受保护码并保存 admin 授权（走完行锁 → 加锁清理授权行 →
 * 全角色版本递增 → 审计链路），afterAll 恢复默认受保护态与 admin 原授权；
 * ensureProtection 先读目录再切换，未重置库重跑亦安全。
 * 运行前置：pnpm test:db:reset（test:e2e 已串联）。
 */
import "./db-guard";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import type { PermissionCatalogEntry, RoleGrant } from "../src/roles/types";

/** 本用例动过受保护态的码全集（afterAll 兜底恢复默认加锁） */
const TOUCHED_CODES = [
    "menu:system-logs",
    "system-logs:view",
    "menu:permissions",
    "menu:permissions-accounts",
    "menu:permissions-roles",
    "menu:permissions-matrix",
    "permissions:view",
    "permissions:manage",
];

describe("权限目录与保护开关 (e2e)", () => {
    let app: NestFastifyApplication;
    let superToken: string;
    let staffToken: string;
    let e2eAdminToken = "";
    let adminOriginalGrant: RoleGrant;

    const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });
    const superHeaders = () => authHeaders(superToken);

    async function login(account: string, password: string): Promise<string> {
        const res = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account, password },
        });
        expect(res.statusCode).toBe(200);
        return res.json().data.accessToken;
    }

    async function getCatalog(): Promise<PermissionCatalogEntry[]> {
        const res = await app.inject({ method: "GET", url: "/api/permissions/catalog", headers: superHeaders() });
        expect(res.statusCode).toBe(200);
        return res.json().data;
    }

    /** 幂等切换：先读目录，已处于目标态则跳过（重跑安全） */
    async function ensureProtection(code: string, next: boolean, reason: string): Promise<void> {
        const current = (await getCatalog()).find(entry => entry.code === code);
        expect(current, `目录缺少 ${code}`).toBeDefined();
        if (current!.protected === next) return;
        const res = await app.inject({
            method: "PATCH",
            url: `/api/permissions/catalog/${encodeURIComponent(code)}/protected`,
            headers: superHeaders(),
            payload: { protected: next, reason },
        });
        expect(res.statusCode, `切换 ${code} → ${next}`).toBe(200);
        expect(res.json().data.protected).toBe(next);
    }

    async function fetchGrant(roleId: string): Promise<RoleGrant> {
        const res = await app.inject({ method: "GET", url: "/api/roles/grants", headers: superHeaders() });
        expect(res.statusCode).toBe(200);
        return res.json().data[roleId];
    }

    async function saveGrant(roleId: string, grant: RoleGrant, note: string) {
        return app.inject({
            method: "PUT",
            url: `/api/roles/${roleId}/grants`,
            headers: superHeaders(),
            payload: { grant, expectedVersion: grant.version, note },
        });
    }

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        superToken = await login("guojun", "123456");
        staffToken = await login("test", "123456");
        adminOriginalGrant = await fetchGrant("admin");
    });

    afterAll(async () => {
        // 先恢复默认受保护态（加锁清理会自动收回本用例授予的行），再整组恢复 admin 原授权
        for (const code of TOUCHED_CODES) {
            await ensureProtection(code, true, "e2e 清理：恢复默认受保护");
        }
        const current = await fetchGrant("admin");
        await saveGrant("admin", { ...adminOriginalGrant, version: current.version }, "e2e 清理：恢复 admin 授权");
        await app.close();
    });

    it("目录下发运行时受保护状态；profile 携带 protectedCodes；读取受 permissions:view 保护", async () => {
        const catalog = await getCatalog();
        expect(catalog.find(item => item.code === "menu:system-logs")?.protected).toBe(true);

        const profile = await app.inject({ method: "GET", url: "/api/auth/profile", headers: superHeaders() });
        expect(profile.statusCode).toBe(200);
        expect(profile.json().data.protectedCodes).toContain("menu:system-logs");

        const staffRes = await app.inject({
            method: "GET",
            url: "/api/permissions/catalog",
            headers: authHeaders(staffToken),
        });
        expect(staffRes.statusCode).toBe(403);
    });

    it("super 解锁 → 目录反映 + 审计记录解锁", async () => {
        await ensureProtection("menu:system-logs", false, "e2e 解锁系统日志");
        await ensureProtection("system-logs:view", false, "e2e 解锁系统日志查看");
        expect((await getCatalog()).find(item => item.code === "menu:system-logs")?.protected).toBe(false);

        const logRes = await app.inject({
            method: "GET",
            url: "/api/permissions/catalog/log",
            headers: superHeaders(),
        });
        expect(logRes.statusCode).toBe(200);
        expect(logRes.json().data[0].text).toContain("已解锁");
    });

    it("解锁后可授予其他角色（saveGrant 不再拒绝）", async () => {
        const grant = await fetchGrant("admin");
        const res = await saveGrant(
            "admin",
            {
                version: grant.version,
                menus: [...grant.menus, "system-logs"],
                actions: { ...grant.actions, "system-logs": ["view"] },
            },
            "e2e 授予系统日志",
        );
        expect(res.statusCode).toBe(200);
        expect((await fetchGrant("admin")).menus).toContain("system-logs");
    });

    it("被授权角色真实可访问系统日志接口", async () => {
        // 种子只有 super/staff，创建临时 admin 用户验证（重跑时账号已存在返回 409）
        const created = await app.inject({
            method: "POST",
            url: "/api/users",
            headers: { ...superHeaders(), "idempotency-key": "e2e-prot-adm-0001" },
            payload: { name: "保护开关测试", account: "e2e_protection", role: "admin" },
        });
        expect([200, 409]).toContain(created.statusCode);

        e2eAdminToken = await login("e2e_protection", "123456");
        const res = await app.inject({ method: "GET", url: "/api/system-logs", headers: authHeaders(e2eAdminToken) });
        expect(res.statusCode).toBe(200);
    });

    it("重新加锁：同事务清理授权行，已登录角色立即 403（grant_version 递增失效缓存）", async () => {
        await ensureProtection("system-logs:view", true, "e2e 重新加锁系统日志查看");
        await ensureProtection("menu:system-logs", true, "e2e 重新加锁系统日志");

        expect((await fetchGrant("admin")).menus).not.toContain("system-logs");
        // 旧 token 无需重登录：JwtStrategy 缓存按 grant_version 失效后即拒
        const res = await app.inject({ method: "GET", url: "/api/system-logs", headers: authHeaders(e2eAdminToken) });
        expect(res.statusCode).toBe(403);

        const logRes = await app.inject({
            method: "GET",
            url: "/api/permissions/catalog/log",
            headers: superHeaders(),
        });
        const latest = logRes.json().data[0];
        expect(latest.text).toContain("已加锁");
        expect(latest.text).toContain("清理 1 条授权");
    });

    it("仅 super 角色可切换：staff 与持 permissions:manage 的非 super 均 403（防自我提权）", async () => {
        const patchAs = (token: string, code: string, next: boolean) =>
            app.inject({
                method: "PATCH",
                url: `/api/permissions/catalog/${encodeURIComponent(code)}/protected`,
                headers: authHeaders(token),
                payload: { protected: next, reason: "e2e 越权尝试" },
            });

        const staffRes = await patchAs(staffToken, "orders:delete", false);
        expect(staffRes.statusCode).toBe(403);
        expect(staffRes.json().message).toBe("仅超级管理员可调整受保护权限");

        // 解锁用户与权限全家桶并授予 admin：admin 持 permissions:manage 后仍不能切换
        for (const code of TOUCHED_CODES.slice(2)) {
            await ensureProtection(code, false, "e2e 解锁用户与权限（防提权用例）");
        }
        const grant = await fetchGrant("admin");
        const res = await saveGrant(
            "admin",
            {
                version: grant.version,
                menus: [
                    ...grant.menus,
                    "permissions",
                    "permissions-accounts",
                    "permissions-roles",
                    "permissions-matrix",
                ],
                actions: { ...grant.actions, permissions: ["view", "manage"] },
            },
            "e2e 授予用户与权限（防提权用例）",
        );
        expect(res.statusCode).toBe(200);

        const adminRes = await patchAs(e2eAdminToken, "orders:delete", false);
        expect(adminRes.statusCode).toBe(403);
        expect(adminRes.json().message).toBe("仅超级管理员可调整受保护权限");

        // 重新加锁：同事务清理自动收回 admin 的 permissions 系授权（自愈）
        for (const code of TOUCHED_CODES.slice(2).reverse()) {
            await ensureProtection(code, true, "e2e 清理：重新加锁用户与权限");
        }
        expect((await fetchGrant("admin")).menus).not.toContain("permissions");
    });

    it("saveGrant 仍拒绝受保护码（纵深防御回归）", async () => {
        const grant = await fetchGrant("warehouse");
        const res = await saveGrant(
            "warehouse",
            {
                version: grant.version,
                menus: grant.menus,
                actions: { ...grant.actions, orders: [...(grant.actions.orders ?? []), "delete"] },
            },
            "e2e 受保护码回归",
        );
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toBe("受保护权限只能由超级管理员持有");
    });

    it("同态切换 400、未知码 404", async () => {
        const sameState = await app.inject({
            method: "PATCH",
            url: `/api/permissions/catalog/${encodeURIComponent("orders:delete")}/protected`,
            headers: superHeaders(),
            payload: { protected: true, reason: "e2e 同态" },
        });
        expect(sameState.statusCode).toBe(400);

        const unknown = await app.inject({
            method: "PATCH",
            url: `/api/permissions/catalog/${encodeURIComponent("menu:moon")}/protected`,
            headers: superHeaders(),
            payload: { protected: false, reason: "e2e 未知码" },
        });
        expect(unknown.statusCode).toBe(404);
    });
});

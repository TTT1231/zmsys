/**
 * 角色授权集成测试：真实 HTTP 管线 + 真实测试库（*_test 种子数据）。
 * 会真实保存 warehouse 授权（走完行锁 → 整组替换 → 版本递增 → 日志链路），
 * 用后恢复种子授权，版本递增不回退但无碍重跑（每次先读当前版本）；
 * 运行前置：pnpm test:db:reset（test:e2e 已串联）。
 */
import "./db-guard";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import type { RoleGrant } from "../src/roles/types";

describe("角色授权 (e2e)", () => {
    let app: NestFastifyApplication;
    let superToken: string;
    const authHeaders = () => ({ authorization: `Bearer ${superToken}` });

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        const login = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: "guojun", password: "123456" },
        });
        superToken = login.json().data.accessToken;
    });

    afterAll(async () => {
        await app.close();
    });

    async function fetchGrant(roleId: string): Promise<RoleGrant> {
        const res = await app.inject({ method: "GET", url: "/api/roles/grants", headers: authHeaders() });
        expect(res.statusCode).toBe(200);
        return res.json().data[roleId];
    }

    async function saveGrant(grant: RoleGrant, note: string): Promise<RoleGrant> {
        const res = await app.inject({
            method: "PUT",
            url: "/api/roles/warehouse/grants",
            headers: authHeaders(),
            payload: { grant, expectedVersion: grant.version, note },
        });
        expect(res.statusCode).toBe(200);
        return res.json().data;
    }

    it("保存授权走完行锁事务并递增版本（回归：sys_role 无 id 列，SELECT id 锁行曾 1054 → 500）", async () => {
        const before = await fetchGrant("warehouse");
        // 真实变更（toggle 仅挂菜单、无动作的 stock）触发 deleteMany/createMany 与版本递增；
        // 按当前状态取反，保证未重置库重跑时也是真实变更而非 no-op
        const hadStock = before.menus.includes("stock");
        const changed: RoleGrant = {
            version: before.version,
            menus: hadStock ? before.menus.filter(menu => menu !== "stock") : [...before.menus, "stock"],
            actions: before.actions,
        };
        const saved = await saveGrant(changed, `e2e 回归：${hadStock ? "移除" : "新增"}库存菜单`);
        expect(saved.version).toBe(before.version + 1);
        expect(saved.menus.includes("stock")).toBe(!hadStock);

        // 恢复原授权：expectedVersion 必须用保存后的新版本（乐观锁比对的是库内当前值）
        const restored = await saveGrant({ ...before, version: saved.version }, "e2e 回归：恢复库存菜单");
        expect(restored.version).toBe(saved.version + 1);
        expect((await fetchGrant("warehouse")).menus.includes("stock")).toBe(hadStock);
    });

    it("无变化保存不递增版本并记 no-op 日志", async () => {
        const before = await fetchGrant("warehouse");
        const saved = await saveGrant(before, "e2e no-op 保存");
        expect(saved.version).toBe(before.version);

        const logRes = await app.inject({ method: "GET", url: "/api/roles/grants/log", headers: authHeaders() });
        expect(logRes.statusCode).toBe(200);
        expect(logRes.json().data[0].text).toContain("授权保存（无变化）");
    });

    it("乐观锁版本不一致返回 409", async () => {
        const before = await fetchGrant("warehouse");
        const res = await app.inject({
            method: "PUT",
            url: "/api/roles/warehouse/grants",
            headers: authHeaders(),
            payload: { grant: before, expectedVersion: before.version + 100, note: "e2e 版本冲突" },
        });
        expect(res.statusCode).toBe(409);
        expect(res.json().message).toBe("角色授权已被其他人修改，请刷新后重试");
    });
});

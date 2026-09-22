/**
 * 用户管理集成测试：真实 HTTP 管线 + 真实测试库（*_test 种子数据）。
 * 会创建带随机前缀的账号与客户，写操作可通过唯一前缀重复执行（无需清理）；
 * 运行前置：pnpm test:db:reset（test:e2e 已串联）。
 */
import "./db-guard";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import { PrismaService } from "../src/prisma/prisma.service";

// 每次运行独立前缀：账号满足 ^[A-Za-z0-9_]{3,64}$，重跑不撞唯一约束
const RUN = Date.now().toString(36);
const accountOf = (name: string): string => `qa_${name}_${RUN}`;
const IDEM_KEY = `e2e-users-${RUN}-create`;
const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });

describe("用户管理 (e2e)", () => {
    let app: NestFastifyApplication;
    let prisma: PrismaService;
    let superToken: string;

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        prisma = app.get(PrismaService);
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

    async function createUser(account: string, role: string, idemKey = `e2e-${RUN}-${account}`): Promise<unknown> {
        const res = await app.inject({
            method: "POST",
            url: "/api/users",
            headers: { ...authHeaders(superToken), "idempotency-key": idemKey },
            payload: { name: `联调${account.split("_")[1] ?? "用户"}`, account, role },
        });
        expect(res.statusCode).toBe(200);
        return res.json().data;
    }

    it("非 super（无 permissions:view）访问用户列表返回 403", async () => {
        const login = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: "test", password: "123456" },
        });
        const res = await app.inject({
            method: "GET",
            url: "/api/users",
            headers: authHeaders(login.json().data.accessToken),
        });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ code: 403, data: null, message: "无权查看用户列表" });
    });

    it("super 列表包含种子账号且新用户从未登录显示破折号", async () => {
        const created = (await createUser(accountOf("staff01"), "staff")) as { account: string; last: string };
        expect(created).toMatchObject({ role: "staff", active: true });
        expect(created.last).toBe("—");
        const res = await app.inject({ method: "GET", url: "/api/users", headers: authHeaders(superToken) });
        expect(res.statusCode).toBe(200);
        const accounts = res.json().data.map((user: { account: string }) => user.account);
        expect(accounts).toContain("guojun");
        expect(accounts).toContain("test");
        expect(accounts).toContain(accountOf("staff01"));
    });

    it("缺少幂等键创建返回 400；非法角色（super）返回 400", async () => {
        const noKey = await app.inject({
            method: "POST",
            url: "/api/users",
            headers: authHeaders(superToken),
            payload: { name: "无键用户", account: accountOf("nokey"), role: "staff" },
        });
        expect(noKey.statusCode).toBe(400);
        expect(noKey.json().message).toContain("Idempotency-Key");

        const asSuper = await app.inject({
            method: "POST",
            url: "/api/users",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-${RUN}-super` },
            payload: { name: "越权超管", account: accountOf("hacker"), role: "super" },
        });
        expect(asSuper.statusCode).toBe(400);
    });

    it("新增用户初始密码 123456 可登录；重复账号返回 409", async () => {
        await createUser(accountOf("sales01"), "sales");
        const login = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: accountOf("sales01"), password: "123456" },
        });
        expect(login.statusCode).toBe(200);
        expect(login.json().data.user.role).toBe("sales");

        const duplicate = await app.inject({
            method: "POST",
            url: "/api/users",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-${RUN}-dup` },
            payload: { name: "重复账号", account: accountOf("sales01"), role: "sales" },
        });
        expect(duplicate.statusCode).toBe(409);
    });

    it("幂等键重放返回首次成功响应；同键不同请求体返回 409", async () => {
        const account = accountOf("idem");
        const first = await app.inject({
            method: "POST",
            url: "/api/users",
            headers: { ...authHeaders(superToken), "idempotency-key": IDEM_KEY },
            payload: { name: "幂等用户", account, role: "warehouse" },
        });
        expect(first.statusCode).toBe(200);
        const replay = await app.inject({
            method: "POST",
            url: "/api/users",
            headers: { ...authHeaders(superToken), "idempotency-key": IDEM_KEY },
            payload: { name: "幂等用户", account, role: "warehouse" },
        });
        expect(replay.statusCode).toBe(200);
        expect(replay.json().data).toEqual(first.json().data);

        const conflict = await app.inject({
            method: "POST",
            url: "/api/users",
            headers: { ...authHeaders(superToken), "idempotency-key": IDEM_KEY },
            payload: { name: "幂等用户2", account: accountOf("idem2"), role: "warehouse" },
        });
        expect(conflict.statusCode).toBe(409);
    });

    it("编辑未知用户 404；版本过期 409；改姓名成功版本 +1", async () => {
        const missing = await app.inject({
            method: "PUT",
            url: `/api/users/qa_ghost_${RUN}`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: 1, name: "幽灵", role: "staff" },
        });
        expect(missing.statusCode).toBe(404);

        const created = (await createUser(accountOf("clerk01"), "staff")) as { account: string; version: number };
        const stale = await app.inject({
            method: "PUT",
            url: `/api/users/${created.account}`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: created.version + 5, name: "旧版本", role: "staff" },
        });
        expect(stale.statusCode).toBe(409);

        const rename = await app.inject({
            method: "PUT",
            url: `/api/users/${created.account}`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: created.version, name: "职员甲", role: "staff" },
        });
        expect(rename.statusCode).toBe(200);
        expect(rename.json().data).toMatchObject({ name: "职员甲", version: created.version + 1 });
    });

    it("角色变更递增 token_version：旧 JWT 立即失效", async () => {
        await createUser(accountOf("clerk02"), "staff");
        const login = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: accountOf("clerk02"), password: "123456" },
        });
        const oldToken = login.json().data.accessToken;
        const list = await app.inject({ method: "GET", url: "/api/users", headers: authHeaders(superToken) });
        const target = list.json().data.find((user: { account: string }) => user.account === accountOf("clerk02"));

        const promote = await app.inject({
            method: "PUT",
            url: `/api/users/${target.account}`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: target.version, name: "职员乙", role: "admin" },
        });
        expect(promote.statusCode).toBe(200);

        const after = await app.inject({ method: "GET", url: "/api/auth/profile", headers: authHeaders(oldToken) });
        expect(after.statusCode).toBe(401);
    });

    it("super 不可停用、不可改角色", async () => {
        const list = await app.inject({ method: "GET", url: "/api/users", headers: authHeaders(superToken) });
        const superUser = list.json().data.find((user: { account: string }) => user.account === "guojun");
        const disable = await app.inject({
            method: "PATCH",
            url: "/api/users/guojun/status",
            headers: authHeaders(superToken),
            payload: { expectedVersion: superUser.version, active: false },
        });
        expect(disable.statusCode).toBe(400);

        const demote = await app.inject({
            method: "PUT",
            url: "/api/users/guojun",
            headers: authHeaders(superToken),
            payload: { expectedVersion: superUser.version, name: superUser.name, role: "admin" },
        });
        expect(demote.statusCode).toBe(400);
    });

    it("重置密码：版本过期 409；super 不可重置；成功后旧 JWT 失效可再登录", async () => {
        await createUser(accountOf("clerk04"), "staff");
        const login = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: accountOf("clerk04"), password: "123456" },
        });
        const oldToken = login.json().data.accessToken;
        const list = await app.inject({ method: "GET", url: "/api/users", headers: authHeaders(superToken) });
        const target = list.json().data.find((user: { account: string }) => user.account === accountOf("clerk04"));

        const stale = await app.inject({
            method: "POST",
            url: `/api/users/${target.account}/reset-password`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: target.version + 5 },
        });
        expect(stale.statusCode).toBe(409);

        const asSuper = await app.inject({
            method: "POST",
            url: "/api/users/guojun/reset-password",
            headers: authHeaders(superToken),
            payload: { expectedVersion: target.version },
        });
        expect(asSuper.statusCode).toBe(400);

        const reset = await app.inject({
            method: "POST",
            url: `/api/users/${target.account}/reset-password`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: target.version },
        });
        expect(reset.statusCode).toBe(200);
        expect(reset.json().data).toMatchObject({ account: target.account, version: target.version + 1 });

        const profile = await app.inject({ method: "GET", url: "/api/auth/profile", headers: authHeaders(oldToken) });
        expect(profile.statusCode).toBe(401);
        const relogin = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: accountOf("clerk04"), password: "123456" },
        });
        expect(relogin.statusCode).toBe(200);
    });

    it("停用后登录被拒、在途 JWT 失效；重新启用后可再登录", async () => {
        await createUser(accountOf("clerk03"), "staff");
        const login = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: accountOf("clerk03"), password: "123456" },
        });
        const token = login.json().data.accessToken;
        const list = await app.inject({ method: "GET", url: "/api/users", headers: authHeaders(superToken) });
        const target = list.json().data.find((user: { account: string }) => user.account === accountOf("clerk03"));

        const disable = await app.inject({
            method: "PATCH",
            url: `/api/users/${target.account}/status`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: target.version, active: false },
        });
        expect(disable.statusCode).toBe(200);
        expect(disable.json().data.active).toBe(false);

        const profile = await app.inject({ method: "GET", url: "/api/auth/profile", headers: authHeaders(token) });
        expect(profile.statusCode).toBe(401);
        const relogin = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: accountOf("clerk03"), password: "123456" },
        });
        expect(relogin.statusCode).toBe(400);

        const enable = await app.inject({
            method: "PATCH",
            url: `/api/users/${target.account}/status`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: disable.json().data.version, active: true },
        });
        expect(enable.statusCode).toBe(200);
        const finalLogin = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: accountOf("clerk03"), password: "123456" },
        });
        expect(finalLogin.statusCode).toBe(200);
    });

    describe("销售离岗移交", () => {
        it("仍有客户时未指定接任人拒绝；接任人校验；成功后原子移交并写历史", async () => {
            await createUser(accountOf("sales02"), "sales");
            const leaving = (await createUser(accountOf("sales03"), "sales")) as {
                account: string;
                version: number;
            };
            const guojun = await prisma.sysUser.findUniqueOrThrow({ where: { account: "guojun" } });
            const leaver = await prisma.sysUser.findUniqueOrThrow({ where: { account: leaving.account } });
            const receiver = await prisma.sysUser.findUniqueOrThrow({ where: { account: accountOf("sales02") } });
            const now = new Date();
            const customers = [101n, 102n].map(seq =>
                prisma.customTable.create({
                    data: {
                        id: leaver.id + seq,
                        customerCode: `CUS-${RUN}${seq}`,
                        name: `移交客户${seq}`,
                        contactPerson: "联系人",
                        contactPhone: "13800000000",
                        province: "广东省",
                        city: "深圳市",
                        address: "南山区",
                        ownerId: leaver.id,
                        payTerms: "",
                        rowVersion: 1n,
                        requestKey: `e2e-${RUN}-${seq}`,
                        createdBy: guojun.id,
                        updatedBy: guojun.id,
                        createdAt: now,
                    },
                }),
            );
            await Promise.all(customers);

            const noReplacement = await app.inject({
                method: "PUT",
                url: `/api/users/${leaving.account}`,
                headers: authHeaders(superToken),
                payload: { expectedVersion: leaving.version, name: "离岗销售", role: "admin" },
            });
            expect(noReplacement.statusCode).toBe(400);
            expect(noReplacement.json().message).toContain("接任销售");

            const badReplacement = await app.inject({
                method: "PUT",
                url: `/api/users/${leaving.account}`,
                headers: authHeaders(superToken),
                payload: {
                    expectedVersion: leaving.version,
                    name: "离岗销售",
                    role: "admin",
                    replacementOwnerAccount: "guojun",
                    transferReason: "接任人不是销售",
                },
            });
            expect(badReplacement.statusCode).toBe(400);

            const transfer = await app.inject({
                method: "PUT",
                url: `/api/users/${leaving.account}`,
                headers: authHeaders(superToken),
                payload: {
                    expectedVersion: leaving.version,
                    name: "离岗销售",
                    role: "admin",
                    replacementOwnerAccount: accountOf("sales02"),
                    transferReason: "转岗离岗移交",
                },
            });
            expect(transfer.statusCode).toBe(200);
            expect(transfer.json().data.role).toBe("admin");

            const transferred = await prisma.customTable.findMany({
                where: { ownerId: receiver.id },
                orderBy: { id: "asc" },
            });
            expect(transferred).toHaveLength(2);
            const history = await prisma.customerOwnerHistory.findMany({
                where: { fromOwnerId: leaver.id },
            });
            expect(history).toHaveLength(2);
            expect(new Set(history.map(row => row.batchId)).size).toBe(1);
        });
    });

    it("负责人候选：customers:view 角色可见启用销售，staff 403", async () => {
        await createUser(accountOf("sales04"), "sales");
        const salesLogin = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: accountOf("sales01"), password: "123456" },
        });
        const salesToken = salesLogin.json().data.accessToken;
        const options = await app.inject({
            method: "GET",
            url: "/api/customer-owner-options",
            headers: authHeaders(salesToken),
        });
        expect(options.statusCode).toBe(200);
        const accounts = options.json().data.map((option: { account: string }) => option.account);
        expect(accounts).toContain(accountOf("sales01"));
        expect(accounts).toContain(accountOf("sales04"));
        expect(options.json().data[0]).toHaveProperty("name");

        const staffLogin = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: "test", password: "123456" },
        });
        const denied = await app.inject({
            method: "GET",
            url: "/api/customer-owner-options",
            headers: authHeaders(staffLogin.json().data.accessToken),
        });
        expect(denied.statusCode).toBe(403);
    });

    it("普通角色（admin）也不能触达用户管理端点", async () => {
        const admin = (await createUser(accountOf("admin01"), "admin")) as { account: string };
        const login = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account: admin.account, password: "123456" },
        });
        const token = login.json().data.accessToken;
        const list = await app.inject({ method: "GET", url: "/api/users", headers: authHeaders(token) });
        expect(list.statusCode).toBe(403);
        const create = await app.inject({
            method: "POST",
            url: "/api/users",
            headers: { ...authHeaders(token), "idempotency-key": `e2e-${RUN}-admin` },
            payload: { name: "越权", account: accountOf("hack01"), role: "staff" },
        });
        expect(create.statusCode).toBe(403);
    });
});

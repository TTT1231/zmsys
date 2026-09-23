/**
 * 客户档案集成测试：真实 HTTP 管线 + 真实测试库（*_test 种子数据）。
 * 账号与客户带随机前缀，写操作可重复执行；运行前置：pnpm test:db:reset。
 */
import "./db-guard";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import { PrismaService } from "../src/prisma/prisma.service";

const RUN = Date.now().toString(36);
const accountOf = (name: string): string => `qa_${name}_${RUN}`;
const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });

const customerInput = (ownerAccount: string) => ({
    name: `深圳市联调电子_${RUN}`,
    contact: "王经理",
    phone: "13800001111",
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    town: "粤海街道",
    address: `科技园 ${RUN.slice(-3)} 号`,
    ownerAccount,
    payTerms: "月结 30 天",
});

describe("客户档案 (e2e)", () => {
    let app: NestFastifyApplication;
    let prisma: PrismaService;
    let superToken: string;
    let salesAccount: string;
    let salesToken: string;

    const login = async (account: string): Promise<string> => {
        const res = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account, password: "123456" },
        });
        return res.json().data.accessToken;
    };

    const createUser = async (account: string, role: string): Promise<void> => {
        const res = await app.inject({
            method: "POST",
            url: "/api/users",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-${RUN}-${account}` },
            payload: { name: `联调${account.split("_")[1] ?? "用户"}`, account, role },
        });
        expect(res.statusCode).toBe(200);
    };

    const createCustomer = async (ownerAccount: string, idemKey: string) => {
        const res = await app.inject({
            method: "POST",
            url: "/api/customers",
            headers: { ...authHeaders(superToken), "idempotency-key": idemKey },
            payload: customerInput(ownerAccount),
        });
        return res;
    };

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        prisma = app.get(PrismaService);
        superToken = await login("guojun");

        salesAccount = accountOf("sales01");
        await createUser(salesAccount, "sales");
        salesToken = await login(salesAccount);
    });

    afterAll(async () => {
        await app.close();
    });

    it("staff 无 customers:view 返回 403；sales 可以查看列表与负责人候选", async () => {
        await createUser(accountOf("staff01"), "staff");
        const staffToken = await login(accountOf("staff01"));
        const denied = await app.inject({ method: "GET", url: "/api/customers", headers: authHeaders(staffToken) });
        expect(denied.statusCode).toBe(403);
        expect(denied.json()).toEqual({ code: 403, data: null, message: "无权查看客户列表" });

        const list = await app.inject({ method: "GET", url: "/api/customers", headers: authHeaders(salesToken) });
        expect(list.statusCode).toBe(200);
        const options = await app.inject({
            method: "GET",
            url: "/api/customer-owner-options",
            headers: authHeaders(salesToken),
        });
        expect(options.statusCode).toBe(200);
        const accounts = options.json().data.map((option: { account: string }) => option.account);
        expect(accounts).toContain(salesAccount);
    });

    it("创建成功：CUS- 全局取号、手机号只回掩码、完整号码落库、新客户为待跟进", async () => {
        const res = await createCustomer(salesAccount, `e2e-cust-${RUN}-create`);
        expect(res.statusCode).toBe(200);
        const created = res.json().data;
        expect(created.code).toMatch(/^CUS-[0-9]{4,}$/);
        expect(created.phone).toBe("138****1111");
        expect(created).toMatchObject({
            cooperation: "待跟进",
            ownerAccount: salesAccount,
            payTerms: "月结 30 天",
            version: 1,
        });
        const stored = await prisma.customTable.findUnique({ where: { customerCode: created.code } });
        expect(stored?.contactPhone).toBe("13800001111");
    });

    it("缺幂等键 400；负责人不存在 404；负责人非启用销售 400", async () => {
        const noKey = await app.inject({
            method: "POST",
            url: "/api/customers",
            headers: authHeaders(superToken),
            payload: customerInput(salesAccount),
        });
        expect(noKey.statusCode).toBe(400);

        const missingOwner = await createCustomer(`qa_ghost_${RUN}`, `e2e-cust-${RUN}-ghost`);
        expect(missingOwner.statusCode).toBe(404);
        expect(missingOwner.json().message).toBe("负责人账号不存在");

        await createUser(accountOf("staff02"), "staff");
        const notSales = await createCustomer(accountOf("staff02"), `e2e-cust-${RUN}-staff`);
        expect(notSales.statusCode).toBe(400);
        expect(notSales.json().message).toBe("客户负责人必须是启用中的销售或超级管理员账号");
    });

    it("幂等重放返回首次响应；同键不同请求体 409", async () => {
        const key = `e2e-cust-${RUN}-idem`;
        const first = await createCustomer(salesAccount, key);
        expect(first.statusCode).toBe(200);
        const replay = await createCustomer(salesAccount, key);
        expect(replay.statusCode).toBe(200);
        expect(replay.json().data).toEqual(first.json().data);
        // 同键不同体：地址不同 → 409
        const conflict = await app.inject({
            method: "POST",
            url: "/api/customers",
            headers: { ...authHeaders(superToken), "idempotency-key": key },
            payload: { ...customerInput(salesAccount), address: `科技园冲突 ${RUN} 号` },
        });
        expect(conflict.statusCode).toBe(409);
    });

    it("编辑：未知客户 404；版本过期 409；phone 空串保留原号码；负责人变化写移交历史", async () => {
        const created = (await createCustomer(salesAccount, `e2e-cust-${RUN}-edit`)).json().data;

        const missing = await app.inject({
            method: "PUT",
            url: "/api/customers/CUS-999999",
            headers: authHeaders(superToken),
            payload: { ...customerInput(salesAccount), expectedVersion: 1, phone: "" },
        });
        expect(missing.statusCode).toBe(404);

        const stale = await app.inject({
            method: "PUT",
            url: `/api/customers/${created.code}`,
            headers: authHeaders(superToken),
            payload: { ...customerInput(salesAccount), expectedVersion: 99, phone: "" },
        });
        expect(stale.statusCode).toBe(409);

        // phone 空串 = 保留原号码
        const kept = await app.inject({
            method: "PUT",
            url: `/api/customers/${created.code}`,
            headers: authHeaders(superToken),
            payload: { ...customerInput(salesAccount), expectedVersion: 1, phone: "", payTerms: "月结 60 天" },
        });
        expect(kept.statusCode).toBe(200);
        expect(kept.json().data).toMatchObject({ version: 2, phone: "138****1111", payTerms: "月结 60 天" });
        const beforeCount = await prisma.customerOwnerHistory.count({
            where: { customer: { customerCode: created.code } },
        });

        // 负责人变化：写移交历史
        const nextSales = accountOf("sales02");
        await createUser(nextSales, "sales");
        const transferred = await app.inject({
            method: "PUT",
            url: `/api/customers/${created.code}`,
            headers: authHeaders(superToken),
            payload: { ...customerInput(nextSales), expectedVersion: 2, phone: "13900002222" },
        });
        expect(transferred.statusCode).toBe(200);
        expect(transferred.json().data).toMatchObject({ version: 3, phone: "139****2222", ownerAccount: nextSales });
        const histories = await prisma.customerOwnerHistory.findMany({
            where: { customer: { customerCode: created.code } },
        });
        expect(histories).toHaveLength(beforeCount + 1);
        expect(histories[0]).toMatchObject({ reason: "编辑客户档案变更负责人" });
    });

    it("完整手机号：超管任意客户可取；销售仅本人负责客户，他人客户与管理员 403；未知客户 404", async () => {
        const mine = (await createCustomer(salesAccount, `e2e-cust-${RUN}-phone-mine`)).json().data;
        const otherSales = accountOf("sales03");
        await createUser(otherSales, "sales");
        const theirs = (await createCustomer(otherSales, `e2e-cust-${RUN}-phone-theirs`)).json().data;

        // 超管不受归属限制
        const bySuper = await app.inject({
            method: "GET",
            url: `/api/customers/${theirs.code}/phone`,
            headers: authHeaders(superToken),
        });
        expect(bySuper.statusCode).toBe(200);
        expect(bySuper.json()).toEqual({ code: 0, data: { phone: "13800001111" }, message: "ok" });

        // 销售取自己负责的客户
        const byOwner = await app.inject({
            method: "GET",
            url: `/api/customers/${mine.code}/phone`,
            headers: authHeaders(salesToken),
        });
        expect(byOwner.statusCode).toBe(200);
        expect(byOwner.json().data).toEqual({ phone: "13800001111" });

        // 销售取他人负责的客户
        const byStranger = await app.inject({
            method: "GET",
            url: `/api/customers/${theirs.code}/phone`,
            headers: authHeaders(salesToken),
        });
        expect(byStranger.statusCode).toBe(403);
        expect(byStranger.json()).toEqual({
            code: 403,
            data: null,
            message: "只有超级管理员或客户负责人可获取完整手机号",
        });

        // 管理员有 customers:view 但永远不是负责人
        await createUser(accountOf("admin01"), "admin");
        const byAdmin = await app.inject({
            method: "GET",
            url: `/api/customers/${mine.code}/phone`,
            headers: authHeaders(await login(accountOf("admin01"))),
        });
        expect(byAdmin.statusCode).toBe(403);
        expect(byAdmin.json().message).toBe("只有超级管理员或客户负责人可获取完整手机号");

        // 未知客户
        const missing = await app.inject({
            method: "GET",
            url: "/api/customers/CUS-999999/phone",
            headers: authHeaders(superToken),
        });
        expect(missing.statusCode).toBe(404);
        expect(missing.json().message).toBe("客户不存在");
    });
});

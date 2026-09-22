/**
 * BOM 库存流水集成测试：真实 HTTP 管线 + 真实测试库（*_test 种子数据）。
 * 覆盖 /bom-stocks/{code}/ledger 的聚合口径：入库/调整/出库合并为业务日升序
 * 流水，逐笔结余累计，stockQty 与 v_bom_stock（/bom-stocks 聚合）恒等；
 * 以及 stock 菜单播种（staff 授权含 menu:stock）。固定 BOM 重跑复用，
 * 断言基于运行前基线的增量。运行前置：pnpm test:db:reset。
 */
import "./db-guard";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import { PrismaService } from "../src/prisma/prisma.service";
import { SnowflakeGenerator } from "../src/common/snowflake";
import { materialSetHash } from "../src/common/bom-spec";

const RUN = Date.now().toString(36);
const accountOf = (name: string): string => `qa_${name}_${RUN}`;
const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });
const today = (): string => new Date().toISOString().slice(0, 10);

/** 固定测试 BOM（重跑复用）：三脚底座 + 7.6mm 按钮的组合未被其他 e2e 固定 BOM 占用，
 * 避免撞 (category, spec_hash) 的 uk_bom_identity 唯一键 */
const BOM_CODE = "ZME2E0003";
const BOM_ITEMS = [
    { groupKey: "base", groupName: "底座", name: "三脚底座（有挡脚）", position: 1 },
    { groupKey: "button", groupName: "按钮", name: "7.6mm（常用装跌倒）", position: 2 },
];

describe("BOM 库存流水 (e2e)", () => {
    let app: NestFastifyApplication;
    let prisma: PrismaService;
    let snowflake: SnowflakeGenerator;
    let superToken: string;
    let warehouseToken: string;
    let orderNo: string;

    const login = async (account: string): Promise<string> => {
        const res = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account, password: "123456" },
        });
        return res.json().data.accessToken;
    };

    const createUser = async (account: string, role: string): Promise<string> => {
        const res = await app.inject({
            method: "POST",
            url: "/api/users",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-${RUN}-${account}` },
            payload: { name: `联调${account.split("_")[1] ?? "用户"}`, account, role },
        });
        expect(res.statusCode).toBe(200);
        return res.json().data.name;
    };

    const post = async (
        url: string,
        token: string,
        payload: Record<string, unknown>,
        idemKey: string,
    ): Promise<ReturnType<NestFastifyApplication["inject"]>> =>
        app.inject({
            method: "POST",
            url,
            headers: { ...authHeaders(token), "idempotency-key": idemKey },
            payload: payload as never,
        });

    const getLedger = async (code: string, token = superToken) => {
        const res = await app.inject({
            method: "GET",
            url: `/api/bom-stocks/${code}/ledger`,
            headers: authHeaders(token),
        });
        return res;
    };

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        prisma = app.get(PrismaService);
        snowflake = app.get(SnowflakeGenerator);
        superToken = await login("guojun");

        await createUser(accountOf("wh01"), "warehouse");
        warehouseToken = await login(accountOf("wh01"));
        await createUser(accountOf("sales01"), "sales");

        // 固定测试 BOM：存在则复用（重跑不撞唯一键）；明细按建档冻结快照造数
        const existing = await prisma.bomTable.findUnique({ where: { bomCode: BOM_CODE } });
        if (!existing) {
            const category = await prisma.bomCategory.findUnique({ where: { categoryKey: "new-micro-switch" } });
            const superUser = await prisma.sysUser.findUnique({ where: { account: "guojun" } });
            const now = new Date();
            const bomId = snowflake.next();
            const materialIds = (
                await Promise.all(
                    BOM_ITEMS.map(item =>
                        prisma.materialItem.findFirst({
                            where: {
                                group: { name: item.groupName, category: { categoryKey: "new-micro-switch" } },
                                name: item.name,
                            },
                            select: { id: true },
                        }),
                    ),
                )
            ).map(row => row!.id);
            await prisma.bomTable.create({
                data: {
                    id: bomId,
                    bomCode: BOM_CODE,
                    categoryId: category!.id,
                    specHash: materialSetHash(
                        category!.id,
                        materialIds.map(id => ({ id: id.toString(), quantity: 1 })),
                        "",
                    ),
                    requestKey: `e2e-bom-${BOM_CODE}`,
                    createdBy: superUser!.id,
                    updatedBy: superUser!.id,
                    createdAt: now,
                },
            });
            await prisma.bomItem.createMany({
                data: BOM_ITEMS.map((item, index) => ({
                    id: snowflake.next(),
                    bomId,
                    materialId: materialIds[index]!,
                    groupKey: item.groupKey,
                    groupName: item.groupName,
                    name: item.name,
                    position: item.position,
                    createdAt: now,
                })),
            });
        }

        // 出库载体订单：qty 500，可发量由本次入库构筑
        const customerRes = await post(
            "/api/customers",
            superToken,
            {
                name: `库存流水联调客户_${RUN}`,
                contact: "陈仓管",
                phone: "13800004444",
                province: "广东省",
                city: "东莞市",
                district: "",
                town: "",
                address: `常平 ${RUN.slice(-3)} 号`,
                ownerAccount: accountOf("sales01"),
                payTerms: "",
            },
            `e2e-stk-${RUN}-cust`,
        );
        expect(customerRes.statusCode).toBe(200);

        const orderRes = await post(
            "/api/orders",
            superToken,
            {
                customerCode: customerRes.json().data.code,
                bomCode: BOM_CODE,
                qty: 500,
                deliverDate: "2026-10-31",
                orderDate: today(),
                remark: `e2e 库存流水订单 ${RUN}`,
            },
            `e2e-stk-${RUN}-order`,
        );
        expect(orderRes.statusCode).toBe(200);
        orderNo = orderRes.json().data.orderNo;
    });

    afterAll(async () => {
        await app.close();
    });

    it("不存在的 BOM 404；存在但无流水返回空 flows 与 0", async () => {
        const missing = await getLedger("ZM999999999");
        expect(missing.statusCode).toBe(404);

        const empty = await getLedger(BOM_CODE);
        expect(empty.statusCode).toBe(200);
        const data = empty.json().data;
        expect(data.bomCode).toBe(BOM_CODE);
        expect(data.stockQty).toBe(data.flows.at(-1)?.balance ?? 0);
    });

    it("入库 → 出库 → 调整后：流水升序、有符号数量、逐笔结余，与 /bom-stocks 聚合恒等", async () => {
        // 运行前基线（重跑复用同一 BOM，断言只看增量）
        const baseline = (await getLedger(BOM_CODE)).json().data;
        const baseQty = baseline.stockQty as number;

        const in100 = await post(
            "/api/inbound",
            warehouseToken,
            { bomCode: BOM_CODE, qty: 100, date: today(), remark: `e2e 库存流水入库 ${RUN}` },
            `e2e-stk-${RUN}-in100`,
        );
        expect(in100.statusCode).toBe(200);
        const noIn100 = in100.json().data.no as string;

        const ship60 = await post(
            "/api/outbound",
            warehouseToken,
            { orderNo, qty: 60, date: today(), remark: `e2e 库存流水发货 ${RUN}` },
            `e2e-stk-${RUN}-ship60`,
        );
        expect(ship60.statusCode).toBe(200);
        const noShip60 = ship60.json().data.no as string;

        const adjust20 = await post(
            "/api/stock-adjustments",
            superToken,
            { bomCode: BOM_CODE, qtyDelta: 20, date: today(), reason: `e2e 盘盈 ${RUN}` },
            `e2e-stk-${RUN}-adj20`,
        );
        expect(adjust20.statusCode).toBe(200);
        const noAdjust20 = adjust20.json().data.no as string;

        const res = await getLedger(BOM_CODE);
        expect(res.statusCode).toBe(200);
        const ledger = res.json().data;
        expect(ledger.stockQty).toBe(baseQty + 60);

        // 本次三笔：同日内按操作时间排序（入库 → 出库 → 调整），qty 有符号，结余逐笔累计
        const fresh = (ledger.flows as Array<Record<string, unknown>>).filter(flow =>
            [noIn100, noShip60, noAdjust20].includes(flow.no as string),
        );
        expect(fresh.map(flow => [flow.type, flow.no])).toEqual([
            ["in", noIn100],
            ["out", noShip60],
            ["adjust", noAdjust20],
        ]);
        const byNo = new Map(fresh.map(flow => [flow.no as string, flow]));
        expect(byNo.get(noIn100)).toMatchObject({ qty: 100, operator: expect.any(String), date: today() });
        expect(byNo.get(noShip60)).toMatchObject({ qty: -60, customer: `库存流水联调客户_${RUN}` });
        expect(byNo.get(noAdjust20)).toMatchObject({ qty: 20, remark: `e2e 盘盈 ${RUN}` });
        // 客户仅挂在出库行；入库/调整没有客户，不渲染占位
        expect(byNo.get(noIn100)?.customer).toBeUndefined();
        expect(byNo.get(noAdjust20)?.customer).toBeUndefined();

        // 结余连续性：整条流水逐笔累计 = stockQty
        let running = 0;
        for (const flow of ledger.flows as Array<{ qty: number; balance: number }>) {
            running += flow.qty;
            expect(flow.balance).toBe(running);
        }

        // 与 v_bom_stock 聚合口径一致（/bom-stocks 余量 map）
        const stocks = await app.inject({ method: "GET", url: "/api/bom-stocks", headers: authHeaders(superToken) });
        expect(stocks.json().data[BOM_CODE]).toBe(ledger.stockQty);
    });

    it("staff 已播种 stock 菜单（menu:stock 随迁移授权）", async () => {
        await createUser(accountOf("staff01"), "staff");
        const token = await login(accountOf("staff01"));
        const profile = await app.inject({ method: "GET", url: "/api/auth/profile", headers: authHeaders(token) });
        expect(profile.statusCode).toBe(200);
        expect(profile.json().data.grant.menus).toContain("stock");
        expect(await getLedger(BOM_CODE, token)).toBeDefined();
    });
});

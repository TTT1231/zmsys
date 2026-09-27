/**
 * 工作台聚合集成测试：真实 HTTP 管线 + 真实测试库（*_test 种子数据）。
 * 覆盖 /workbench/overview 的真实聚合口径：BOM 快照派生与 v_bom_stock 库存、
 * 订单净额（v_order_outbound_qty）与取消标记、出入库按业务日合并（含作废冲销净额）。
 * 固定 BOM 重跑复用，断言基于运行前基线的增量，不受历史数据影响。
 * 运行前置：pnpm test:db:reset。
 */
import "./db-guard";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import { PrismaService } from "../src/prisma/prisma.service";
import { SnowflakeGenerator } from "../src/common/snowflake";
import { beijingDayKey } from "../src/common/beijing-day";
import { materialSetHash } from "../src/common/bom-spec";
import type { WorkbenchData } from "../src/workbench/types";

const RUN = Date.now().toString(36);
const accountOf = (name: string): string => `qa_${name}_${RUN}`;
const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });
const today = (): string => beijingDayKey();

/** 固定测试 BOM（重跑复用，不撞唯一键；物料组合避开其它 e2e 套件的 uk_bom_identity） */
const BOM_CODE = "ZME2E0004";
const BOM_ITEMS = [
    { groupKey: "base", groupName: "底座", name: "二脚底座（无挡脚）", position: 1 },
    { groupKey: "button", groupName: "按钮", name: "8.5mm", position: 2 },
];

describe("工作台聚合 (e2e)", () => {
    let app: NestFastifyApplication;
    let prisma: PrismaService;
    let snowflake: SnowflakeGenerator;
    let superToken: string;
    let warehouseToken: string;
    let orderNo: string;
    let shipmentNo: string;
    let baseline: { stock: number; inbound: number; outbound: number };

    const login = async (account: string): Promise<string> => {
        const res = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account, password: "123456" },
        });
        return res.json().data.accessToken;
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

    const overview = async (): Promise<WorkbenchData> => {
        const res = await app.inject({
            method: "GET",
            url: "/api/workbench/overview",
            headers: authHeaders(superToken),
        });
        expect(res.statusCode).toBe(200);
        return res.json().data;
    };

    /** 运行前基线：固定 BOM 的当前库存与今日出入库（重跑累积不破坏断言） */
    const snapshotOf = (data: WorkbenchData) => {
        const product = data.products.find(item => item.code === BOM_CODE);
        const movement = data.movements.find(row => row.bomCode === BOM_CODE && row.date === today());
        return {
            stock: product?.stock ?? 0,
            inbound: movement?.inbound ?? 0,
            outbound: movement?.outbound ?? 0,
        };
    };

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        prisma = app.get(PrismaService);
        snowflake = app.get(SnowflakeGenerator);
        superToken = await login("guojun");
        await app.inject({
            method: "POST",
            url: "/api/users",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-wb-${RUN}-wh` },
            payload: { name: "联调仓管", account: accountOf("wh01"), role: "warehouse" },
        });
        warehouseToken = await login(accountOf("wh01"));

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

        // 测试客户与主流程订单（100 件）
        const customerRes = await post(
            "/api/customers",
            superToken,
            {
                name: `工作台联调客户_${RUN}`,
                contact: "陈仓管",
                phone: "13800004444",
                province: "广东省",
                city: "东莞市",
                district: "",
                town: "",
                address: `常平 ${RUN.slice(-3)} 号`,
                ownerAccount: "guojun",
                payTerms: "",
            },
            `e2e-wb-${RUN}-cust`,
        );
        expect(customerRes.statusCode).toBe(200);
        const customerCode = customerRes.json().data.code;

        const orderRes = await post(
            "/api/orders",
            superToken,
            {
                customerCode,
                bomCode: BOM_CODE,
                qty: 100,
                deliverDate: "2027-06-30",
                orderDate: today(),
                remark: `e2e 工作台订单 ${RUN}`,
            },
            `e2e-wb-${RUN}-order`,
        );
        expect(orderRes.statusCode).toBe(200);
        orderNo = orderRes.json().data.orderNo;

        baseline = snapshotOf(await overview());
    });

    afterAll(async () => {
        await app.close();
    });

    it("未登录 401；登录后返回北京日截至与统一单位", async () => {
        const anonymous = await app.inject({ method: "GET", url: "/api/workbench/overview" });
        expect(anonymous.statusCode).toBe(401);

        const data = await overview();
        expect(data.asOf).toBe(today());
        expect(data.unit).toBe("个");
    });

    it("产品由冻结明细派生规格，入库 60 后库存按 v_bom_stock 口径 +60", async () => {
        const created = await post(
            "/api/inbound",
            warehouseToken,
            { bomCode: BOM_CODE, qty: 60, date: today(), remark: `e2e 工作台入库 ${RUN}` },
            `e2e-wb-${RUN}-in60`,
        );
        expect(created.statusCode).toBe(200);

        const data = await overview();
        const product = data.products.find(item => item.code === BOM_CODE);
        expect(product).toMatchObject({
            code: BOM_CODE,
            category: "新微动",
            model: "",
            spec: "底座：二脚底座（无挡脚） · 按钮：8.5mm",
            unit: "个",
            stock: baseline.stock + 60,
        });
    });

    it("发货 40：订单净额 40、当日出库 +40、库存回落 20", async () => {
        const shipped = await post(
            "/api/outbound",
            warehouseToken,
            { orderNo, qty: 40, date: today(), remark: `e2e 工作台发货 ${RUN}` },
            `e2e-wb-${RUN}-ship40`,
        );
        expect(shipped.statusCode).toBe(200);
        shipmentNo = shipped.json().data.no;

        const data = await overview();
        const order = data.orders.find(item => item.no === orderNo);
        expect(order).toMatchObject({ no: orderNo, bomCode: BOM_CODE, qty: 100, shipped: 40 });
        expect(data.products.find(item => item.code === BOM_CODE)?.stock).toBe(baseline.stock + 60 - 40);

        const movement = data.movements.find(row => row.bomCode === BOM_CODE && row.date === today());
        expect(movement).toMatchObject({ inbound: baseline.inbound + 60, outbound: baseline.outbound + 40 });
    });

    it("作废出库：冲销净额使当日出库回落、订单净额归零、库存恢复", async () => {
        const voided = await post(
            `/api/outbound/${shipmentNo}/void`,
            warehouseToken,
            { expectedVersion: 1, reason: "登记数量有误" },
            `e2e-wb-${RUN}-void`,
        );
        expect(voided.statusCode).toBe(200);

        const data = await overview();
        expect(data.orders.find(item => item.no === orderNo)?.shipped).toBe(0);
        expect(data.products.find(item => item.code === BOM_CODE)?.stock).toBe(baseline.stock + 60);
        const movement = data.movements.find(row => row.bomCode === BOM_CODE && row.date === today());
        expect(movement).toMatchObject({ inbound: baseline.inbound + 60, outbound: baseline.outbound });
    });
});

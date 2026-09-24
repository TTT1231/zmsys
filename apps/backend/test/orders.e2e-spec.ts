/**
 * 销售订单集成测试：真实 HTTP 管线 + 真实测试库（*_test 种子数据）。
 * 直插 BOM 与出库流水构造库存口径（BOM/出库模块未实现，按表契约造数），
 * 验证 v_order_outbound_qty 视图聚合、快照冻结与合作状态联动。
 * 运行前置：pnpm test:db:reset。
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

/** 固定测试 BOM（重跑复用，不撞唯一键）：新微动 三脚底座 + 8.5mm 按钮。
 * 物料集合与 ledger e2e 的夹具不同（判重键为品类+集合，并行文件不得撞同一集合）。 */
const BOM_CODE = "ZME2E0001";
const BOM_ITEMS = [
    { groupKey: "base", groupName: "底座", name: "三脚底座（有挡脚）", position: 1 },
    { groupKey: "button", groupName: "按钮", name: "8.5mm", position: 2 },
];

const orderInput = (customerCode: string) => ({
    customerCode,
    bomCode: BOM_CODE,
    qty: 100,
    deliverDate: "2026-09-30",
    orderDate: today(),
    remark: `e2e 订单 ${RUN}`,
});

describe("销售订单 (e2e)", () => {
    let app: NestFastifyApplication;
    let prisma: PrismaService;
    let snowflake: SnowflakeGenerator;
    let superToken: string;
    let salesToken: string;
    let customerCode: string;
    let orderNo: string;

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

    const createOrder = async (token: string, payload: ReturnType<typeof orderInput>, idemKey: string) =>
        app.inject({
            method: "POST",
            url: "/api/orders",
            headers: { ...authHeaders(token), "idempotency-key": idemKey },
            payload,
        });

    /** 直插正向出库流水（REGISTERED 未作废）构造净额与取消拦截前提 */
    const seedRegisteredShipment = async (orderId: bigint, shipmentNo: string, qty: number): Promise<bigint> => {
        const superUser = await prisma.sysUser.findUnique({ where: { account: "guojun" } });
        const now = new Date();
        const shipmentId = snowflake.next();
        await prisma.outboundShipment.create({
            data: {
                id: shipmentId,
                shipmentNo,
                orderId,
                originalQty: qty,
                businessDate: now,
                state: "REGISTERED",
                requestKey: `e2e-ship-${shipmentNo}`,
                registeredBy: superUser!.id,
                registeredAt: now,
            },
        });
        const eventId = snowflake.next();
        await prisma.outboundLedger.create({
            data: {
                id: eventId,
                eventNo: `${shipmentNo}-E1`,
                shipmentId,
                entryType: "NORMAL",
                qtyDelta: qty,
                businessDate: now,
                operatorId: superUser!.id,
                requestKey: `e2e-ledger-${shipmentNo}-E1`,
                createdAt: now,
            },
        });
        return eventId;
    };

    /** 真实作废语义（db-scheme.md §7.3）：追加等额负向冲销 + 单头置 VOIDED */
    const voidShipment = async (shipmentNo: string, eventId: bigint, qty: number): Promise<void> => {
        const superUser = await prisma.sysUser.findUnique({ where: { account: "guojun" } });
        const now = new Date();
        await prisma.outboundLedger.create({
            data: {
                id: snowflake.next(),
                eventNo: `${shipmentNo}-E2`,
                shipmentId: (await prisma.outboundShipment.findUnique({ where: { shipmentNo } }))!.id,
                entryType: "CORRECTION",
                correctionOfId: eventId,
                qtyDelta: -qty,
                businessDate: now,
                operatorId: superUser!.id,
                correctionReason: "e2e 构造：作废冲销",
                requestKey: `e2e-ledger-${shipmentNo}-E2`,
                createdAt: now,
            },
        });
        await prisma.outboundShipment.update({
            where: { shipmentNo },
            data: {
                state: "VOIDED",
                voidedBy: superUser!.id,
                voidReason: "e2e 构造作废",
                voidedAt: now,
            },
        });
    };

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        prisma = app.get(PrismaService);
        snowflake = app.get(SnowflakeGenerator);
        superToken = await login("guojun");

        const salesAccount = accountOf("sales01");
        await createUser(salesAccount, "sales");
        salesToken = await login(salesAccount);

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

        // 测试客户（订单与客户合作状态联动的前置）
        const customerRes = await app.inject({
            method: "POST",
            url: "/api/customers",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-ord-${RUN}-cust` },
            payload: {
                name: `订单联调客户_${RUN}`,
                contact: "李经理",
                phone: "13800002222",
                province: "广东省",
                city: "东莞市",
                district: "",
                town: "",
                address: `松山湖 ${RUN.slice(-3)} 号`,
                ownerAccount: salesAccount,
                payTerms: "",
            },
        });
        expect(customerRes.statusCode).toBe(200);
        customerCode = customerRes.json().data.code;
    });

    afterAll(async () => {
        await app.close();
    });

    it("staff 有 orders:view 可查看列表，但无 orders:create 创建返回 403", async () => {
        await createUser(accountOf("staff01"), "staff");
        const staffToken = await login(accountOf("staff01"));
        const list = await app.inject({ method: "GET", url: "/api/orders", headers: authHeaders(staffToken) });
        expect(list.statusCode).toBe(200);
        const denied = await createOrder(staffToken, orderInput(customerCode), `e2e-ord-${RUN}-staff`);
        expect(denied.statusCode).toBe(403);
        expect(denied.json()).toEqual({ code: 403, data: null, message: "无权新建订单" });
    });

    it("创建成功：ZM+yyMMdd 序号、服务端冻结客户与 BOM 快照、写 op_log；客户合作状态联动为合作中", async () => {
        const res = await createOrder(superToken, orderInput(customerCode), `e2e-ord-${RUN}-create`);
        expect(res.statusCode).toBe(200);
        const created = res.json().data;
        expect(created.orderNo).toMatch(/^ZM\d{6}\d{3,}$/);
        expect(created).toMatchObject({
            customerCode,
            bomCode: BOM_CODE,
            qty: 100,
            outbound: 0,
            lifecycleStatus: "active",
            version: 1,
            orderDate: today(),
        });
        orderNo = created.orderNo;

        // 下单客户在客户列表中变为合作中（近 6 个日历月活动订单派生）
        const customers = await app.inject({ method: "GET", url: "/api/customers", headers: authHeaders(salesToken) });
        const me = customers.json().data.find((item: { code: string }) => item.code === customerCode);
        expect(me.cooperation).toBe("合作中");

        const stored = await prisma.salesOrderTable.findUnique({ where: { orderNo } });
        expect(stored).toMatchObject({
            customerNameSnapshot: `订单联调客户_${RUN}`,
            bomNameSnapshot: "新微动",
            bomModelSnapshot: "",
        });
        // 冻结形态：{ items, modelCode, spec }，与建档快照同构
        expect(stored!.bomSpecSnapshot).toMatchObject({
            modelCode: "",
            spec: "底座：三脚底座（有挡脚） · 按钮：8.5mm",
            items: BOM_ITEMS.map(item => expect.objectContaining({ groupName: item.groupName, name: item.name })),
        });
        const opLog = await prisma.opLog.findFirst({ where: { action: "create_order", targetCode: orderNo } });
        expect(opLog).not.toBeNull();
        const changeLog = await prisma.salesOrderChangeLog.findFirst({ where: { order: { orderNo } } });
        expect(changeLog?.eventType).toBe("CREATE");
    });

    it("快照不随客户改名漂移：客户改名后订单列表仍显示下单时名称", async () => {
        const customer = await prisma.customTable.findUnique({ where: { customerCode } });
        await prisma.customTable.update({
            where: { id: customer!.id },
            data: { name: `改名后的客户_${RUN}`, rowVersion: { increment: 1 } },
        });
        const list = await app.inject({ method: "GET", url: "/api/orders", headers: authHeaders(superToken) });
        const mine = list.json().data.find((item: { orderNo: string }) => item.orderNo === orderNo);
        expect(mine.customer).toBe(`订单联调客户_${RUN}`);
    });

    it("缺幂等键 400；客户或 BOM 不存在 404；重放返回首次响应；同键不同体 409", async () => {
        const noKey = await app.inject({
            method: "POST",
            url: "/api/orders",
            headers: authHeaders(superToken),
            payload: orderInput(customerCode),
        });
        expect(noKey.statusCode).toBe(400);

        const badCustomer = await createOrder(superToken, orderInput("CUS-999999"), `e2e-ord-${RUN}-c404`);
        expect(badCustomer.statusCode).toBe(404);
        expect(badCustomer.json().message).toBe("客户不存在");

        const badBom = await createOrder(
            superToken,
            { ...orderInput(customerCode), bomCode: "ZMXXXX999" },
            `e2e-ord-${RUN}-b404`,
        );
        expect(badBom.statusCode).toBe(404);
        expect(badBom.json().message).toBe("BOM 不存在");

        const key = `e2e-ord-${RUN}-idem`;
        const first = await createOrder(superToken, { ...orderInput(customerCode), qty: 7 }, key);
        expect(first.statusCode).toBe(200);
        const replay = await createOrder(superToken, { ...orderInput(customerCode), qty: 7 }, key);
        expect(replay.statusCode).toBe(200);
        expect(replay.json().data).toEqual(first.json().data);
        const conflict = await createOrder(superToken, { ...orderInput(customerCode), qty: 8 }, key);
        expect(conflict.statusCode).toBe(409);
    });

    it("编辑：无可变字段 400；未知订单 404；版本过期 409；合法修改版本 +1", async () => {
        const noField = await app.inject({
            method: "PUT",
            url: `/api/orders/${orderNo}`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: 1 },
        });
        expect(noField.statusCode).toBe(400);

        const missing = await app.inject({
            method: "PUT",
            url: "/api/orders/ZM999999999",
            headers: authHeaders(superToken),
            payload: { expectedVersion: 1, qty: 10 },
        });
        expect(missing.statusCode).toBe(404);

        const stale = await app.inject({
            method: "PUT",
            url: `/api/orders/${orderNo}`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: 5, qty: 10 },
        });
        expect(stale.statusCode).toBe(409);

        const updated = await app.inject({
            method: "PUT",
            url: `/api/orders/${orderNo}`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: 1, qty: 150, deliverDate: "2026-10-15" },
        });
        expect(updated.statusCode).toBe(200);
        expect(updated.json().data).toMatchObject({ version: 2, qty: 150, deliverDate: "2026-10-15" });
        const logs = await prisma.salesOrderChangeLog.findMany({ where: { order: { orderNo } } });
        expect(logs.some(log => log.eventType === "UPDATE")).toBe(true);
    });

    it("有效出库净额拦截：新数量不得低于净额；作废冲销后净额归零", async () => {
        const order = await prisma.salesOrderTable.findUnique({ where: { orderNo } });
        const shipmentNo = `CKE2E${RUN}`;
        const eventId = await seedRegisteredShipment(order!.id, shipmentNo, 30);

        // 列表口径经 v_order_outbound_qty 视图聚合：outbound = 30
        const list = await app.inject({ method: "GET", url: "/api/orders", headers: authHeaders(superToken) });
        const mine = list.json().data.find((item: { orderNo: string }) => item.orderNo === orderNo);
        expect(mine.outbound).toBe(30);

        // 新数量低于净额 → 409
        const lowQty = await app.inject({
            method: "PUT",
            url: `/api/orders/${orderNo}`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: 2, qty: 20 },
        });
        expect(lowQty.statusCode).toBe(409);

        // 真实作废：追加 -30 冲销 + 单头 VOIDED → 视图净额归零
        await voidShipment(shipmentNo, eventId, 30);
        const afterVoid = await app.inject({ method: "GET", url: "/api/orders", headers: authHeaders(superToken) });
        const voided = afterVoid.json().data.find((item: { orderNo: string }) => item.orderNo === orderNo);
        expect(voided.outbound).toBe(0);
    });

    it("取消成功：挂未作废出库单仍可直接取消（已发保留）；终态字段、CANCEL 日志与原因；重放幂等；已取消再取消 409", async () => {
        // 存在未作废出库单时取消直接放行，已发数量口径保留
        const order = await prisma.salesOrderTable.findUnique({ where: { orderNo } });
        await seedRegisteredShipment(order!.id, `CKE2EC${RUN}`, 10);

        const key = `e2e-ord-${RUN}-cancel`;
        const cancelled = await app.inject({
            method: "POST",
            url: `/api/orders/${orderNo}/cancel`,
            headers: { ...authHeaders(superToken), "idempotency-key": key },
            payload: { expectedVersion: 2, reason: "客户计划变更" },
        });
        expect(cancelled.statusCode).toBe(200);
        expect(cancelled.json().data).toMatchObject({
            lifecycleStatus: "cancelled",
            version: 3,
            outbound: 10,
            cancelReason: "客户计划变更",
            cancelledBy: "郭均",
        });
        expect(cancelled.json().data.cancelledAt).toBeDefined();

        const replay = await app.inject({
            method: "POST",
            url: `/api/orders/${orderNo}/cancel`,
            headers: { ...authHeaders(superToken), "idempotency-key": key },
            payload: { expectedVersion: 2, reason: "客户计划变更" },
        });
        expect(replay.statusCode).toBe(200);
        expect(replay.json().data).toEqual(cancelled.json().data);

        const again = await app.inject({
            method: "POST",
            url: `/api/orders/${orderNo}/cancel`,
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-ord-${RUN}-cancel-2` },
            payload: { expectedVersion: 3, reason: "再次取消" },
        });
        expect(again.statusCode).toBe(409);

        const edit = await app.inject({
            method: "PUT",
            url: `/api/orders/${orderNo}`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: 3, qty: 200 },
        });
        expect(edit.statusCode).toBe(409);

        const logs = await prisma.salesOrderChangeLog.findMany({ where: { order: { orderNo } } });
        const cancelLog = logs.find(log => log.eventType === "CANCEL");
        expect(cancelLog).toMatchObject({ reason: "客户计划变更", beforeVersion: 2n, afterVersion: 3n });
    });

    it("取消订单仍返回列表用于历史审计；客户合作状态由剩余活动订单决定", async () => {
        const list = await app.inject({ method: "GET", url: "/api/orders", headers: authHeaders(superToken) });
        const cancelled = list.json().data.find((item: { orderNo: string }) => item.orderNo === orderNo);
        expect(cancelled.lifecycleStatus).toBe("cancelled");
        expect(cancelled.cancelReason).toBe("客户计划变更");

        // 该客户仍有一笔活动订单（幂等测试 qty=7 单）→ 合作中；
        // “取消订单不参与派生”的口径由单测覆盖（lifecycleStatus=ACTIVE 过滤）
        const customers = await app.inject({ method: "GET", url: "/api/customers", headers: authHeaders(salesToken) });
        const me = customers.json().data.find((item: { code: string }) => item.code === customerCode);
        expect(me.cooperation).toBe("合作中");
    });

    it("归档：非超管 403；未发货 409；带未作废出库单仍可归档（保留已发口径）且归档后全锁定", async () => {
        const created = await createOrder(superToken, orderInput(customerCode), `e2e-ord-${RUN}-arc1`);
        expect(created.statusCode).toBe(200);
        const target = created.json().data as { orderNo: string; version: number };

        // orders:archive 受保护：普通角色（sales）即使有订单编辑权也 403
        const denied = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/archive`,
            headers: { ...authHeaders(salesToken), "idempotency-key": `e2e-ord-${RUN}-arc-sales` },
            payload: { expectedVersion: target.version },
        });
        expect(denied.statusCode).toBe(403);
        expect(denied.json().message).toContain("超级管理员");

        // 未发货的 ACTIVE 订单不可归档（手误单走取消/删除）
        const unshipped = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/archive`,
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-ord-${RUN}-arc-empty` },
            payload: { expectedVersion: target.version },
        });
        expect(unshipped.statusCode).toBe(409);
        expect(unshipped.json().message).toContain("尚未发货");

        // 存在未作废出库单直接归档（保留已发 30 口径）
        await seedRegisteredShipment(
            (await prisma.salesOrderTable.findUnique({ where: { orderNo: target.orderNo } }))!.id,
            `CKE2EA${RUN}`,
            30,
        );
        const key = `e2e-ord-${RUN}-arc-ok`;
        const archived = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/archive`,
            headers: { ...authHeaders(superToken), "idempotency-key": key },
            payload: { expectedVersion: target.version, reason: "行情不好客户弃单" },
        });
        expect(archived.statusCode).toBe(200);
        expect(archived.json().data).toMatchObject({
            lifecycleStatus: "archived",
            version: target.version + 1,
            outbound: 30,
            archiveReason: "行情不好客户弃单",
            archivedBy: "郭均",
        });
        expect(archived.json().data.archivedAt).toBeDefined();

        const superUser = await prisma.sysUser.findUnique({ where: { account: "guojun" } });
        const stored = await prisma.salesOrderTable.findUnique({ where: { orderNo: target.orderNo } });
        expect(stored).toMatchObject({
            archivedBy: superUser!.id,
            archiveReason: "行情不好客户弃单",
        });
        expect(stored!.archivedAt).toBeInstanceOf(Date);

        // 重放幂等：同键返回首次响应
        const replay = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/archive`,
            headers: { ...authHeaders(superToken), "idempotency-key": key },
            payload: { expectedVersion: target.version, reason: "行情不好客户弃单" },
        });
        expect(replay.statusCode).toBe(200);
        expect(replay.json().data).toEqual(archived.json().data);

        // 终态全锁定：编辑（含仅备注）/取消/删除/再归档均 409
        const edit = await app.inject({
            method: "PUT",
            url: `/api/orders/${target.orderNo}`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: target.version + 1, remark: "试图改备注" },
        });
        expect(edit.statusCode).toBe(409);
        expect(edit.json().message).toContain("已归档");

        const cancel = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/cancel`,
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-ord-${RUN}-arc-cancel` },
            payload: { expectedVersion: target.version + 1, reason: "试图取消归档单" },
        });
        expect(cancel.statusCode).toBe(409);

        const remove = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/delete`,
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-ord-${RUN}-arc-del` },
            payload: { expectedVersion: target.version + 1 },
        });
        expect(remove.statusCode).toBe(409);

        const again = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/archive`,
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-ord-${RUN}-arc-again` },
            payload: { expectedVersion: target.version + 1 },
        });
        expect(again.statusCode).toBe(409);

        // 审计链：ARCHIVE 变更日志（操作人+版本）与 op_log 里程碑
        const logs = await prisma.salesOrderChangeLog.findMany({ where: { order: { orderNo: target.orderNo } } });
        const archiveLog = logs.find(log => log.eventType === "ARCHIVE");
        expect(archiveLog).toMatchObject({
            reason: "行情不好客户弃单",
            operatorId: superUser!.id,
            beforeVersion: BigInt(target.version),
            afterVersion: BigInt(target.version + 1),
        });
        const opLog = await prisma.opLog.findFirst({ where: { action: "archive_order", targetCode: target.orderNo } });
        expect(opLog?.detailJson).toMatchObject({ orderNo: target.orderNo, customerCode });

        // 归档单仍在列表返回（前端分流到归档订单页）
        const list = await app.inject({ method: "GET", url: "/api/orders", headers: authHeaders(superToken) });
        const mine = list.json().data.find((item: { orderNo: string }) => item.orderNo === target.orderNo);
        expect(mine.lifecycleStatus).toBe("archived");
    });

    it("未发货取消的订单不可归档（走删除）；部分发货后取消的订单可归档且保留取消语境", async () => {
        // 一件未发的取消单：归档 409，直接删除收尾
        const bare = await createOrder(superToken, orderInput(customerCode), `e2e-ord-${RUN}-arc2`);
        const bareTarget = bare.json().data as { orderNo: string; version: number };
        const cancelled = await app.inject({
            method: "POST",
            url: `/api/orders/${bareTarget.orderNo}/cancel`,
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-ord-${RUN}-arc2-cancel` },
            payload: { expectedVersion: bareTarget.version, reason: "客户撤单" },
        });
        expect(cancelled.statusCode).toBe(200);

        const refused = await app.inject({
            method: "POST",
            url: `/api/orders/${bareTarget.orderNo}/archive`,
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-ord-${RUN}-arc2-refuse` },
            payload: { expectedVersion: bareTarget.version + 1 },
        });
        expect(refused.statusCode).toBe(409);
        expect(refused.json().message).toContain("一件未发");

        const removed = await app.inject({
            method: "POST",
            url: `/api/orders/${bareTarget.orderNo}/delete`,
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-ord-${RUN}-arc2-del` },
            payload: { expectedVersion: bareTarget.version + 1 },
        });
        expect(removed.statusCode).toBe(200);

        // 部分发货后取消：可归档，取消语境保留、备注留空
        const created = await createOrder(superToken, orderInput(customerCode), `e2e-ord-${RUN}-arc3`);
        const target = created.json().data as { orderNo: string; version: number };
        await seedRegisteredShipment(
            (await prisma.salesOrderTable.findUnique({ where: { orderNo: target.orderNo } }))!.id,
            `CKE2EB${RUN}`,
            30,
        );

        const partCancelled = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/cancel`,
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-ord-${RUN}-arc3-cancel` },
            payload: { expectedVersion: target.version, reason: "客户撤单" },
        });
        expect(partCancelled.statusCode).toBe(200);

        const archived = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/archive`,
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-ord-${RUN}-arc3-ok` },
            payload: { expectedVersion: target.version + 1 },
        });
        expect(archived.statusCode).toBe(200);
        expect(archived.json().data).toMatchObject({
            lifecycleStatus: "archived",
            outbound: 30,
            cancelReason: "客户撤单",
        });
        expect(archived.json().data.archivedAt).toBeDefined();
        expect(archived.json().data.archiveReason).toBe("");
        const stored = await prisma.salesOrderTable.findUnique({ where: { orderNo: target.orderNo } });
        expect(stored!.archiveReason).toBeNull();
    });

    it("删除净发货为零的订单：非超管 403、版本不匹配 409、列表隐藏并写 op_log、重放幂等", async () => {
        const created = await createOrder(superToken, orderInput(customerCode), `e2e-ord-${RUN}-del`);
        expect(created.statusCode).toBe(200);
        const target = created.json().data as { orderNo: string; version: number };

        await createUser(accountOf("admin01"), "admin");
        const adminToken = await login(accountOf("admin01"));
        const denied = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/delete`,
            headers: { ...authHeaders(adminToken), "idempotency-key": `e2e-ord-${RUN}-del-admin` },
            payload: { expectedVersion: target.version },
        });
        expect(denied.statusCode).toBe(403);
        expect(denied.json().message).toContain("超级管理员");

        const stale = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/delete`,
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-ord-${RUN}-del-stale` },
            payload: { expectedVersion: target.version + 5 },
        });
        expect(stale.statusCode).toBe(409);

        const key = `e2e-ord-${RUN}-del-ok`;
        const removed = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/delete`,
            headers: { ...authHeaders(superToken), "idempotency-key": key },
            payload: { expectedVersion: target.version },
        });
        expect(removed.statusCode).toBe(200);
        expect(removed.json()).toEqual({ code: 0, data: null, message: "ok" });

        const replay = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/delete`,
            headers: { ...authHeaders(superToken), "idempotency-key": key },
            payload: { expectedVersion: target.version },
        });
        expect(replay.statusCode).toBe(200);
        expect(replay.json().data).toBeNull();

        const gone = await app.inject({
            method: "POST",
            url: `/api/orders/${target.orderNo}/delete`,
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-ord-${RUN}-del-gone` },
            payload: { expectedVersion: target.version },
        });
        expect(gone.statusCode).toBe(404);

        const list = await app.inject({ method: "GET", url: "/api/orders", headers: authHeaders(superToken) });
        expect(list.json().data.some((item: { orderNo: string }) => item.orderNo === target.orderNo)).toBe(false);
        expect(
            (await prisma.salesOrderTable.findUnique({ where: { orderNo: target.orderNo } }))?.deletedAt,
        ).not.toBeNull();
        const opLog = await prisma.opLog.findFirst({
            where: { action: "delete_order", targetCode: target.orderNo },
        });
        expect(opLog?.detailJson).toMatchObject({ orderNo: target.orderNo, customerCode });
    });
});

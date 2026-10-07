/**
 * 成品出入库集成测试：真实 HTTP 管线 + 真实测试库（*_test 种子数据）。
 * 覆盖用户核心场景：销售订单 600 件 → 入库 200 → 发货 200 → 订单累计已发 200；
 * 以及 §6.2 可发量拦截、§7.1 当天修正/作废窗口、库存调整与作废。
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
import { LedgerPurgeService } from "../src/maintenance/ledger-purge.service";

const RUN = Date.now().toString(36);
const accountOf = (name: string): string => `qa_${name}_${RUN}`;
const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });
const today = (): string => new Date().toISOString().slice(0, 10);

/** 固定测试 BOM（重跑复用，不撞唯一键） */
const BOM_CODE = "ZME2E0002";
const BOM_ITEMS = [
    { groupKey: "base", groupName: "底座", name: "二脚底座（无挡脚）", position: 1 },
    { groupKey: "button", groupName: "按钮", name: "7.6mm", position: 2 },
];

/** 恢复链专用 BOM（判重集合独立）：末段用例要在其上走完入库→作废→删除→清理→
 *  删 BOM 全链，不能借用其它 BOM——并行套件会在任意 BOM 上留订单/库存残留
 *  （引用计数不过滤订单状态），随机借用会时好时坏；集合须避开全部套件的
 *  uk_bom_identity（含 boms.e2e 经 API 建档的单物料/支架组合） */
const CHAIN_BOM_CODE = "ZME2E0006";
const CHAIN_BOM_ITEMS = [
    { groupKey: "base", groupName: "底座", name: "三脚底座（有挡脚）", position: 1 },
    { groupKey: "button", groupName: "按钮", name: "8.0mm", position: 2 },
];

const inboundInput = (bomCode: string, qty: number) => ({
    bomCode,
    qty,
    date: today(),
    remark: `e2e 入库 ${RUN}`,
});

const outboundInput = (orderNo: string, qty: number) => ({
    orderNo,
    qty,
    date: today(),
    remark: `e2e 发货 ${RUN}`,
});

describe("成品出入库 (e2e)", () => {
    let app: NestFastifyApplication;
    let prisma: PrismaService;
    let snowflake: SnowflakeGenerator;
    let superToken: string;
    let warehouseToken: string;
    let warehouseName: string;
    let customerCode: string;
    let orderNo: string;
    let inboundNo: string;
    let firstShipmentNo: string;
    let secondShipmentNo: string;

    const login = async (account: string): Promise<string> => {
        const res = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account, password: "123456" },
        });
        return res.json().data.accessToken;
    };

    const createUser = async (account: string, role: string): Promise<string> => {
        const name = `联调${account.split("_")[1] ?? "用户"}`;
        const res = await app.inject({
            method: "POST",
            url: "/api/users",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-${RUN}-${account}` },
            payload: { name, account, role },
        });
        expect(res.statusCode).toBe(200);
        return name;
    };

    const post = async (
        url: string,
        token: string,
        payload: Record<string, unknown>,
        idemKey: string | undefined,
    ): Promise<ReturnType<NestFastifyApplication["inject"]>> =>
        app.inject({
            method: "POST",
            url,
            headers: {
                ...authHeaders(token),
                ...(idemKey ? { "idempotency-key": idemKey } : {}),
            },
            payload: payload as never,
        });

    /** 订单累计已发（v_order_outbound_qty 口径，经订单列表读取） */
    const outboundOfOrder = async (orderNo: string): Promise<number> => {
        const list = await app.inject({ method: "GET", url: "/api/orders", headers: authHeaders(superToken) });
        const mine = list.json().data.find((item: { orderNo: string }) => item.orderNo === orderNo);
        return mine?.outbound;
    };

    /** 固定测试 BOM：存在则复用（重跑不撞唯一键）；明细按建档冻结快照造数 */
    const ensureBom = async (
        bomCode: string,
        items: Array<{ groupKey: string; groupName: string; name: string; position: number }>,
    ) => {
        const existing = await prisma.bomTable.findUnique({ where: { bomCode } });
        if (existing) {
            return;
        }
        const category = await prisma.bomCategory.findUnique({ where: { categoryKey: "new-micro-switch" } });
        const superUser = await prisma.sysUser.findUnique({ where: { account: "guojun" } });
        const now = new Date();
        const bomId = snowflake.next();
        const materialIds = (
            await Promise.all(
                items.map(item =>
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
                bomCode,
                categoryId: category!.id,
                specHash: materialSetHash(
                    category!.id,
                    materialIds.map(id => ({ id: id.toString(), quantity: 1 })),
                    "",
                ),
                requestKey: `e2e-bom-${bomCode}`,
                createdBy: superUser!.id,
                updatedBy: superUser!.id,
                createdAt: now,
            },
        });
        await prisma.bomItem.createMany({
            data: items.map((item, index) => ({
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
    };

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        prisma = app.get(PrismaService);
        snowflake = app.get(SnowflakeGenerator);
        superToken = await login("guojun");

        warehouseName = await createUser(accountOf("wh01"), "warehouse");
        warehouseToken = await login(accountOf("wh01"));
        await createUser(accountOf("sales01"), "sales");

        await ensureBom(BOM_CODE, BOM_ITEMS);
        await ensureBom(CHAIN_BOM_CODE, CHAIN_BOM_ITEMS);

        // 测试客户与 600 件订单（核心场景前置）
        const customerRes = await post(
            "/api/customers",
            superToken,
            {
                name: `出入库联调客户_${RUN}`,
                contact: "陈仓管",
                phone: "13800003333",
                province: "广东省",
                city: "东莞市",
                district: "",
                town: "",
                address: `常平 ${RUN.slice(-3)} 号`,
                ownerAccount: accountOf("sales01"),
                payTerms: "",
            },
            `e2e-led-${RUN}-cust`,
        );
        expect(customerRes.statusCode).toBe(200);
        customerCode = customerRes.json().data.code;

        const orderRes = await post(
            "/api/orders",
            superToken,
            {
                customerCode,
                bomCode: BOM_CODE,
                qty: 600,
                deliverDate: "2026-10-31",
                orderDate: today(),
                remark: `e2e 出入库订单 ${RUN}`,
            },
            `e2e-led-${RUN}-order`,
        );
        expect(orderRes.statusCode).toBe(200);
        orderNo = orderRes.json().data.orderNo;
    });

    afterAll(async () => {
        await app.close();
    });

    it("sales 无入库登记权限 403；warehouse 可登记入库 200 件（RK 单号、登记人取服务端上下文）", async () => {
        await createUser(accountOf("sales02"), "sales");
        const salesToken = await login(accountOf("sales02"));
        const denied = await post("/api/inbound", salesToken, inboundInput(BOM_CODE, 1), `e2e-led-${RUN}-denied`);
        expect(denied.statusCode).toBe(403);
        expect(denied.json()).toEqual({ code: 403, data: null, message: "无权登记入库" });

        const created = await post("/api/inbound", warehouseToken, inboundInput(BOM_CODE, 200), `e2e-led-${RUN}-in200`);
        expect(created.statusCode).toBe(200);
        const row = created.json().data;
        expect(row.no).toMatch(/^RK\d{6}\d{2,}$/);
        expect(row).toMatchObject({
            bomCode: BOM_CODE,
            qty: 200,
            status: "active",
            version: 1,
            inspector: warehouseName,
            date: today(),
        });
        expect(row.time).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
        expect(row.createdAt).toBeDefined();
        expect(row.updatedBy).toBeUndefined();
        inboundNo = row.no;
    });

    it("入库幂等：缺 key 400；重放返回首次响应；同 key 不同体 409", async () => {
        const noKey = await post("/api/inbound", warehouseToken, inboundInput(BOM_CODE, 1), undefined);
        expect(noKey.statusCode).toBe(400);

        const key = `e2e-led-${RUN}-idem`;
        const first = await post("/api/inbound", warehouseToken, inboundInput(BOM_CODE, 5), key);
        expect(first.statusCode).toBe(200);
        const replay = await post("/api/inbound", warehouseToken, inboundInput(BOM_CODE, 5), key);
        expect(replay.statusCode).toBe(200);
        expect(replay.json().data).toEqual(first.json().data);
        const conflict = await post("/api/inbound", warehouseToken, inboundInput(BOM_CODE, 6), key);
        expect(conflict.statusCode).toBe(409);
    });

    it("核心场景：订单 600 发货 200 成功，订单累计已发 200；BOM/订单不存在 404", async () => {
        const missingOrder = await post(
            "/api/outbound",
            warehouseToken,
            outboundInput("ZM999999999", 1),
            `e2e-led-${RUN}-o404`,
        );
        expect(missingOrder.statusCode).toBe(404);
        expect(missingOrder.json().message).toBe("订单不存在");

        const shipped = await post(
            "/api/outbound",
            warehouseToken,
            outboundInput(orderNo, 200),
            `e2e-led-${RUN}-ship200`,
        );
        expect(shipped.statusCode).toBe(200);
        const row = shipped.json().data;
        expect(row.no).toMatch(/^CK\d{6}\d{2,}$/);
        expect(row).toMatchObject({
            orderNo,
            bomCode: BOM_CODE,
            qty: 200,
            state: "registered",
            version: 1,
            operator: warehouseName,
            date: today(),
        });
        firstShipmentNo = row.no;

        // 订单累计已发（v_order_outbound_qty 聚合口径）→ 销售订单侧可见发货进度
        expect(await outboundOfOrder(orderNo)).toBe(200);
    });

    it("可发量拦截（§6.2）：库存池仅剩幂等用例的 5 件，发 6 件 409", async () => {
        // 池 = 入库 200 + 幂等用例 5 − 已发 200 = 5；allowance = min(5, 600-200) = 5 < 6
        const over = await post("/api/outbound", warehouseToken, outboundInput(orderNo, 6), `e2e-led-${RUN}-over`);
        expect(over.statusCode).toBe(409);
        expect(over.json().message).toBe("库存可发量不足，请刷新后重试");
    });

    it("当天修正入库：数量 200→300 库存补足；版本 +1；updatedBy/updatedAt 返回", async () => {
        const stale = await app.inject({
            method: "PUT",
            url: `/api/inbound/${inboundNo}`,
            headers: authHeaders(warehouseToken),
            payload: {
                expectedVersion: 9,
                bomCode: BOM_CODE,
                qty: 300,
                date: today(),
                remark: "版本过期",
                reason: "数量核对",
            },
        });
        expect(stale.statusCode).toBe(409);

        const updated = await app.inject({
            method: "PUT",
            url: `/api/inbound/${inboundNo}`,
            headers: authHeaders(warehouseToken),
            payload: {
                expectedVersion: 1,
                bomCode: BOM_CODE,
                qty: 300,
                date: today(),
                remark: `e2e 入库修正 ${RUN}`,
                reason: "检验复核数量",
            },
        });
        expect(updated.statusCode).toBe(200);
        expect(updated.json().data).toMatchObject({ qty: 300, version: 2, status: "active" });
        expect(updated.json().data.updatedBy).toBe(warehouseName);
        expect(updated.json().data.updatedAt).toBeDefined();

        const logs = await prisma.inboundChangeLog.findMany({
            where: { inbound: { entryNo: inboundNo } },
        });
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
            eventType: "UPDATE",
            beforeVersion: 1n,
            afterVersion: 2n,
            reason: "检验复核数量",
        });
    });

    it("修正后库存可再发 100：累计已发 300", async () => {
        const shipped = await post(
            "/api/outbound",
            warehouseToken,
            outboundInput(orderNo, 100),
            `e2e-led-${RUN}-ship100`,
        );
        expect(shipped.statusCode).toBe(200);
        secondShipmentNo = shipped.json().data.no;
        expect(await outboundOfOrder(orderNo)).toBe(300);
    });

    it("出库作废：追加冲销后累计已发回落、库存恢复；作废幂等重放", async () => {
        const key = `e2e-led-${RUN}-voidship`;
        const voided = await post(
            `/api/outbound/${firstShipmentNo}/void`,
            warehouseToken,
            { expectedVersion: 1, reason: "登记数量有误" },
            key,
        );
        expect(voided.statusCode).toBe(200);
        expect(voided.json().data).toMatchObject({ no: firstShipmentNo, state: "voided", version: 2 });
        expect(voided.json().data.voidReason).toBe("登记数量有误");

        // 冲销流水成对：NORMAL +200 与 CORRECTION -200，净额归零 → 累计已发回落至 100
        expect(await outboundOfOrder(orderNo)).toBe(100);
        const events = await prisma.outboundLedger.findMany({
            where: { shipment: { shipmentNo: firstShipmentNo } },
            orderBy: { id: "asc" },
        });
        expect(events.map(event => event.qtyDelta)).toEqual([200, -200]);
        expect(events[1]).toMatchObject({ entryType: "CORRECTION", correctionReason: "登记数量有误" });

        const replay = await post(
            `/api/outbound/${firstShipmentNo}/void`,
            warehouseToken,
            { expectedVersion: 1, reason: "登记数量有误" },
            key,
        );
        expect(replay.statusCode).toBe(200);
        expect(replay.json().data).toEqual(voided.json().data);
    });

    it("第二张出库普通作废（任意已登记单可作废）：累计已发归零、冲销落库", async () => {
        const voided = await post(
            `/api/outbound/${secondShipmentNo}/void`,
            warehouseToken,
            { expectedVersion: 1, reason: "客户叫停发货" },
            `e2e-led-${RUN}-void2`,
        );
        expect(voided.statusCode).toBe(200);
        expect(voided.json().data).toMatchObject({ state: "voided", version: 2 });
        expect(await outboundOfOrder(orderNo)).toBe(0);

        const stateLogs = await prisma.outboundStateLog.findMany({
            where: { shipment: { shipmentNo: secondShipmentNo } },
            orderBy: { createdAt: "asc" },
        });
        expect(stateLogs.map(log => log.eventType)).toEqual(["REGISTER", "VOID"]);
    });

    it("入库作废：库存非负拦截与成功作废；已作废不可再改；跨天记录不可修正/作废", async () => {
        // 出库全部作废后池 = 305（300 入库 + 5 幂等，出库全部冲销）；先发 6 件
        // 让池 299 < 300，作废 300 的入库行才会越界
        const drain = await post("/api/outbound", warehouseToken, outboundInput(orderNo, 6), `e2e-led-${RUN}-drain`);
        expect(drain.statusCode).toBe(200);

        // 库存 299：作废 300 的入库行将使库存为负 → 409
        const negative = await post(
            `/api/inbound/${inboundNo}/void`,
            warehouseToken,
            { expectedVersion: 2, reason: "作废将导致负库存" },
            `e2e-led-${RUN}-void-neg`,
        );
        expect(negative.statusCode).toBe(409);
        expect(negative.json().message).toContain("请先到「成品出库」处理该成品的有效出库单");

        // 新入库 50 再作废：库存 50 → 0，允许
        const created = await post("/api/inbound", warehouseToken, inboundInput(BOM_CODE, 50), `e2e-led-${RUN}-in50`);
        expect(created.statusCode).toBe(200);
        const voided = await post(
            `/api/inbound/${created.json().data.no}/void`,
            warehouseToken,
            { expectedVersion: 1, reason: "检验不合格整批退回" },
            `e2e-led-${RUN}-void50`,
        );
        expect(voided.statusCode).toBe(200);
        expect(voided.json().data).toMatchObject({ status: "voided", version: 2 });

        // 已作废不可再修正/作废
        const editVoided = await app.inject({
            method: "PUT",
            url: `/api/inbound/${created.json().data.no}`,
            headers: authHeaders(warehouseToken),
            payload: { expectedVersion: 2, bomCode: BOM_CODE, qty: 10, date: today(), remark: "", reason: "再修正" },
        });
        expect(editVoided.statusCode).toBe(409);
        expect(editVoided.json().message).toBe("已作废入库记录不可再次修改");
        const revoid = await post(
            `/api/inbound/${created.json().data.no}/void`,
            warehouseToken,
            { expectedVersion: 2, reason: "重复作废" },
            `e2e-led-${RUN}-revoid`,
        );
        expect(revoid.statusCode).toBe(409);

        // 跨天记录（created_at 落在北京昨天）不可修正/作废（窗口按 created_at 判定）
        const superUser = await prisma.sysUser.findUnique({ where: { account: "guojun" } });
        const stale = await prisma.inboundLedger.create({
            data: {
                id: snowflake.next(),
                entryNo: `RKSTALE${RUN.slice(-6)}`,
                bomId: (await prisma.bomTable.findUnique({ where: { bomCode: BOM_CODE } }))!.id,
                qty: 10,
                businessDate: new Date(),
                operatorId: superUser!.id,
                remark: "昨天录入",
                requestKey: `e2e-stale-${RUN}`,
                updatedBy: superUser!.id,
                createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
                updatedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
            },
        });
        const editStale = await app.inject({
            method: "PUT",
            url: `/api/inbound/${stale.entryNo}`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: 1, bomCode: BOM_CODE, qty: 11, date: today(), remark: "", reason: "跨天修正" },
        });
        expect(editStale.statusCode).toBe(409);
        expect(editStale.json().message).toBe("只能修正北京时间当天录入的入库记录");
    });

    it("跨日库存调整（仅 super）：追加、负向非负校验、关联入库 BOM 一致性", async () => {
        const denied = await post(
            "/api/stock-adjustments",
            warehouseToken,
            { bomCode: BOM_CODE, qtyDelta: 1, date: today(), reason: "仓管无权调整" },
            `e2e-led-${RUN}-adj-denied`,
        );
        expect(denied.statusCode).toBe(403);

        const negative = await post(
            "/api/stock-adjustments",
            superToken,
            { bomCode: BOM_CODE, qtyDelta: -1000, date: today(), reason: "负向到负" },
            `e2e-led-${RUN}-adj-neg`,
        );
        expect(negative.statusCode).toBe(409);
        expect(negative.json().message).toBe("调整后库存不能小于 0");

        // 构造第二个 BOM 验证关联一致性（独立运行本套件时库内可能只有主 BOM）
        let otherBom = await prisma.bomTable.findFirst({ where: { bomCode: { not: BOM_CODE } } });
        if (!otherBom) {
            const category = await prisma.bomCategory.findUnique({ where: { categoryKey: "new-micro-switch" } });
            const superUser = await prisma.sysUser.findUnique({ where: { account: "guojun" } });
            const otherBase = await prisma.materialItem.findFirst({
                where: {
                    group: { name: "底座", category: { categoryKey: "new-micro-switch" } },
                    name: "三脚底座（有挡脚）",
                },
                select: { id: true },
            });
            otherBom = await prisma.bomTable.create({
                data: {
                    id: snowflake.next(),
                    bomCode: "ZME2E0003",
                    categoryId: category!.id,
                    specHash: materialSetHash(category!.id, [{ id: otherBase!.id.toString(), quantity: 1 }], ""),
                    requestKey: `e2e-bom-ZME2E0003-${RUN}`,
                    createdBy: superUser!.id,
                    updatedBy: superUser!.id,
                    createdAt: new Date(),
                },
            });
        }
        const mismatch = await post(
            "/api/stock-adjustments",
            superToken,
            {
                bomCode: otherBom.bomCode,
                qtyDelta: 1,
                date: today(),
                reason: "关联不一致",
                relatedInboundNo: inboundNo,
            },
            `e2e-led-${RUN}-adj-mismatch`,
        );
        expect(mismatch.statusCode).toBe(409);
        expect(mismatch.json().message).toBe("库存调整与关联入库单的 BOM 必须一致");

        const adjusted = await post(
            "/api/stock-adjustments",
            superToken,
            { bomCode: BOM_CODE, qtyDelta: 80, date: today(), reason: "盘点盈余补录", relatedInboundNo: inboundNo },
            `e2e-led-${RUN}-adj80`,
        );
        expect(adjusted.statusCode).toBe(200);
        expect(adjusted.json().data).toMatchObject({
            bomCode: BOM_CODE,
            qtyDelta: 80,
            operator: "郭均",
            relatedInboundNo: inboundNo,
        });
        expect(adjusted.json().data.no).toMatch(/^TZ-\d{8}-\d{4,}$/);

        const list = await app.inject({
            method: "GET",
            url: "/api/stock-adjustments",
            headers: authHeaders(warehouseToken),
        });
        expect(list.statusCode).toBe(200);
        expect(list.json().data.some((row: { no: string }) => row.no === adjusted.json().data.no)).toBe(true);
    });

    it("台账列表返回 active/voided 全量；出库列表含状态派生字段；员工可见入库台账", async () => {
        const inbound = await app.inject({ method: "GET", url: "/api/inbound", headers: authHeaders(warehouseToken) });
        expect(inbound.statusCode).toBe(200);
        const mine = inbound.json().data.filter((row: { bomCode: string }) => row.bomCode === BOM_CODE);
        expect(mine.length).toBeGreaterThanOrEqual(3); // 200→300 修正行 + 5(幂等) + 50(已作废)
        expect(mine.some((row: { status: string }) => row.status === "voided")).toBe(true);
        expect(mine.some((row: { status: string }) => row.status === "active")).toBe(true);

        const outbound = await app.inject({ method: "GET", url: "/api/outbound", headers: authHeaders(superToken) });
        expect(outbound.statusCode).toBe(200);
        const shipped = outbound.json().data.filter((row: { orderNo: string }) => row.orderNo === orderNo);
        expect(shipped.length).toBe(3);
        expect(shipped).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ no: firstShipmentNo, state: "voided", voidReason: "登记数量有误" }),
                expect.objectContaining({ no: secondShipmentNo, state: "voided", voidReason: "客户叫停发货" }),
                expect.objectContaining({ qty: 6, state: "registered" }),
            ]),
        );
    });

    it("删除已作废入库：sales 403、ACTIVE 409、删除归一 null 且幂等、软删除标记 + op_log 快照、列表不再返回、调整单关联已删除单 404", async () => {
        // 新入库 → 作废 → 删除（仓管全链路）
        const created = await post("/api/inbound", warehouseToken, inboundInput(BOM_CODE, 7), `e2e-led-${RUN}-dely-in`);
        expect(created.statusCode).toBe(200);
        const inNo = created.json().data.no;
        const voided = await post(
            `/api/inbound/${inNo}/void`,
            warehouseToken,
            { expectedVersion: 1, reason: "录错了走删除链" },
            `e2e-led-${RUN}-dely-void`,
        );
        expect(voided.statusCode).toBe(200);
        const voidVersion = voided.json().data.version;

        const salesToken = await login(accountOf("sales02"));
        const denied = await post(
            `/api/inbound/${inNo}/delete`,
            salesToken,
            { expectedVersion: voidVersion },
            `e2e-led-${RUN}-dely-denied`,
        );
        expect(denied.statusCode).toBe(403);
        expect(denied.json().message).toBe("无权删除入库记录");

        // ACTIVE 单必须先作废
        const active = await post("/api/inbound", warehouseToken, inboundInput(BOM_CODE, 3), `e2e-led-${RUN}-dely-act`);
        const notVoided = await post(
            `/api/inbound/${active.json().data.no}/delete`,
            warehouseToken,
            { expectedVersion: 1 },
            `e2e-led-${RUN}-dely-nv`,
        );
        expect(notVoided.statusCode).toBe(409);
        expect(notVoided.json().message).toBe("仅已作废的入库记录可删除，请先作废");

        const del = await post(
            `/api/inbound/${inNo}/delete`,
            warehouseToken,
            { expectedVersion: voidVersion },
            `e2e-led-${RUN}-dely-in1`,
        );
        expect(del.statusCode).toBe(200);
        expect(del.json().data).toBeNull();
        // 重放归一 null（删除契约响应恒 null）
        const replay = await post(
            `/api/inbound/${inNo}/delete`,
            warehouseToken,
            { expectedVersion: voidVersion },
            `e2e-led-${RUN}-dely-in1`,
        );
        expect(replay.statusCode).toBe(200);
        expect(replay.json().data).toBeNull();

        // 列表不再返回；数据库行保留软删除标记；op_log 冻结快照（含作废原因）
        const list = await app.inject({ method: "GET", url: "/api/inbound", headers: authHeaders(superToken) });
        expect(list.json().data.some((row: { no: string }) => row.no === inNo)).toBe(false);
        // 行保留软删除标记：e2e 侧 PrismaService 同样带全局软删注入,改用 raw 断言
        const [softDeleted] = await prisma.$queryRaw<Array<{ deleted_at: Date | null }>>`
            SELECT deleted_at FROM inbound_ledger WHERE entry_no = ${inNo}
        `;
        expect(softDeleted?.deleted_at).not.toBeNull();
        const opLog = await prisma.opLog.findFirst({ where: { action: "delete_inbound", targetCode: inNo } });
        expect(opLog).not.toBeNull();
        expect(opLog!.detailJson).toMatchObject({ no: inNo, voidReason: "录错了走删除链" });

        // 已删除单不可再被新调整单关联（否则清理任务会因引用永久跳过该行）
        const linkDeleted = await post(
            "/api/stock-adjustments",
            superToken,
            { bomCode: BOM_CODE, qtyDelta: 1, date: today(), reason: "关联已删除单", relatedInboundNo: inNo },
            `e2e-led-${RUN}-dely-link`,
        );
        expect(linkDeleted.statusCode).toBe(404);
        expect(linkDeleted.json().message).toBe("关联入库单不存在或已删除");

        // 被调整单引用的已作废入库不可删（物理清理 FK 安全的前置保证）
        const linked = await post("/api/inbound", warehouseToken, inboundInput(BOM_CODE, 5), `e2e-led-${RUN}-dely-lk`);
        const linkedVoid = await post(
            `/api/inbound/${linked.json().data.no}/void`,
            warehouseToken,
            { expectedVersion: 1, reason: "被调整单引用" },
            `e2e-led-${RUN}-dely-lkv`,
        );
        const adj = await post(
            "/api/stock-adjustments",
            superToken,
            {
                bomCode: BOM_CODE,
                qtyDelta: 1,
                date: today(),
                reason: "引用后禁止删除",
                relatedInboundNo: linked.json().data.no,
            },
            `e2e-led-${RUN}-dely-adj`,
        );
        expect(adj.statusCode).toBe(200);
        const blocked = await post(
            `/api/inbound/${linked.json().data.no}/delete`,
            warehouseToken,
            { expectedVersion: linkedVoid.json().data.version },
            `e2e-led-${RUN}-dely-blk`,
        );
        expect(blocked.statusCode).toBe(409);
        expect(blocked.json().message).toBe("存在关联的库存调整单，不可删除");
    });

    it("删除已作废出库 + 物理清理：订单已发恢复、清理后行与子日志消失而 op_log 仍在、订单删除放行、软删除行挡 BOM 删除直至清理", async () => {
        // 先补库存：前面用例已把共享库存池消耗到低位，发货 40 需要可发量充足
        const stockIn = await post(
            "/api/inbound",
            warehouseToken,
            inboundInput(BOM_CODE, 200),
            `e2e-led-${RUN}-delo-stock`,
        );
        expect(stockIn.statusCode).toBe(200);

        // 新订单 40 件 → 发货 40 → 作废 → 删除出库 → 立即删除订单 → 保留期后统一清理
        // 交货日期早于其他用例的订单（§6.2 按交货日期升序分配共享库存池），保证补的库存先分给本单
        const orderRes = await post(
            "/api/orders",
            superToken,
            {
                customerCode,
                bomCode: BOM_CODE,
                qty: 40,
                deliverDate: "2026-09-30",
                orderDate: today(),
                remark: `e2e 删除链订单 ${RUN}`,
            },
            `e2e-led-${RUN}-delo-order`,
        );
        expect(orderRes.statusCode).toBe(200);
        const deloOrderNo = orderRes.json().data.orderNo;

        const shipInput = outboundInput(deloOrderNo, 40);
        const shipRes = await post("/api/outbound", warehouseToken, shipInput, `e2e-led-${RUN}-delo-ship`);
        expect(shipRes.statusCode).toBe(200);
        const shipNo = shipRes.json().data.no;
        expect(await outboundOfOrder(deloOrderNo)).toBe(40);

        const shipVoid = await post(
            `/api/outbound/${shipNo}/void`,
            warehouseToken,
            { expectedVersion: 1, reason: "发货作废后删除" },
            `e2e-led-${RUN}-delo-void`,
        );
        expect(shipVoid.statusCode).toBe(200);
        expect(await outboundOfOrder(deloOrderNo)).toBe(0);
        const stockLedgerBefore = await app.inject({
            method: "GET",
            url: `/api/bom-stocks/${BOM_CODE}/ledger`,
            headers: authHeaders(superToken),
        });
        expect(stockLedgerBefore.statusCode).toBe(200);
        // 净额口径统一(v_outbound_effective_event):作废单的正向与冲销事件成对入流水,
        // 净额 0、结余与 v_bom_stock 恒等;软删后才随事件一并消失
        const voidedFlows = stockLedgerBefore.json().data.flows.filter((flow: { no: string }) => flow.no === shipNo);
        expect(voidedFlows).toHaveLength(2);
        expect(voidedFlows.reduce((sum: number, flow: { qty: number }) => sum + flow.qty, 0)).toBe(0);

        const shipDel = await post(
            `/api/outbound/${shipNo}/delete`,
            warehouseToken,
            { expectedVersion: shipVoid.json().data.version },
            `e2e-led-${RUN}-delo-del`,
        );
        expect(shipDel.statusCode).toBe(200);
        expect(shipDel.json().data).toBeNull();
        const outList = await app.inject({ method: "GET", url: "/api/outbound", headers: authHeaders(superToken) });
        expect(outList.json().data.some((row: { no: string }) => row.no === shipNo)).toBe(false);
        const stockLedgerAfter = await app.inject({
            method: "GET",
            url: `/api/bom-stocks/${BOM_CODE}/ledger`,
            headers: authHeaders(superToken),
        });
        expect(stockLedgerAfter.statusCode).toBe(200);
        expect(stockLedgerAfter.json().data.flows.some((flow: { no: string }) => flow.no === shipNo)).toBe(false);

        // 出库单软删除后即可删除订单；业务列表立即隐藏，外键行保留至 7 天清理。
        const orderDel = await post(
            `/api/orders/${deloOrderNo}/delete`,
            superToken,
            { expectedVersion: 1 },
            `e2e-led-${RUN}-delo-odel`,
        );
        expect(orderDel.statusCode).toBe(200);
        expect(orderDel.json().data).toBeNull();
        expect(await outboundOfOrder(deloOrderNo)).toBeUndefined();
        expect(
            (await prisma.salesOrderTable.findUnique({ where: { orderNo: deloOrderNo } }))?.deletedAt,
        ).not.toBeNull();

        // 软删除行存在时 deleteBom 仍被流水校验挡住（与 FK RESTRICT 口径一致）；
        // 链条 BOM 用专用夹具，不随机借用（见 CHAIN_BOM_CODE 注释）
        const chainBom = await prisma.bomTable.findUnique({ where: { bomCode: CHAIN_BOM_CODE } });
        const chainIn = await post(
            "/api/inbound",
            warehouseToken,
            inboundInput(chainBom!.bomCode, 2),
            `e2e-led-${RUN}-delo-cin`,
        );
        expect(chainIn.statusCode).toBe(200);
        const chainVoid = await post(
            `/api/inbound/${chainIn.json().data.no}/void`,
            warehouseToken,
            { expectedVersion: 1, reason: "BOM 恢复链验证" },
            `e2e-led-${RUN}-delo-cv`,
        );
        expect(chainVoid.statusCode).toBe(200);
        await post(
            `/api/inbound/${chainIn.json().data.no}/delete`,
            warehouseToken,
            { expectedVersion: chainVoid.json().data.version },
            `e2e-led-${RUN}-delo-cd`,
        );
        const bomBlocked = await post(
            `/api/boms/${chainBom!.bomCode}/delete`,
            superToken,
            {},
            `e2e-led-${RUN}-delo-bomblk`,
        );
        expect(bomBlocked.statusCode).toBe(409);
        expect(bomBlocked.json().message).toBe("BOM 已有入库或库存调整流水，不可删除");

        // 物理清理（cutoff 传未来时刻 = 全部到期）：行与子日志同清、op_log 快照仍在
        // 软删行断言走 raw：e2e 侧 PrismaService 带全局软删注入，已删行对 findUnique 不可见
        const [shipmentRow] = await prisma.$queryRaw<Array<{ id: bigint }>>`
            SELECT id FROM outbound_shipment WHERE shipment_no = ${shipNo}
        `;
        expect(shipmentRow).not.toBeNull();
        expect(await prisma.outboundLedger.count({ where: { shipmentId: shipmentRow!.id } })).toBe(2); // NORMAL + CORRECTION
        expect(await prisma.outboundStateLog.count({ where: { shipmentId: shipmentRow!.id } })).toBeGreaterThanOrEqual(
            2,
        );

        const purgeService = app.get(LedgerPurgeService);
        const counts = await purgeService.purge(new Date(Date.now() + 60_000));
        expect(counts.inbound).toBeGreaterThanOrEqual(2);
        expect(counts.outbound).toBeGreaterThanOrEqual(1);
        expect(counts.orders).toBeGreaterThanOrEqual(1);
        expect(await prisma.outboundShipment.findUnique({ where: { shipmentNo: shipNo } })).toBeNull();
        expect(await prisma.outboundLedger.count({ where: { shipmentId: shipmentRow!.id } })).toBe(0);
        expect(await prisma.outboundStateLog.count({ where: { shipmentId: shipmentRow!.id } })).toBe(0);
        expect(await prisma.inboundLedger.findUnique({ where: { entryNo: chainIn.json().data.no } })).toBeNull();
        expect(await prisma.salesOrderTable.findUnique({ where: { orderNo: deloOrderNo } })).toBeNull();
        const deleteLog = await prisma.opLog.findFirst({ where: { action: "delete_outbound", targetCode: shipNo } });
        expect(deleteLog?.detailJson).toMatchObject({
            no: shipNo,
            remark: shipInput.remark,
            state: "voided",
            voidReason: "发货作废后删除",
        });
        // 清理后 BOM 的入库流水消失，删除放行——"入库→作废→删除→删 BOM"恢复链走通
        const bomDel = await post(
            `/api/boms/${chainBom!.bomCode}/delete`,
            superToken,
            {},
            `e2e-led-${RUN}-delo-bomdel`,
        );
        expect(bomDel.statusCode).toBe(200);
    });
});

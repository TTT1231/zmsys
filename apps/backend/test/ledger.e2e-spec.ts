/**
 * 成品出入库集成测试：真实 HTTP 管线 + 真实测试库（*_test 种子数据）。
 * 覆盖用户核心场景：销售订单 600 件 → 入库 200 → 发货 200 → 订单累计已发 200；
 * 以及 §6.2 可发量拦截、§7.1 当天修正/作废窗口、库存调整、打印与紧急撤销。
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

/** 固定测试 BOM（重跑复用，不撞唯一键） */
const BOM_CODE = "ZME2E0002";
const BOM_ITEMS = [
    { groupKey: "base", groupName: "底座", name: "二脚底座（无挡脚）", position: 1 },
    { groupKey: "button", groupName: "按钮", name: "7.6mm（常用装跌倒）", position: 2 },
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
    let secondShipmentNoForEmergency: string;

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
                    specHash: materialSetHash(materialIds.map(id => ({ id: id.toString(), quantity: 1 }))),
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
            printVersion: 0,
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

    it("修正后库存可再发 100：累计已发 300；打印后不可普通作废", async () => {
        const shipped = await post(
            "/api/outbound",
            warehouseToken,
            outboundInput(orderNo, 100),
            `e2e-led-${RUN}-ship100`,
        );
        expect(shipped.statusCode).toBe(200);
        const secondShipmentNo = shipped.json().data.no;
        expect(await outboundOfOrder(orderNo)).toBe(300);

        // 首次打印：REGISTERED → PRINTED，文档快照与规格摘要
        const printed = await post(
            `/api/outbound/${secondShipmentNo}/print`,
            superToken,
            { expectedVersion: 1 },
            `e2e-led-${RUN}-print1`,
        );
        expect(printed.statusCode).toBe(200);
        const result = printed.json().data;
        expect(result.printVersion).toBe(1);
        expect(result.outbound).toMatchObject({ no: secondShipmentNo, state: "printed", version: 2, printVersion: 1 });
        expect(result.document).toMatchObject({
            no: secondShipmentNo,
            orderNo,
            qty: 100,
            printedBy: "郭均",
            bomSpec: expect.stringContaining("底座：二脚底座（无挡脚）"),
        });

        // 已打印出库不可普通作废
        const voidPrinted = await post(
            `/api/outbound/${secondShipmentNo}/void`,
            warehouseToken,
            { expectedVersion: 2, reason: "打印后作废" },
            `e2e-led-${RUN}-vp`,
        );
        expect(voidPrinted.statusCode).toBe(409);
        expect(voidPrinted.json().message).toBe("只有未打印的出库单可以由仓管作废");

        // 重打必须填写原因
        const reprintNoReason = await post(
            `/api/outbound/${secondShipmentNo}/print`,
            superToken,
            { expectedVersion: 2 },
            `e2e-led-${RUN}-print2a`,
        );
        expect(reprintNoReason.statusCode).toBe(400);

        const reprint = await post(
            `/api/outbound/${secondShipmentNo}/print`,
            superToken,
            { expectedVersion: 2, reason: "纸质单遗失重打" },
            `e2e-led-${RUN}-print2b`,
        );
        expect(reprint.statusCode).toBe(200);
        expect(reprint.json().data.printVersion).toBe(2);
        expect(reprint.json().data.outbound).toMatchObject({ state: "printed", version: 3, printVersion: 2 });

        const printLogs = await prisma.outboundPrintLog.findMany({
            where: { shipment: { shipmentNo: secondShipmentNo } },
            orderBy: { printSeq: "asc" },
        });
        expect(printLogs).toHaveLength(2);
        expect(printLogs[0]!.reason).toBe("");
        expect(printLogs[1]!.reason).toBe("纸质单遗失重打");
        secondShipmentNoForEmergency = secondShipmentNo;
    });

    it("出库作废（未打印）：追加冲销后累计已发回落、库存恢复；作废幂等重放", async () => {
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

    it("紧急撤销（仅 super）：PRINTED → VOIDED，累计已发归零、冲销落库", async () => {
        const denied = await post(
            `/api/outbound/${secondShipmentNoForEmergency}/emergency-void`,
            warehouseToken,
            { expectedVersion: 3, reason: "仓管无权", goodsNotDeparted: true, paperInvalidated: true },
            `e2e-led-${RUN}-ev-denied`,
        );
        expect(denied.statusCode).toBe(403);

        const emergency = await post(
            `/api/outbound/${secondShipmentNoForEmergency}/emergency-void`,
            superToken,
            { expectedVersion: 3, reason: "货物未离开，客户叫停", goodsNotDeparted: true, paperInvalidated: true },
            `e2e-led-${RUN}-ev`,
        );
        expect(emergency.statusCode).toBe(200);
        expect(emergency.json().data).toMatchObject({ state: "voided", version: 4 });
        expect(await outboundOfOrder(orderNo)).toBe(0);

        const stored = await prisma.outboundShipment.findUnique({
            where: { shipmentNo: secondShipmentNoForEmergency },
        });
        expect(stored).toMatchObject({ voidMode: "EMERGENCY", goodsNotDeparted: true, paperInvalidated: true });
        const stateLogs = await prisma.outboundStateLog.findMany({
            where: { shipment: { shipmentNo: secondShipmentNoForEmergency } },
            orderBy: { createdAt: "asc" },
        });
        expect(stateLogs.map(log => log.eventType)).toEqual(["REGISTER", "PRINT", "REPRINT", "VOID_EMERGENCY"]);
    });

    it("入库作废：库存非负拦截与成功作废；已作废不可再改；跨天记录不可修正/作废", async () => {
        // 紧急撤销后池 = 305（300 入库 + 5 幂等，出库全部冲销）；先发 6 件
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
        expect(negative.json().message).toBe("作废后库存将小于 0，请先核对相关出库记录");

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
                    specHash: materialSetHash([{ id: otherBase!.id.toString(), quantity: 1 }]),
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
                expect.objectContaining({ no: secondShipmentNoForEmergency, state: "voided", printVersion: 2 }),
                expect.objectContaining({ qty: 6, state: "registered" }),
            ]),
        );
    });
});

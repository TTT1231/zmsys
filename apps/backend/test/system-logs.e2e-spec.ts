/**
 * 系统日志聚合端点集成测试：真实 HTTP 管线 + 真实测试库。
 * 覆盖权限（仅 super）、四来源动作映射、domain/action 筛选、关键词（操作人/
 * 编号/名称）、时间范围（today/custom 校验）与复合游标分批一致性。
 * 断言用 keyword 收敛到本套件 RUN 标识数据（测试库为共享库，其他套件同日造数）。
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

/** 专用测试 BOM：不与 orders 套件共用——同 BOM 库存池按交期升序分配给全部活动
 *  订单，orders 留下的 2026 交期残单会先占池，本套件 2027 交期订单就发不出货
 *  （全量跑时文件顺序决定成败）。备注参与 spec_hash，与 orders 同明细空备注的
 *  BOM 身份区分开，避免撞 uk_bom_identity。 */
const BOM_CODE = "ZME2ESL01";
const BOM_REMARK = "e2e 日志 BOM 备注";
const BOM_ITEMS = [
    { groupKey: "base", groupName: "底座", name: "三脚底座（有挡脚）", position: 1 },
    { groupKey: "button", groupName: "按钮", name: "8.5mm", position: 2 },
];
const accountOf = (name: string): string => `qa_${name}_${RUN}`;
const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });
const today = (): string => new Date().toISOString().slice(0, 10);

describe("系统日志 (e2e)", () => {
    let app: NestFastifyApplication;
    let prisma: PrismaService;
    let snowflake: SnowflakeGenerator;
    let superToken: string;
    let salesToken: string;
    let bomCode: string;
    let customerCodeA: string;
    let orderNo: string;
    let orderNo2: string;

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
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-sl-${RUN}-${account}` },
            payload: { name: `日志联调${account.split("_")[1] ?? "用户"}`, account, role },
        });
        expect(res.statusCode).toBe(200);
    };

    const post = async (
        url: string,
        token: string,
        payload: Record<string, unknown>,
        idemKey: string,
    ): Promise<{ statusCode: number; body: Record<string, unknown> & { data?: unknown; message?: string } }> => {
        const res = await app.inject({
            method: "POST",
            url: `/api${url}`,
            headers: { ...authHeaders(token), "idempotency-key": idemKey },
            payload,
        });
        return { statusCode: res.statusCode, body: res.json() };
    };

    const logs = async (token: string, query: string): Promise<Record<string, unknown> & { data?: unknown }> => {
        const res = await app.inject({
            method: "GET",
            url: `/api/system-logs${query}`,
            headers: authHeaders(token),
        });
        return { statusCode: res.statusCode, ...(res.json() as Record<string, unknown>) };
    };

    const entriesOf = (body: { data?: unknown }): Array<Record<string, unknown>> =>
        (body.data as { items: Array<Record<string, unknown>> }).items;

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        prisma = app.get(PrismaService);
        snowflake = app.get(SnowflakeGenerator);
        superToken = await login("guojun");

        // 专用 BOM：存在则复用（重跑不撞唯一键）；哈希输入与建档 remark 同源，
        // 订单日志的 BOM 备注断言取的就是它
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
                        BOM_REMARK,
                    ),
                    requestKey: `e2e-bom-${BOM_CODE}`,
                    remark: BOM_REMARK,
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
        bomCode = BOM_CODE;

        const salesAccount = accountOf("sales01");
        const sales02Account = accountOf("sales02");
        await createUser(salesAccount, "sales");
        await createUser(sales02Account, "sales");
        await createUser(accountOf("wh01"), "warehouse");
        salesToken = await login(salesAccount);
        const warehouseToken = await login(accountOf("wh01"));

        // 客户 A：创建 + 编辑（联系人/电话变更）
        const customerA = await post(
            "/customers",
            superToken,
            {
                name: `日志客户甲_${RUN}`,
                contact: "陈敏",
                phone: "13800001111",
                province: "广东省",
                city: "深圳市",
                district: "",
                town: "",
                address: `科技园 ${RUN.slice(-3)} 号`,
                ownerAccount: salesAccount,
                payTerms: "月结 30 天",
            },
            `e2e-sl-${RUN}-cust-a`,
        );
        expect(customerA.statusCode).toBe(200);
        customerCodeA = (customerA.body.data as { code: string }).code;
        const edited = await app.inject({
            method: "PUT",
            url: `/api/customers/${customerCodeA}`,
            headers: authHeaders(superToken),
            payload: {
                expectedVersion: 1,
                name: `日志客户甲_${RUN}`,
                contact: "林悦",
                phone: "13900002222",
                province: "广东省",
                city: "深圳市",
                district: "",
                town: "",
                address: `科技园 ${RUN.slice(-3)} 号`,
                ownerAccount: salesAccount,
                payTerms: "月结 45 天",
            },
        });
        expect(edited.statusCode).toBe(200);

        // 客户 B：归 sales02，供离岗移交
        const customerB = await post(
            "/customers",
            superToken,
            {
                name: `日志客户乙_${RUN}`,
                contact: "周宁",
                phone: "13800003333",
                province: "广东省",
                city: "东莞市",
                district: "",
                town: "",
                address: `常平 ${RUN.slice(-3)} 号`,
                ownerAccount: sales02Account,
                payTerms: "",
            },
            `e2e-sl-${RUN}-cust-b`,
        );
        expect(customerB.statusCode).toBe(200);

        // 订单：创建 + 编辑（order/edit 走 change_log UPDATE）
        const order = await post(
            "/orders",
            superToken,
            {
                customerCode: customerCodeA,
                bomCode,
                qty: 500,
                deliverDate: "2027-06-30",
                orderDate: today(),
                remark: `e2e 系统日志订单 ${RUN}`,
            },
            `e2e-sl-${RUN}-order`,
        );
        expect(order.statusCode).toBe(200);
        orderNo = (order.body.data as { orderNo: string }).orderNo;
        const orderEdit = await app.inject({
            method: "PUT",
            url: `/api/orders/${orderNo}`,
            headers: authHeaders(superToken),
            payload: { expectedVersion: 1, qty: 600, deliverDate: "2027-07-15", remark: "加急" },
        });
        expect(orderEdit.statusCode).toBe(200);

        // 入库：创建 + 当天修正（inbound/edit 走 inbound_change_log UPDATE）
        const inbound = await post(
            "/inbound",
            warehouseToken,
            { bomCode, qty: 300, date: today(), remark: `e2e 日志入库 ${RUN}` },
            `e2e-sl-${RUN}-in`,
        );
        expect(inbound.statusCode).toBe(200);
        const entryNo = (inbound.body.data as { no: string }).no;
        const inboundEdit = await app.inject({
            method: "PUT",
            url: `/api/inbound/${entryNo}`,
            headers: authHeaders(warehouseToken),
            payload: {
                expectedVersion: 1,
                bomCode,
                qty: 280,
                date: today(),
                remark: "修正为 280",
                reason: "登记数量有误",
            },
        });
        expect(inboundEdit.statusCode).toBe(200);

        // 库存调整（adjust 臂）：关联上述入库
        const adjustment = await post(
            "/stock-adjustments",
            superToken,
            { bomCode, qtyDelta: 20, date: today(), reason: `e2e 日志调整 ${RUN}`, relatedInboundNo: entryNo },
            `e2e-sl-${RUN}-adj`,
        );
        expect(adjustment.statusCode).toBe(200);

        // 发货（ship）：订单可发量充足（入库 280 + 调整 20）
        const ship = await post(
            "/outbound",
            warehouseToken,
            { orderNo, qty: 40, date: today(), remark: "首批" },
            `e2e-sl-${RUN}-ship`,
        );
        expect(ship.statusCode).toBe(200);

        // 归档订单 1（archive 事件：已发 40 满足归档前提；编辑后版本 2）
        const archive = await post(
            `/orders/${orderNo}/archive`,
            superToken,
            { expectedVersion: 2, reason: "行情不好客户弃单" },
            `e2e-sl-${RUN}-arc`,
        );
        expect(archive.statusCode).toBe(200);

        // 订单 2：整单发货后作废（void_outbound 事件）——归档单的出库不可作废，用独立订单
        const order2 = await post(
            "/orders",
            superToken,
            {
                customerCode: customerCodeA,
                bomCode,
                qty: 50,
                deliverDate: "2027-06-30",
                orderDate: today(),
                remark: `e2e 日志订单二 ${RUN}`,
            },
            `e2e-sl-${RUN}-order2`,
        );
        expect(order2.statusCode).toBe(200);
        orderNo2 = (order2.body.data as { orderNo: string }).orderNo;
        const ship2 = await post(
            "/outbound",
            warehouseToken,
            { orderNo: orderNo2, qty: 50, date: today(), remark: "整单发" },
            `e2e-sl-${RUN}-ship2`,
        );
        expect(ship2.statusCode).toBe(200);
        const voided = await post(
            `/outbound/${(ship2.body.data as { no: string }).no}/void`,
            warehouseToken,
            { expectedVersion: 1, reason: "发货对象有误" },
            `e2e-sl-${RUN}-void`,
        );
        expect(voided.statusCode).toBe(200);

        // 离岗移交：停用 sales02，客户 B 移交 sales01（transfer 事件）
        const sales02 = await prisma.sysUser.findUnique({ where: { account: sales02Account } });
        const disable = await app.inject({
            method: "PATCH",
            url: `/api/users/${sales02Account}/status`,
            headers: authHeaders(superToken),
            payload: {
                expectedVersion: Number(sales02!.rowVersion),
                active: false,
                replacementOwnerAccount: salesAccount,
                transferReason: "原负责人离岗，统一移交客户",
            },
        });
        expect(disable.statusCode).toBe(200);
    });

    afterAll(async () => {
        await app.close();
    });

    it("未登录 401；普通角色（sales）403——受保护权限仅 super", async () => {
        const anonymous = await app.inject({ method: "GET", url: "/api/system-logs" });
        expect(anonymous.statusCode).toBe(401);

        const denied = await logs(salesToken, "");
        expect(denied.statusCode).toBe(403);
        expect(denied.message).toBe("仅超级管理员可查看系统日志");
    });

    it("备份与恢复审计留在 op_log，不混入业务时间线", async () => {
        const targetCode = `e2e-system-audit-${RUN}`;
        await prisma.opLog.createMany({
            data: (["db_backup", "db_restore"] as const).map(action => ({
                id: snowflake.next(),
                operatorId: 1n,
                operatorNameSnapshot: "郭均",
                operatorRoleSnapshot: "super",
                action,
                targetType: "system",
                targetId: 0n,
                targetCode,
                detailJson: {},
                createdAt: new Date(),
            })),
        });
        try {
            const page = await logs(superToken, `?keyword=${targetCode}&limit=100`);
            expect(page.statusCode).toBe(200);
            expect(entriesOf(page)).toEqual([]);
        } finally {
            await prisma.opLog.deleteMany({ where: { targetCode } });
        }
    });

    it("订单域聚合：create/edit/archive 三来源（op_log×2 + change_log）且字段形态完整", async () => {
        const page = await logs(superToken, `?domain=order&keyword=${orderNo}&limit=100`);
        expect(page.statusCode).toBe(200);
        const items = entriesOf(page);
        expect(items).toHaveLength(3);
        const byAction = new Map(items.map(item => [item.action as string, item]));
        const created = byAction.get("create")!;
        const edited = byAction.get("edit")!;
        const archived = byAction.get("archive")!;
        expect(created.targetCode).toBe(orderNo);
        expect(created.targetName).toBe(`日志客户甲_${RUN}`);
        expect(created.actor).toEqual({ name: "郭均", role: "super" });
        expect(created.changes).toEqual([
            { key: "customer", label: "客户", before: null, after: `日志客户甲_${RUN}` },
            { key: "bomCode", label: "BOM 编码", before: null, after: BOM_CODE },
            { key: "bomName", label: "成品名称", before: null, after: "新微动" },
            { key: "bomSpec", label: "规格构成", before: null, after: "底座：三脚底座（有挡脚） · 按钮：8.5mm" },
            { key: "bomRemark", label: "BOM 备注", before: null, after: BOM_REMARK },
            { key: "qty", label: "订单数量", before: null, after: "500 个" },
            { key: "deliverDate", label: "交货日期", before: null, after: "2027-06-30" },
            { key: "remark", label: "备注", before: null, after: `e2e 系统日志订单 ${RUN}` },
        ]);
        expect(edited.changes).toEqual([
            { key: "qty", label: "订单数量", before: "500 个", after: "600 个" },
            { key: "deliverDate", label: "交货日期", before: "2027-06-30", after: "2027-07-15" },
            { key: "remark", label: "备注", before: `e2e 系统日志订单 ${RUN}`, after: "加急" },
        ]);
        // 归档：状态由进行中推断为已归档，快照数量为归档时口径，reason 透出
        expect(archived).toMatchObject({
            domain: "order",
            targetCode: orderNo,
            reason: "行情不好客户弃单",
        });
        expect(archived.changes).toEqual([
            { key: "customer", label: "客户", before: null, after: `日志客户甲_${RUN}` },
            { key: "lifecycleStatus", label: "订单状态", before: "进行中", after: "已归档" },
            { key: "qty", label: "订单数量", before: null, after: "600 个" },
        ]);
        // id 为雪花串（BigInt 精度往返）；时间线降序（归档晚于编辑晚于创建）
        expect(created.id).toMatch(/^[0-9]+$/);
        expect(created.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(items.map(item => item.action)).toEqual(["archive", "edit", "create"]);
    });

    it("回退归档：unarchive 事件进订单域时间线（已归档→进行中）且 action 筛选命中", async () => {
        // 独立订单（keyword 隔离）：直插出库流水满足归档前提，归档后由归档人回退
        const order = await post(
            "/orders",
            superToken,
            {
                customerCode: customerCodeA,
                bomCode,
                qty: 100,
                deliverDate: "2027-06-30",
                orderDate: today(),
                remark: `e2e 日志回退订单 ${RUN}`,
            },
            `e2e-sl-${RUN}-unarc-order`,
        );
        expect(order.statusCode).toBe(200);
        const targetNo = (order.body.data as { orderNo: string }).orderNo;

        const superUser = await prisma.sysUser.findUnique({ where: { account: "guojun" } });
        const orderId = (await prisma.salesOrderTable.findUnique({ where: { orderNo: targetNo } }))!.id;
        const now = new Date();
        await prisma.outboundShipment.create({
            data: {
                id: snowflake.next(),
                shipmentNo: `CKE2ESL${RUN}`,
                orderId,
                originalQty: 30,
                businessDate: now,
                state: "REGISTERED",
                requestKey: `e2e-sl-${RUN}-unarc-ship`,
                registeredBy: superUser!.id,
                registeredAt: now,
            },
        });
        await prisma.outboundLedger.create({
            data: {
                id: snowflake.next(),
                eventNo: `CKE2ESL${RUN}-E1`,
                shipmentId: (await prisma.outboundShipment.findUnique({ where: { shipmentNo: `CKE2ESL${RUN}` } }))!.id,
                entryType: "NORMAL",
                qtyDelta: 30,
                businessDate: now,
                operatorId: superUser!.id,
                requestKey: `e2e-sl-${RUN}-unarc-ledger`,
                createdAt: now,
            },
        });

        const archive = await post(
            `/orders/${targetNo}/archive`,
            superToken,
            { expectedVersion: 1 },
            `e2e-sl-${RUN}-unarc-arc`,
        );
        expect(archive.statusCode).toBe(200);
        const unarchive = await post(
            `/orders/${targetNo}/unarchive`,
            superToken,
            { expectedVersion: 2, reason: "归档错了，恢复跟进" },
            `e2e-sl-${RUN}-unarc-unarc`,
        );
        expect(unarchive.statusCode).toBe(200);

        // 时间线降序：回退 → 归档 → 创建
        const page = await logs(superToken, `?domain=order&keyword=${targetNo}&limit=100`);
        expect(page.statusCode).toBe(200);
        expect(entriesOf(page).map(item => item.action)).toEqual(["unarchive", "archive", "create"]);

        const entry = entriesOf(page)[0]!;
        expect(entry).toMatchObject({
            domain: "order",
            action: "unarchive",
            targetCode: targetNo,
            targetName: `日志客户甲_${RUN}`,
            reason: "归档错了，恢复跟进",
        });
        expect(entry.actor).toEqual({ name: "郭均", role: "super" });
        // 状态由已归档推断为进行中，快照数量为回退时口径
        expect(entry.changes).toEqual([
            { key: "customer", label: "客户", before: null, after: `日志客户甲_${RUN}` },
            { key: "lifecycleStatus", label: "订单状态", before: "已归档", after: "进行中" },
            { key: "qty", label: "订单数量", before: null, after: "100 个" },
        ]);

        // action=unarchive 筛选只命中回退事件
        const filtered = await logs(superToken, `?action=unarchive&keyword=${targetNo}&limit=100`);
        expect(filtered.statusCode).toBe(200);
        expect(entriesOf(filtered).map(item => item.action)).toEqual(["unarchive"]);
    });

    it("客户域：创建/编辑/移交三类动作，电话只记是否变更、移交带 from→to", async () => {
        const page = await logs(superToken, `?domain=customer&keyword=${RUN}&limit=100`);
        expect(page.statusCode).toBe(200);
        const items = entriesOf(page) as Array<Record<string, unknown>>;
        const byAction = new Map(items.map(item => [item.action as string, item]));

        const create = byAction.get("create") as Record<string, unknown>;
        expect(create.targetName).toBe(`日志客户甲_${RUN}`);
        expect(create.changes).toEqual([
            { key: "name", label: "客户名称", before: null, after: `日志客户甲_${RUN}` },
            { key: "ownerAccount", label: "负责销售", before: null, after: accountOf("sales01") },
        ]);

        const edit = byAction.get("edit") as Record<string, unknown>;
        expect(edit.changes).toEqual([
            { key: "contactPerson", label: "联系人", before: "陈敏", after: "林悦" },
            { key: "payTerms", label: "付款条件", before: "月结 30 天", after: "月结 45 天" },
            { key: "phone", label: "联系电话", before: "原号码不展示", after: "已变更，号码不展示" },
        ]);

        const transfer = byAction.get("transfer") as Record<string, unknown>;
        expect(transfer.targetName).toBe(`日志客户乙_${RUN}`);
        expect(transfer.reason).toBe("原负责人离岗，统一移交客户");
        // ownerChanged 为用户姓名（from=sales02 → to=sales01 的账号姓名）；客户名随行
        expect(transfer.changes).toEqual([
            { key: "name", label: "客户名称", before: null, after: `日志客户乙_${RUN}` },
            { key: "owner", label: "负责销售", before: "日志联调sales02", after: "日志联调sales01" },
        ]);
    });

    it("入库域：创建/修正/调整（adjust 携带符号数量与关联单号）", async () => {
        // 入库事件无名称快照（target_name 为 BOM 品类名），关键词按名称搜不到——
        // 用 domain 全量断言动作覆盖，adjust 按原因定位（共享库含其他套件同日数据）
        const page = await logs(superToken, `?domain=inbound&limit=100`);
        expect(page.statusCode).toBe(200);
        const items = entriesOf(page) as Array<Record<string, unknown>>;
        const actions = new Set(items.map(item => item.action as string));
        expect([...actions]).toEqual(expect.arrayContaining(["adjust", "create", "edit"]));

        const adjust = items.find(item => item.action === "adjust" && item.reason === `e2e 日志调整 ${RUN}`) as Record<
            string,
            unknown
        >;
        expect(adjust.targetCode).toMatch(/^TZ-/);
        expect(adjust.changes).toEqual([
            { key: "bomName", label: "成品名称", before: null, after: "新微动" },
            { key: "qtyDelta", label: "调整数量", before: null, after: "+20 个" },
            { key: "relatedInboundNo", label: "关联入库单", before: null, after: expect.stringMatching(/^RK/) },
        ]);
        // 修正事件（当天窗口）：操作人为仓管；before/after 为 300 → 280 的修正
        const edit = items.find(
            item => item.action === "edit" && JSON.stringify(item.changes).includes("280 个"),
        ) as Record<string, unknown>;
        expect((edit.actor as { name: string }).name).toBe(`日志联调wh01`);
        expect(edit.reason).toBe("登记数量有误");
    });

    it("出库域：登记发货（ship）数量与客户名快照", async () => {
        const page = await logs(superToken, `?domain=outbound&keyword=${RUN}&limit=100`);
        expect(page.statusCode).toBe(200);
        const items = entriesOf(page) as Array<Record<string, unknown>>;
        const ships = items.filter(item => item.action === "ship");
        // 两笔发货（订单 1 首批 40 + 订单 2 整单 50）；降序排列，晚发生的在前
        expect(ships).toHaveLength(2);
        expect(ships[0]!.changes).toEqual([
            { key: "customer", label: "客户", before: null, after: `日志客户甲_${RUN}` },
            { key: "qty", label: "发货数量", before: null, after: "50 个" },
            { key: "orderNo", label: "订单号", before: null, after: orderNo2 },
            { key: "remark", label: "备注", before: null, after: "整单发" },
        ]);
        expect(ships[1]!.changes).toEqual([
            { key: "customer", label: "客户", before: null, after: `日志客户甲_${RUN}` },
            { key: "qty", label: "发货数量", before: null, after: "40 个" },
            { key: "orderNo", label: "订单号", before: null, after: orderNo },
            { key: "remark", label: "备注", before: null, after: "首批" },
        ]);
    });

    it("关键词按操作人姓名命中", async () => {
        const page = await logs(superToken, `?keyword=郭均&limit=100`);
        expect(page.statusCode).toBe(200);
        const items = entriesOf(page);
        expect(items.length).toBeGreaterThan(0);
        for (const item of items as Array<Record<string, unknown>>) {
            expect((item.actor as { name: string }).name).toBe("郭均");
        }
    });

    it("action 筛选：transfer 仅移交事件", async () => {
        const page = await logs(superToken, `?action=transfer&keyword=${RUN}&limit=100`);
        expect(page.statusCode).toBe(200);
        const items = entriesOf(page);
        expect(items).toHaveLength(1);
        expect(items[0]!.action).toBe("transfer");
        expect(items[0]!.domain).toBe("customer");
    });

    it("action 筛选：archive 仅归档订单事件", async () => {
        const page = await logs(superToken, `?action=archive&keyword=${orderNo}&limit=100`);
        expect(page.statusCode).toBe(200);
        const items = entriesOf(page);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ domain: "order", action: "archive", targetCode: orderNo });
    });

    it("老订单日志按 bomCode 回填 BOM 备注（bomRemark 入快照前的存量）", async () => {
        const oldOrderNo = `ZMOLD${RUN}`;
        await prisma.opLog.create({
            data: {
                id: snowflake.next(),
                operatorId: 1n,
                operatorNameSnapshot: "郭均",
                operatorRoleSnapshot: "super",
                action: "create_order",
                targetType: "order",
                targetId: 0n,
                targetCode: oldOrderNo,
                // bomRemark 入快照之前的老式 detail：行内字段 + 关联编码
                detailJson: {
                    orderNo: oldOrderNo,
                    qty: 10,
                    deliverDate: "2027-01-31",
                    remark: "",
                    customer: `日志客户甲_${RUN}`,
                    bomCode,
                },
                createdAt: new Date(),
            },
        });
        try {
            const page = await logs(superToken, `?keyword=${oldOrderNo}&limit=10`);
            expect(page.statusCode).toBe(200);
            const changes = entriesOf(page)[0]!.changes!;
            // 读时回填已由迁移 20260947000000 一次性回填取代：新写入的 create_order
            // 恒带 bomRemark,缺该键的行按空值不展示口径降级（卡片不出现 BOM 备注字段）
            expect((changes as Array<{ key: string }>).some(change => change.key === "bomRemark")).toBe(false);
            expect(changes).toContainEqual({
                key: "customer",
                label: "客户",
                before: null,
                after: `日志客户甲_${RUN}`,
            });
        } finally {
            await prisma.opLog.deleteMany({ where: { targetCode: oldOrderNo } });
        }
    });

    it("作废动作聚合：出库数量与订单号快照、原因透出", async () => {
        // 关键词按名称路径命中（void 的 detail.customer 为客户名快照；订单号不在搜索三项内）
        const page = await logs(superToken, `?action=void&domain=outbound&keyword=${RUN}&limit=100`);
        expect(page.statusCode).toBe(200);
        const items = entriesOf(page);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            domain: "outbound",
            action: "void",
            targetCode: expect.stringMatching(/^CK/),
            reason: "发货对象有误",
        });
        expect(items[0]!.changes).toEqual([
            { key: "customer", label: "客户", before: null, after: `日志客户甲_${RUN}` },
            { key: "qty", label: "出库数量", before: null, after: "50 个" },
            { key: "orderNo", label: "订单号", before: null, after: orderNo2 },
        ]);
    });

    it("时间范围：7d 命中今天造数；custom 跨日窗口完整覆盖；缺日期或 from>to 返回 400", async () => {
        const week = await logs(superToken, `?range=7d&domain=order&keyword=${orderNo}`);
        expect(week.statusCode).toBe(200);
        expect(entriesOf(week)).toHaveLength(3);

        const beijingToday = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
        const custom = await logs(
            superToken,
            `?range=custom&from=${beijingToday}&to=${beijingToday}&domain=order&keyword=${orderNo}`,
        );
        expect(custom.statusCode).toBe(200);
        expect(entriesOf(custom)).toHaveLength(3);

        // 跨日窗口（from < to 多日）：今天造数全部命中，含起止两侧日界
        const span = await logs(
            superToken,
            `?range=custom&from=2026-09-01&to=${beijingToday}&domain=order&keyword=${orderNo}`,
        );
        expect(span.statusCode).toBe(200);
        expect(entriesOf(span)).toHaveLength(3);

        const missing = await logs(superToken, `?range=custom&domain=order`);
        expect(missing.statusCode).toBe(400);

        const inverted = await logs(superToken, `?range=custom&from=2026-09-27&to=2026-09-01`);
        expect(inverted.statusCode).toBe(400);
    });

    it("复合游标：limit=1 分批拉全量，批次无重叠且合集与全量一致", async () => {
        const full = await logs(superToken, `?domain=customer&keyword=${RUN}&limit=100`);
        const allIds = entriesOf(full).map(item => item.id as string);
        expect(allIds.length).toBeGreaterThanOrEqual(4);

        const collected: string[] = [];
        let cursor: string | null = null;
        for (let round = 0; round < 20; round += 1) {
            const suffix = cursor
                ? `&beforeAt=${encodeURIComponent(cursor.split("|")[0]!)}&beforeId=${cursor.split("|")[1]}`
                : "";
            const page = await logs(superToken, `?domain=customer&keyword=${RUN}&limit=1${suffix}`);
            expect(page.statusCode).toBe(200);
            const items = entriesOf(page);
            collected.push(...items.map(item => item.id as string));
            const next = (page.data as { nextCursor: { at: string; id: string } | null }).nextCursor;
            if (!next) {
                cursor = null;
                break;
            }
            cursor = `${next.at}|${next.id}`;
        }
        expect(cursor).toBeNull();
        expect(collected).toHaveLength(allIds.length);
        expect(new Set(collected).size).toBe(collected.length);
        expect([...collected].sort()).toEqual([...allIds].sort());
    });

    it("游标参数非法：beforeId 非数字串 400", async () => {
        const bad = await logs(superToken, `?beforeAt=2026-09-27T00:00:00.000Z&beforeId=abc`);
        expect(bad.statusCode).toBe(400);
    });
});

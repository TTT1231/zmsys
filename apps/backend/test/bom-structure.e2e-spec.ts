/**
 * BOM 结构在线维护集成测试（超管专属写接口）：权限边界、乐观锁与目录同步、
 * 全树校验兜底、核心冻结语义（结构变更只影响之后新建的 BOM——旧档案/订单快照/
 * 库存逐字段不变）、隐藏引用提示、幂等与失败回滚、系统日志归一（domain=bom、
 * action=edit 筛选）、新建品类（前缀数字延长校验/并发/序列惰性初始化）。
 * 运行前置：pnpm test:db:reset。e2e 整轮共享一个库且按文件串行：本 spec 修改
 * 种子目录（rotary-switch），afterAll 按快照原样还原并清理全部新增数据，保证
 * 既有「恰好 9 品类」等断言不受影响。
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
const XK2 = "rotary-switch";
const today = (): string => new Date().toISOString().slice(0, 10);

describe("BOM 结构在线维护 (e2e)", () => {
    let app: NestFastifyApplication;
    let prisma: PrismaService;
    let superToken: string;

    // 清理台账：新增品类（含其 biz_sequence 惰性行）、种子品类上的新分组、
    // 新建 BOM（订单/入库按 bom_id 级联清理）、客户按名称 RUN 片段清理
    const createdCategoryKeys: string[] = [];
    const createdBomCodes: string[] = [];

    let seedSnapshot: {
        rowVersion: bigint;
        groups: Array<{
            id: bigint;
            name: string;
            groupKey: string | null;
            parentId: bigint | null;
            multi: boolean | null;
            qty: boolean | null;
            sortOrder: number;
            status: boolean;
            items: Array<{ id: bigint; name: string; sortOrder: number; status: boolean }>;
        }>;
    } | null = null;

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
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-bs-${RUN}-${account}` },
            payload: { name: `联调${account.split("_")[1] ?? "用户"}`, account, role },
        });
        expect(res.statusCode).toBe(200);
        return login(account);
    };

    const apply = (payload: Record<string, unknown>, idemKey: string, token = superToken) =>
        app.inject({
            method: "POST",
            url: "/api/bom-structure/apply",
            headers: { ...authHeaders(token), "idempotency-key": idemKey },
            payload,
        });

    const createCategory = (payload: Record<string, unknown>, idemKey: string, token = superToken) =>
        app.inject({
            method: "POST",
            url: "/api/bom-structure/categories",
            headers: { ...authHeaders(token), "idempotency-key": idemKey },
            payload,
        });

    const rowVersionOf = async (categoryKey: string): Promise<number> => {
        const row = await prisma.bomCategory.findUnique({ where: { categoryKey }, select: { rowVersion: true } });
        if (!row) {
            throw new Error(`品类缺失：${categoryKey}`);
        }
        return Number(row.rowVersion);
    };

    /** 按品类/分组/物料名解析目录 id（种子固定，按名解析保持与迁移解耦） */
    const itemIdOf = async (categoryKey: string, groupName: string, itemName: string): Promise<string> => {
        const row = await prisma.materialItem.findFirst({
            where: { group: { name: groupName, category: { categoryKey } }, name: itemName },
            select: { id: true },
        });
        if (!row) {
            throw new Error(`目录缺失：${categoryKey}/${groupName}/${itemName}`);
        }
        return row.id.toString();
    };

    const bomEntryOf = async (code: string): Promise<Record<string, unknown>> => {
        const res = await app.inject({ method: "GET", url: "/api/boms", headers: authHeaders(superToken) });
        const entry = (res.json().data as Array<Record<string, unknown>>).find(row => row.code === code);
        expect(entry).toBeDefined();
        return entry!;
    };

    const stockOf = async (code: string): Promise<number | undefined> => {
        const res = await app.inject({ method: "GET", url: "/api/bom-stocks", headers: authHeaders(superToken) });
        return (res.json().data as Record<string, number>)[code];
    };

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        prisma = app.get(PrismaService);
        superToken = await login("guojun");
        const category = await prisma.bomCategory.findUnique({
            where: { categoryKey: XK2 },
            include: { groups: { include: { items: true }, orderBy: { id: "asc" } } },
        });
        expect(category).not.toBeNull();
        seedSnapshot = {
            rowVersion: category!.rowVersion,
            groups: category!.groups.map(group => ({
                id: group.id,
                name: group.name,
                groupKey: group.groupKey,
                parentId: group.parentId,
                multi: group.multi,
                qty: group.qty,
                sortOrder: group.sortOrder,
                status: group.status,
                items: group.items.map(item => ({
                    id: item.id,
                    name: item.name,
                    sortOrder: item.sortOrder,
                    status: item.status,
                })),
            })),
        };
    });

    afterAll(async () => {
        // 1) 订单/入库按 bom_id 级联清理（变更日志 → 台账行 → 订单行）
        const boms = await prisma.bomTable.findMany({
            where: { bomCode: { in: createdBomCodes } },
            select: { id: true },
        });
        const bomIds = boms.map(bom => bom.id);
        if (bomIds.length > 0) {
            const inbounds = await prisma.inboundLedger.findMany({
                where: { bomId: { in: bomIds } },
                select: { id: true },
            });
            if (inbounds.length > 0) {
                await prisma.inboundChangeLog.deleteMany({ where: { inboundId: { in: inbounds.map(row => row.id) } } });
                await prisma.inboundLedger.deleteMany({ where: { id: { in: inbounds.map(row => row.id) } } });
            }
            const orders = await prisma.salesOrderTable.findMany({
                where: { bomId: { in: bomIds } },
                select: { id: true },
            });
            if (orders.length > 0) {
                await prisma.salesOrderChangeLog.deleteMany({ where: { orderId: { in: orders.map(row => row.id) } } });
                await prisma.salesOrderTable.deleteMany({ where: { id: { in: orders.map(row => row.id) } } });
            }
            await prisma.bomItem.deleteMany({ where: { bomId: { in: bomIds } } });
            await prisma.bomTable.deleteMany({ where: { id: { in: bomIds } } });
        }
        // 2) 客户按 RUN 片段清理（本 spec 独有命名）
        await prisma.customTable.deleteMany({ where: { name: { contains: RUN } } });
        // 3) 新增品类整树 + 惰性序列行
        const newCategories = await prisma.bomCategory.findMany({
            where: { categoryKey: { in: createdCategoryKeys } },
            select: { id: true },
        });
        for (const category of newCategories) {
            await prisma.materialItem.deleteMany({ where: { group: { categoryId: category.id } } });
            await prisma.materialGroup.deleteMany({ where: { categoryId: category.id } });
        }
        await prisma.bomCategory.deleteMany({ where: { id: { in: newCategories.map(row => row.id) } } });
        await prisma.bizSequence.deleteMany({
            where: { sequenceKey: { in: createdCategoryKeys.map(key => `bom:${key}`) } },
        });
        // 4) 种子品类还原：先回写快照字段（含 parentId）——v2 的 move 可能把快照分组
        //    挂到本 spec 新增的分区上，先回写再删新增行才不会撞 fk_material_group_parent
        if (seedSnapshot) {
            for (const group of seedSnapshot.groups) {
                await prisma.materialGroup.update({
                    where: { id: group.id },
                    data: {
                        name: group.name,
                        groupKey: group.groupKey,
                        parentId: group.parentId,
                        multi: group.multi,
                        qty: group.qty,
                        sortOrder: group.sortOrder,
                        status: group.status,
                    },
                });
                for (const item of group.items) {
                    await prisma.materialItem.update({
                        where: { id: item.id },
                        data: { name: item.name, sortOrder: item.sortOrder, status: item.status },
                    });
                }
            }
            await prisma.bomCategory.update({
                where: { categoryKey: XK2 },
                data: { rowVersion: seedSnapshot.rowVersion },
            });
            const snapshotIds = new Set(seedSnapshot.groups.map(group => group.id.toString()));
            const current = await prisma.materialGroup.findMany({
                where: { category: { categoryKey: XK2 } },
                select: { id: true },
            });
            const added = current.filter(group => !snapshotIds.has(group.id.toString()));
            if (added.length > 0) {
                await prisma.materialItem.deleteMany({ where: { groupId: { in: added.map(group => group.id) } } });
                await prisma.materialGroup.deleteMany({ where: { id: { in: added.map(group => group.id) } } });
            }
        }
        await app.close();
    });

    it("权限边界：普通角色 403；空操作/未知品类 400/404", async () => {
        const staffToken = await createUser(accountOf("staff"), "staff");
        const adminToken = await createUser(accountOf("admin"), "admin");
        const denied = await apply(
            { categoryKey: XK2, expectedRowVersion: 1, operations: [] },
            `e2e-bs-${RUN}-deny`,
            staffToken,
        );
        expect(denied.statusCode).toBe(403);
        expect(denied.json().message).toBe("只有超级管理员可以维护 BOM 结构");
        const deniedCreate = await createCategory(
            { name: `x${RUN}`, codePrefix: "QX", groups: [] },
            `e2e-bs-${RUN}-deny2`,
            adminToken,
        );
        expect(deniedCreate.statusCode).toBe(403);
        expect(deniedCreate.json().message).toBe("只有超级管理员可以新建 BOM 品类");

        const emptyOps = await apply(
            { categoryKey: XK2, expectedRowVersion: 1, operations: [] },
            `e2e-bs-${RUN}-empty`,
        );
        expect(emptyOps.statusCode).toBe(400);
        const unknownCategory = await apply(
            {
                categoryKey: "no-such-category",
                expectedRowVersion: 1,
                operations: [{ type: "add_section", tempId: "t", name: "X" }],
            },
            `e2e-bs-${RUN}-unknown`,
        );
        expect(unknownCategory.statusCode).toBe(404);
    });

    it("核心冻结场景：建档下单入库后 加新组/隐藏/调序/改规则 —— 旧档案逐字段不变；新目录可选；隐藏项直调建档被拒", async () => {
        const [modelItem, directionItem, springItem] = await Promise.all([
            itemIdOf(XK2, "型号", "1-1"),
            itemIdOf(XK2, "方向", "正面"),
            itemIdOf(XK2, "弹簧", "0.55"),
        ]);
        const created = await app.inject({
            method: "POST",
            url: "/api/boms",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-bs-${RUN}-bom1` },
            payload: { name: "旋转XK2", materialItemIds: [modelItem, directionItem, springItem] },
        });
        expect(created.statusCode).toBe(200);
        const bomCode = created.json().data.code as string;
        createdBomCodes.push(bomCode);

        const customer = await app.inject({
            method: "POST",
            url: "/api/customers",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-bs-${RUN}-cus` },
            payload: {
                name: `结构联调客户_${RUN}`,
                contact: "王经理",
                phone: "13800001111",
                province: "广东省",
                city: "深圳市",
                district: "南山区",
                town: "粤海街道",
                address: `科技园 ${RUN.slice(-3)} 号`,
                ownerAccount: "guojun",
                payTerms: "月结 30 天",
            },
        });
        expect(customer.statusCode).toBe(200);
        const customerCode = customer.json().data.code as string;

        const order = await app.inject({
            method: "POST",
            url: "/api/orders",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-bs-${RUN}-order1` },
            payload: {
                customerCode,
                bomCode,
                qty: 100,
                deliverDate: "2026-11-30",
                orderDate: today(),
                remark: `结构冻结 ${RUN}`,
            },
        });
        expect(order.statusCode).toBe(200);
        const orderRow = await prisma.salesOrderTable.findFirst({
            where: { orderNo: order.json().data.orderNo as string },
            select: { bomNameSnapshot: true, bomModelSnapshot: true, bomSpecSnapshot: true, qty: true },
        });
        expect(orderRow).not.toBeNull();

        const inbound = await app.inject({
            method: "POST",
            url: "/api/inbound",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-bs-${RUN}-in1` },
            payload: { bomCode, qty: 120, date: today(), remark: `结构冻结入库 ${RUN}` },
        });
        expect(inbound.statusCode).toBe(200);

        const bomBefore = await bomEntryOf(bomCode);
        expect(await stockOf(bomCode)).toBe(120);

        // 结构维护：新增弹静片组（单选）→ 追加物料 → 改多选 → 隐藏被引用的方向/正面 → 型号 1-1 下移
        const version = await rowVersionOf(XK2);
        const saved = await apply(
            {
                categoryKey: XK2,
                expectedRowVersion: version,
                operations: [
                    {
                        type: "add_group",
                        tempId: "t-grp",
                        name: "弹静片",
                        parentId: null,
                        multi: false,
                        qty: false,
                        items: [{ tempId: "t-i1", name: "动弹静片" }],
                    },
                    { type: "add_item", tempId: "t-i2", groupId: "t-grp", name: "静弹静片" },
                    { type: "set_rules", groupId: "t-grp", multi: true, qty: false },
                    { type: "hide", targetType: "item", targetId: directionItem },
                    { type: "reorder", targetType: "item", targetId: modelItem, direction: "down" },
                ],
            },
            `e2e-bs-${RUN}-apply1`,
        );
        expect(saved.statusCode).toBe(200);
        expect(saved.json().data).toMatchObject({ rowVersion: version + 1 });
        // 隐藏的方向/正面 仍被旧档案引用 → 行数提示（不阻断）
        expect(saved.json().data.hiddenUsageCount).toBeGreaterThanOrEqual(1);

        // 目录同步：新组与物料可见、隐藏项带标记、版本 +1
        const list = await app.inject({ method: "GET", url: "/api/bom-categories", headers: authHeaders(superToken) });
        const xk2 = (list.json().data as Array<Record<string, unknown>>).find(row => row.key === XK2)!;
        expect(xk2.rowVersion).toBe(version + 1);
        const groups = xk2.groups as Array<Record<string, unknown>>;
        const tangential = groups.find(group => group.name === "弹静片")!;
        expect(tangential).toMatchObject({ kind: "group", multi: true });
        expect(tangential).not.toHaveProperty("status");
        expect((tangential.items as Array<Record<string, unknown>>).map(item => item.name)).toEqual([
            "动弹静片",
            "静弹静片",
        ]);
        const directionGroup = groups.find(group => group.name === "方向")!;
        expect(
            (directionGroup.items as Array<Record<string, unknown>>).find(item => item.id === directionItem),
        ).toMatchObject({ status: false });

        // 冻结断言：旧档案明细/摘要逐字段不变、订单快照不变、库存不变
        expect(await bomEntryOf(bomCode)).toEqual(bomBefore);
        const orderAfter = await prisma.salesOrderTable.findFirst({
            where: { orderNo: order.json().data.orderNo as string },
            select: { bomNameSnapshot: true, bomModelSnapshot: true, bomSpecSnapshot: true, qty: true },
        });
        expect(orderAfter).toEqual(orderRow);
        expect(await stockOf(bomCode)).toBe(120);

        // 新目录生效：含新物料的构成可建档（不选新增项会命中判重 409，另见下条）
        const newGroupItem = (tangential.items as Array<{ id: string }>)[0]!.id;
        const createdNew = await app.inject({
            method: "POST",
            url: "/api/boms",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-bs-${RUN}-bom2` },
            payload: { name: "旋转XK2", materialItemIds: [modelItem, springItem, newGroupItem] },
        });
        expect(createdNew.statusCode).toBe(200);
        createdBomCodes.push(createdNew.json().data.code as string);

        // 隐藏项直调建档被后端权威校验拒绝
        const hiddenCreate = await app.inject({
            method: "POST",
            url: "/api/boms",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-bs-${RUN}-bom3` },
            payload: { name: "旋转XK2", materialItemIds: [modelItem, directionItem] },
        });
        expect(hiddenCreate.statusCode).toBe(400);
        expect(hiddenCreate.json().message).toContain("物料不存在、已停用或不属于该品类");

        // 审计：同事务 op_log（含变动摘要与隐藏引用数）
        const opLog = await prisma.opLog.findFirst({
            where: { action: "update_bom_structure", targetCode: XK2 },
            orderBy: { id: "desc" },
        });
        expect(opLog).not.toBeNull();
        const detail = opLog!.detailJson as Record<string, unknown>;
        expect(detail.rowVersionBefore).toBe(version);
        expect(detail.rowVersionAfter).toBe(version + 1);
        expect((detail.operations as unknown[]).length).toBeGreaterThanOrEqual(3);
        expect(detail.hiddenUsage).toBeGreaterThanOrEqual(1);

        // 时间线：domain=bom + action=edit 命中结构动作（edit 筛选修复的回归断言）
        const logs = await app.inject({
            method: "GET",
            url: "/api/system-logs?domain=bom&action=edit&limit=100",
            headers: authHeaders(superToken),
        });
        expect(logs.statusCode).toBe(200);
        const items = logs.json().data.items as Array<{ targetCode: string }>;
        expect(items.some(item => item.targetCode === XK2)).toBe(true);
    });

    it("校验兜底：未知目标/重复草稿标识 400 且无 op_log 残留；幂等重放不重复建节点", async () => {
        const version = await rowVersionOf(XK2);
        const opLogCount = await prisma.opLog.count({ where: { action: "update_bom_structure", targetCode: XK2 } });

        const badTarget = await apply(
            {
                categoryKey: XK2,
                expectedRowVersion: version,
                operations: [{ type: "hide", targetType: "item", targetId: "9999999999999999" }],
            },
            `e2e-bs-${RUN}-bad1`,
        );
        expect(badTarget.statusCode).toBe(400);
        const dupTemp = await apply(
            {
                categoryKey: XK2,
                expectedRowVersion: version,
                operations: [
                    { type: "add_section", tempId: "dup", name: "A" },
                    { type: "add_section", tempId: "dup", name: "B" },
                ],
            },
            `e2e-bs-${RUN}-bad2`,
        );
        expect(dupTemp.statusCode).toBe(400);
        expect(await prisma.opLog.count({ where: { action: "update_bom_structure", targetCode: XK2 } })).toBe(
            opLogCount,
        );

        // 重放首个保存请求：同键同摘要返回原响应，目录不重复建组
        const replay = await apply(
            {
                categoryKey: XK2,
                expectedRowVersion: version - 1,
                operations: [
                    {
                        type: "add_group",
                        tempId: "t-grp",
                        name: "弹静片",
                        parentId: null,
                        multi: false,
                        qty: false,
                        items: [{ tempId: "t-i1", name: "动弹静片" }],
                    },
                    { type: "add_item", tempId: "t-i2", groupId: "t-grp", name: "静弹静片" },
                    { type: "set_rules", groupId: "t-grp", multi: true, qty: false },
                    { type: "hide", targetType: "item", targetId: await itemIdOf(XK2, "方向", "正面") },
                    {
                        type: "reorder",
                        targetType: "item",
                        targetId: await itemIdOf(XK2, "型号", "1-1"),
                        direction: "down",
                    },
                ],
            },
            `e2e-bs-${RUN}-apply1`, // 与上例同一幂等键
        );
        expect(replay.statusCode).toBe(200);
        expect(replay.json().data.rowVersion).toBe(version); // 原响应（保存时版本 +1 后）
        expect(await prisma.materialGroup.count({ where: { name: "弹静片", category: { categoryKey: XK2 } } })).toBe(1);
        expect(await prisma.materialItem.count({ where: { name: "静弹静片" } })).toBe(1);
    });

    it("并发：同品类双保存一胜一 409", async () => {
        const version = await rowVersionOf(XK2);
        const [a, b] = await Promise.all([
            apply(
                {
                    categoryKey: XK2,
                    expectedRowVersion: version,
                    operations: [
                        {
                            type: "add_item",
                            tempId: "c1",
                            groupId: (await prisma.materialGroup.findFirst({
                                where: { name: "弹静片" },
                            }))!.id.toString(),
                            name: `并发物料A_${RUN}`,
                        },
                    ],
                },
                `e2e-bs-${RUN}-race1`,
            ),
            apply(
                {
                    categoryKey: XK2,
                    expectedRowVersion: version,
                    operations: [
                        {
                            type: "add_item",
                            tempId: "c2",
                            groupId: (await prisma.materialGroup.findFirst({
                                where: { name: "弹静片" },
                            }))!.id.toString(),
                            name: `并发物料B_${RUN}`,
                        },
                    ],
                },
                `e2e-bs-${RUN}-race2`,
            ),
        ]);
        expect([a.statusCode, b.statusCode].sort((p, q) => p - q)).toEqual([200, 409]);
    });

    it("新建品类：重名/重前缀 409、数字延长前缀 400、成功后整树下发且可建档取号；并发前缀冲突", async () => {
        const dupName = await createCategory({ name: "旋转XK2", codePrefix: "QQ", groups: [] }, `e2e-bs-${RUN}-cat1`);
        expect(dupName.statusCode).toBe(409);
        expect(dupName.json().message).toContain("品类名「旋转XK2」已存在");
        const dupPrefix = await createCategory(
            { name: `结构品类X_${RUN}`, codePrefix: "XK2", groups: [] },
            `e2e-bs-${RUN}-cat2`,
        );
        expect(dupPrefix.statusCode).toBe(409);
        expect(dupPrefix.json().message).toContain("编码前缀「XK2」已存在");
        const digitExtended = await createCategory(
            { name: `结构品类Y_${RUN}`, codePrefix: "XK21", groups: [] },
            `e2e-bs-${RUN}-cat3`,
        );
        expect(digitExtended.statusCode).toBe(400);
        expect(digitExtended.json().message).toContain("数字延长冲突");

        const name = `结构品类Z_${RUN}`;
        const created = await createCategory(
            {
                name,
                codePrefix: "QA",
                groups: [
                    {
                        kind: "GROUP",
                        tempId: "m",
                        name: "型号",
                        multi: false,
                        qty: false,
                        items: [
                            { tempId: "m1", name: "型号A" },
                            { tempId: "m2", name: "型号B" },
                        ],
                    },
                    { kind: "SECTION", tempId: "s", name: "结构分区" },
                    {
                        kind: "GROUP",
                        tempId: "g",
                        name: "结构件",
                        parentTempId: "s",
                        multi: true,
                        qty: true,
                        items: [{ tempId: "g1", name: "物料1" }],
                    },
                ],
            },
            `e2e-bs-${RUN}-cat4`,
        );
        expect(created.statusCode).toBe(200);
        expect(created.json().data).toMatchObject({ key: "qa", name, codePrefix: "QA", rowVersion: 1 });
        createdCategoryKeys.push("qa");

        const list = await app.inject({ method: "GET", url: "/api/bom-categories", headers: authHeaders(superToken) });
        const qa = (list.json().data as Array<Record<string, unknown>>).find(row => row.key === "qa")!;
        expect(qa).toBeDefined();
        const qaGroups = qa.groups as Array<Record<string, unknown>>;
        expect(qaGroups.map(group => [group.kind, group.name, group.key])).toEqual([
            ["group", "型号", "g1"],
            ["section", "结构分区", null],
            ["group", "结构件", "g2"],
        ]);
        expect(qaGroups[2]).toMatchObject({ parentId: qaGroups[1]!.id, multi: true, qty: true });

        // 新品类可建档取号（biz_sequence 惰性初始化）
        const modelItemId = (qaGroups[0]!.items as Array<{ id: string }>)[0]!.id;
        const partItemId = (qaGroups[2]!.items as Array<{ id: string }>)[0]!.id;
        const bom = await app.inject({
            method: "POST",
            url: "/api/boms",
            headers: { ...authHeaders(superToken), "idempotency-key": `e2e-bs-${RUN}-cat-bom` },
            payload: { name, materialItemIds: [modelItemId], quantities: { [partItemId]: 3 } },
        });
        expect(bom.statusCode).toBe(200);
        expect(bom.json().data.code as string).toMatch(/^QA\d+$/);
        createdBomCodes.push(bom.json().data.code as string);

        // 时间线：create_bom_category 归一 create
        const logs = await app.inject({
            method: "GET",
            url: "/api/system-logs?domain=bom&action=create&limit=100",
            headers: authHeaders(superToken),
        });
        expect((logs.json().data.items as Array<{ targetCode: string }>).some(item => item.targetCode === "qa")).toBe(
            true,
        );

        // 并发前缀冲突（数字延长）：后获锁者锁内复查 400；完全相同前缀：uk 兜底 409
        const [x1, x2] = await Promise.all([
            createCategory({ name: `并发品类A_${RUN}`, codePrefix: "QB", groups: [] }, `e2e-bs-${RUN}-cat5`),
            createCategory({ name: `并发品类B_${RUN}`, codePrefix: "QB1", groups: [] }, `e2e-bs-${RUN}-cat6`),
        ]);
        expect([x1.statusCode, x2.statusCode].sort((p, q) => p - q)).toEqual([200, 400]);
        createdCategoryKeys.push("qb", "qb1");
        const [y1, y2] = await Promise.all([
            createCategory({ name: `并发品类C_${RUN}`, codePrefix: "QZ", groups: [] }, `e2e-bs-${RUN}-cat7`),
            createCategory({ name: `并发品类D_${RUN}`, codePrefix: "QZ", groups: [] }, `e2e-bs-${RUN}-cat8`),
        ]);
        expect([y1.statusCode, y2.statusCode].sort((p, q) => p - q)).toEqual([200, 409]);
        createdCategoryKeys.push("qz");
    });

    it("v2 改名/移动/删除：未引用项放行并落库；被既有 BOM 引用的物料/分组被 400 引用守卫拒绝", async () => {
        /* 未引用的种子节点：规格组与 211-1 物料（建档只用了 型号/方向/弹簧）。
           改名会改写种子行——afterAll 按快照回写 name/parentId 恢复。 */
        const specGroupId = (await prisma.materialGroup.findFirst({
            where: { name: "规格", category: { categoryKey: XK2 } },
            select: { id: true },
        }))!.id;
        const specItemId = await itemIdOf(XK2, "规格", "211-1");
        const referencedItemId = await itemIdOf(XK2, "方向", "正面"); // bom1 引用（且已被隐藏）
        const modelGroupId = (await prisma.materialGroup.findFirst({
            where: { name: "型号", category: { categoryKey: XK2 } },
            select: { id: true },
        }))!.id;
        const tangentialGroupId = (await prisma.materialGroup.findFirst({
            where: { name: "弹静片", category: { categoryKey: XK2 } },
            select: { id: true },
        }))!.id;

        // 1) 改名放行：新增分区（草稿 tempId 引用）+ 分区改名 + 未引用分组/物料改名
        let version = await rowVersionOf(XK2);
        const renamed = await apply(
            {
                categoryKey: XK2,
                expectedRowVersion: version,
                operations: [
                    { type: "add_section", tempId: "t-sec", name: "新区" },
                    { type: "rename", targetType: "section", targetId: "t-sec", name: "新区二" },
                    { type: "rename", targetType: "group", targetId: specGroupId.toString(), name: "规格件" },
                    { type: "rename", targetType: "item", targetId: specItemId, name: "211-1A" },
                ],
            },
            `e2e-bs-${RUN}-v2rename`,
        );
        expect(renamed.statusCode).toBe(200);
        expect(renamed.json().data.rowVersion).toBe(version + 1);
        // 审计：改名批次进入 op_log 摘要（紧随该 apply 读取，避免被后续保存顶掉）
        const renameOpLog = await prisma.opLog.findFirst({
            where: { action: "update_bom_structure", targetCode: XK2 },
            orderBy: { id: "desc" },
        });
        expect(JSON.stringify((renameOpLog!.detailJson as { operations: unknown[] }).operations)).toContain("211-1A");
        const sectionId = (await prisma.materialGroup.findFirst({
            where: { name: "新区二", category: { categoryKey: XK2 } },
            select: { id: true },
        }))!.id;

        // 2) 引用守卫：被 bom_item 引用的物料不能改名/换组/删除；被引用分组不能改名
        version = await rowVersionOf(XK2);
        const guard = async (operations: Record<string, unknown>[], tag: string, keyword: string) => {
            const res = await apply(
                { categoryKey: XK2, expectedRowVersion: version, operations },
                `e2e-bs-${RUN}-v2g-${tag}`,
            );
            expect(res.statusCode).toBe(400);
            expect(res.json().message).toContain(keyword);
        };
        await guard(
            [{ type: "rename", targetType: "item", targetId: referencedItemId, name: "正面2" }],
            "item-rename",
            "不能改名",
        );
        await guard(
            [{ type: "move", targetType: "item", targetId: referencedItemId, parentId: specGroupId.toString() }],
            "item-move",
            "不能移动到其他分组",
        );
        await guard([{ type: "remove", targetType: "item", targetId: referencedItemId }], "item-remove", "不能删除");
        await guard(
            [{ type: "rename", targetType: "group", targetId: modelGroupId.toString(), name: "型号选择" }],
            "group-rename",
            "不能改名",
        );
        // 分组删除守卫：弹静片组内的 动弹静片 被 bom2 引用 → 整组删除被拒
        await guard(
            [{ type: "remove", targetType: "group", targetId: tangentialGroupId.toString() }],
            "group-remove",
            "不能删除",
        );

        // 3) 移动放行：分组换分区（挂到末位）；未引用物料换组
        version = await rowVersionOf(XK2);
        const added = await apply(
            {
                categoryKey: XK2,
                expectedRowVersion: version,
                operations: [
                    {
                        type: "move",
                        targetType: "group",
                        targetId: specGroupId.toString(),
                        parentId: sectionId.toString(),
                    },
                    { type: "add_item", tempId: "t-guard", groupId: tangentialGroupId.toString(), name: "守卫物料" },
                ],
            },
            `e2e-bs-${RUN}-v2move`,
        );
        expect(added.statusCode).toBe(200);
        const guardItemId = (await prisma.materialItem.findFirst({
            where: { name: "守卫物料" },
            select: { id: true },
        }))!.id;
        version = await rowVersionOf(XK2);
        const itemMoved = await apply(
            {
                categoryKey: XK2,
                expectedRowVersion: version,
                operations: [
                    {
                        type: "move",
                        targetType: "item",
                        targetId: guardItemId.toString(),
                        parentId: specGroupId.toString(),
                    },
                ],
            },
            `e2e-bs-${RUN}-v2move2`,
        );
        expect(itemMoved.statusCode).toBe(200);

        const list = await app.inject({ method: "GET", url: "/api/bom-categories", headers: authHeaders(superToken) });
        const xk2 = (list.json().data as Array<Record<string, unknown>>).find(row => row.key === XK2)!;
        const groups = xk2.groups as Array<Record<string, unknown>>;
        expect(groups.find(group => group.name === "规格件")).toMatchObject({
            parentId: sectionId.toString(),
        });
        expect(
            (groups.find(group => group.name === "规格件")!.items as Array<Record<string, unknown>>).map(
                item => item.name,
            ),
        ).toContain("守卫物料");

        // 4) 删除放行：未引用物料物理删除（快照还原不涉及本 spec 新增行）
        version = await rowVersionOf(XK2);
        const removed = await apply(
            {
                categoryKey: XK2,
                expectedRowVersion: version,
                operations: [{ type: "remove", targetType: "item", targetId: guardItemId.toString() }],
            },
            `e2e-bs-${RUN}-v2remove`,
        );
        expect(removed.statusCode).toBe(200);
        expect(await prisma.materialItem.count({ where: { id: guardItemId } })).toBe(0);

        // 审计：删除进入最新 op_log 摘要（removed 标记）
        const removeOpLog = await prisma.opLog.findFirst({
            where: { action: "update_bom_structure", targetCode: XK2 },
            orderBy: { id: "desc" },
        });
        expect(JSON.stringify((removeOpLog!.detailJson as { operations: unknown[] }).operations)).toContain("守卫物料");

        // 5) 回归：同批换名环链（写侧两阶段改名不撞 uk_material_group_name）与
        //    分区整支删除（子分组先于分区删行，物料先于分组删行，fk RESTRICT 顺序）
        version = await rowVersionOf(XK2);
        const seeded = await apply(
            {
                categoryKey: XK2,
                expectedRowVersion: version,
                operations: [
                    { type: "add_section", tempId: "t-rm", name: `换名分区_${RUN}` },
                    {
                        type: "add_group",
                        tempId: "t-a",
                        name: `换名甲_${RUN}`,
                        parentId: "t-rm",
                        multi: false,
                        qty: false,
                        items: [{ tempId: "t-i", name: `换名物料_${RUN}` }],
                    },
                    {
                        type: "add_group",
                        tempId: "t-b",
                        name: `换名乙_${RUN}`,
                        parentId: "t-rm",
                        multi: false,
                        qty: false,
                    },
                ],
            },
            `e2e-bs-${RUN}-v2seed2`,
        );
        expect(seeded.statusCode).toBe(200);
        const swapPair = await prisma.materialGroup.findMany({
            where: { category: { categoryKey: XK2 }, name: { in: [`换名甲_${RUN}`, `换名乙_${RUN}`] } },
            select: { id: true, name: true },
        });
        expect(swapPair).toHaveLength(2);
        const jia = swapPair.find(row => row.name === `换名甲_${RUN}`)!.id.toString();
        const yi = swapPair.find(row => row.name === `换名乙_${RUN}`)!.id.toString();
        version = await rowVersionOf(XK2);
        const swapped = await apply(
            {
                categoryKey: XK2,
                expectedRowVersion: version,
                operations: [
                    { type: "rename", targetType: "group", targetId: jia, name: `换名乙_${RUN}` },
                    { type: "rename", targetType: "group", targetId: yi, name: `换名甲_${RUN}` },
                ],
            },
            `e2e-bs-${RUN}-v2swap`,
        );
        expect(swapped.statusCode).toBe(200);
        const swapSection = await prisma.materialGroup.findFirst({
            where: { name: `换名分区_${RUN}`, category: { categoryKey: XK2 } },
            select: { id: true },
        });
        expect(swapSection).not.toBeNull();
        version = await rowVersionOf(XK2);
        const sectionRemoved = await apply(
            {
                categoryKey: XK2,
                expectedRowVersion: version,
                operations: [{ type: "remove", targetType: "section", targetId: swapSection!.id.toString() }],
            },
            `e2e-bs-${RUN}-v2rmsec`,
        );
        expect(sectionRemoved.statusCode).toBe(200);
        expect(
            await prisma.materialGroup.count({
                where: { id: { in: [swapSection!.id, BigInt(jia), BigInt(yi)] } },
            }),
        ).toBe(0);
        expect(await prisma.materialItem.count({ where: { name: `换名物料_${RUN}` } })).toBe(0);
    });

    it("新建复合品类（带下属类型）：主品类登记 child_categories，类型为停用容器；类型前缀冲突被拒", async () => {
        const dupTypePrefix = await createCategory(
            {
                name: `复合品类A_${RUN}`,
                codePrefix: "QT",
                groups: [],
                types: [{ name: `类型一_${RUN}`, codePrefix: "QT1" }],
            },
            `e2e-bs-${RUN}-cat9`,
        );
        expect(dupTypePrefix.statusCode).toBe(400);
        expect(dupTypePrefix.json().message).toContain("数字延长冲突");

        const dupTypeName = await createCategory(
            {
                name: `复合品类B_${RUN}`,
                codePrefix: "QU",
                groups: [],
                types: [{ name: `复合品类B_${RUN}`, codePrefix: "QUA" }],
            },
            `e2e-bs-${RUN}-cat10`,
        );
        expect(dupTypeName.statusCode).toBe(409);
        expect(dupTypeName.json().message).toContain("已存在");

        const name = `复合品类C_${RUN}`;
        const created = await createCategory(
            {
                name,
                codePrefix: "QT",
                groups: [],
                types: [
                    { name: `类型一_${RUN}`, codePrefix: "QTA" },
                    { name: `类型二_${RUN}`, codePrefix: "QTB" },
                ],
            },
            `e2e-bs-${RUN}-cat11`,
        );
        expect(created.statusCode).toBe(200);
        expect(created.json().data).toMatchObject({ key: "qt", name, codePrefix: "QT", rowVersion: 1 });
        expect(created.json().data.types).toEqual([
            { key: "qta", name: `类型一_${RUN}`, codePrefix: "QTA", rowVersion: 1 },
            { key: "qtb", name: `类型二_${RUN}`, codePrefix: "QTB", rowVersion: 1 },
        ]);
        createdCategoryKeys.push("qt", "qta", "qtb");

        const parent = await prisma.bomCategory.findUnique({ where: { categoryKey: "qt" } });
        expect(parent).not.toBeNull();
        expect(parent!.childCategories).toEqual(["qta", "qtb"]);
        expect(parent!.status).toBe(true);
        const children = await prisma.bomCategory.findMany({ where: { categoryKey: { in: ["qta", "qtb"] } } });
        expect(children).toHaveLength(2);
        expect(children.every(row => row.status === false)).toBe(true);

        // 目录接口：容器品类随启用主品类下发（建档合并树与结构页折叠面板依赖此行为）
        const list = await app.inject({ method: "GET", url: "/api/bom-categories", headers: authHeaders(superToken) });
        const keys = (list.json().data as Array<Record<string, unknown>>).map(row => row.key);
        expect(keys).toContain("qta");
        expect(keys).toContain("qtb");
    });
});

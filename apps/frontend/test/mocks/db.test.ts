import { describe, expect, it } from "vitest";

import { maxShipOf, readyToShip } from "@/data/views";
import { catalogRowsOf, categoryOf } from "@/data/categories";
import { ANCHOR, db } from "../../mocks/data/db";

// db 是 import 即 init 的单例，同文件内 it 顺序执行；
// 非法写入一律被整体拒绝（不改快照），因此前两个 it 不产生状态变化。
const actor = { name: "测试", roleLabel: "检验员" };

/* 物料目录模式：mock 业务数据从 0 开始，用例自行手建 BOM/订单/库存夹具 */
const idOf = (categoryName: string, itemName: string) =>
    catalogRowsOf(categoryOf(categoryName)!).find(row => row.name === itemName)!.id;

const rotaryBom = db.createBom({
    name: "旋转XK2",
    materialItemIds: [idOf("旋转XK2", "1-1"), idOf("旋转XK2", "正面"), idOf("旋转XK2", "0.5")],
});
const microBom = db.createBom({
    name: "新微动",
    materialItemIds: [
        idOf("新微动", "二脚底座（无挡脚）"),
        idOf("新微动", "盖子"),
        idOf("新微动", "8.5mm"),
        idOf("新微动", "6.3支架：铜镀银"),
        idOf("新微动", "6.3静片：铜镀银"),
    ],
});
db.createInbound({ bomCode: rotaryBom.code, qty: 100, date: ANCHOR, remark: "测试备货" }, actor);
const stockedOrder = db.createOrder(
    {
        customerCode: "CUS-1024",
        bomCode: rotaryBom.code,
        qty: 5,
        deliverDate: "2026-12-31",
        orderDate: ANCHOR,
        remark: "",
    },
    actor,
);

/* 每个出库用例独立开一笔可发订单，互不消耗库存配额 */
const newShippableOrder = () => {
    const created = db.createOrder(
        {
            customerCode: "CUS-0316",
            bomCode: rotaryBom.code,
            qty: 4,
            deliverDate: "2026-12-31",
            orderDate: ANCHOR,
            remark: "",
        },
        actor,
    );
    return db.orders.find(order => order.orderNo === created.orderNo)!;
};

describe("mock db material catalog rules", () => {
    it("archives BOM from selected materials: frozen items, derived modelCode and summary", () => {
        expect(rotaryBom).toMatchObject({ code: "ZMXK2001", name: "旋转XK2", modelCode: "1-1" });
        expect(rotaryBom.items.map(item => item.name)).toEqual(["1-1", "正面", "0.5"]);
        expect(rotaryBom.spec).toBe("型号：1-1 · 方向：正面 · 弹簧：0.5");
        expect(microBom.modelCode).toBe("");
        expect(microBom.items).toHaveLength(5);
    });

    it("rejects unknown categories, empty sets, foreign ids and single-group over-picks", () => {
        expect(() => db.createBom({ name: "琴键开关", materialItemIds: ["3003"] })).toThrow("品类不存在");
        expect(() => db.createBom({ name: "旋转XK2", materialItemIds: [] })).toThrow("请至少选择一项物料");
        expect(() => db.createBom({ name: "旋转XK2", materialItemIds: ["9999"] })).toThrow(
            "物料不存在、已停用或不属于该品类",
        );
        expect(() =>
            db.createBom({
                name: "新微动",
                materialItemIds: [idOf("新微动", "6.3支架：铜镀银"), idOf("新微动", "6.3支架：铜镀镍")],
            }),
        ).toThrow("分组「支架」只能选择一项物料");
    });

    it("dedupes repeated ids and rejects identical material sets regardless of input order", () => {
        const deduped = db.createBom({
            name: "旋转XK2",
            materialItemIds: [idOf("旋转XK2", "反面"), idOf("旋转XK2", "反面")],
        });
        expect(deduped.items).toHaveLength(1);
        expect(() =>
            db.createBom({
                name: "旋转XK2",
                materialItemIds: [idOf("旋转XK2", "反面"), deduped.items[0]!.materialId],
            }),
        ).toThrow(`BOM 已存在：${deduped.code}`);
    });

    it("allocates stock without over-promising one pool twice", () => {
        const rows = readyToShip(db.snapshot());
        for (const bom of db.boms) {
            const allocated = rows.filter(row => row.bomCode === bom.code).reduce((sum, row) => sum + row.maxShip, 0);
            expect(allocated).toBeLessThanOrEqual(db.stockOf(bom.code));
        }
    });

    it("rejects invalid writes atomically", () => {
        const row = readyToShip(db.snapshot()).find(item => item.maxShip > 1);
        expect(row).toBeTruthy();
        if (!row) return;

        const input = { orderNo: row.orderNo, date: ANCHOR, remark: "测试" };
        const before = db.snapshot();
        const badQty = [0, -1, 0.5, NaN, maxShipOf(db.snapshot(), row.orderNo) + 1];
        for (const qty of badQty) {
            expect(() => db.createOutbound({ ...input, qty }, actor)).toThrow();
        }
        expect(db.snapshot()).toEqual(before);

        const afterOutbound = db.snapshot();
        expect(() => db.createInbound({ bomCode: row.bomCode, qty: -1, date: ANCHOR, remark: "" }, actor)).toThrow();
        expect(db.snapshot()).toEqual(afterOutbound);
    });

    it("keeps ledger and inventory reconciled after ship and inbound", () => {
        const row = readyToShip(db.snapshot()).find(item => item.maxShip > 1);
        expect(row).toBeTruthy();
        if (!row) return;

        const before = db.snapshot();
        const allocation = maxShipOf(db.snapshot(), row.orderNo);
        const record = db.createOutbound({ orderNo: row.orderNo, date: ANCHOR, remark: "测试", qty: 1 }, actor);
        expect(record.qty).toBe(1);
        expect(db.stockOf(row.bomCode)).toBe(row.stock - 1);
        expect(maxShipOf(db.snapshot(), row.orderNo)).toBe(allocation - 1);
        const order = db.orders.find(item => item.orderNo === row.orderNo);
        expect(order).toBeDefined();
        expect(db.remainingOf(order!)).toBe(row.remaining - 1);
        expect(db.outboundLedger.length).toBe(before.outboundLedger.length + 1);

        db.createInbound({ bomCode: row.bomCode, qty: 1, date: ANCHOR, remark: "" }, actor);
        expect(db.stockOf(row.bomCode)).toBe(row.stock);

        for (const bom of db.boms) {
            // 库存口径同 v_bom_stock：只计有效入库与有效出库，作废行不参与
            const inbound = db.inboundLedger
                .filter(item => item.bomCode === bom.code && item.status === "active")
                .reduce((sum, item) => sum + item.qty, 0);
            const outbound = db.outboundLedger
                .filter(item => item.bomCode === bom.code && item.state !== "voided")
                .reduce((sum, item) => sum + item.qty, 0);
            expect(inbound - outbound).toBe(db.stockOf(bom.code));
        }
    });
});

describe("mock db business write rules", () => {
    const SUPER_ACCOUNT = "sys_admin";

    const newOrder = () =>
        db.createOrder(
            {
                customerCode: "CUS-1024",
                bomCode: db.boms[0]!.code,
                qty: 5,
                deliverDate: "2026-03-25",
                orderDate: "2026-03-10",
                remark: "",
            },
            actor,
        );

    it("issues per-day sequential order numbers prefixed by order date", () => {
        const order = newOrder();
        // 2026-03-10 无既有订单，按日序号从 001 起
        expect(order.orderNo).toBe("ZM260310001");
        expect(order.outbound).toBe(0);
        // 同日第二单序号递增
        expect(newOrder().orderNo).toBe("ZM260310002");
    });

    it("rejects qty below shipped and validates delivery window", () => {
        // 自建已发订单：发 3 件后数量下限即 3
        db.createOutbound({ orderNo: stockedOrder.orderNo, date: ANCHOR, remark: "", qty: 3 }, actor);
        const shipped = db.orders.find(order => order.orderNo === stockedOrder.orderNo)!;
        expect(() =>
            db.updateOrder(
                {
                    orderNo: shipped.orderNo,
                    expectedVersion: shipped.version,
                    qty: shipped.outbound - 1,
                },
                actor,
            ),
        ).toThrow("新数量不能低于累计已发");
        // 恰好等于已发量允许（就发这么多，订单结束）
        expect(
            db.updateOrder({ orderNo: shipped.orderNo, expectedVersion: shipped.version, qty: shipped.outbound }, actor)
                .qty,
        ).toBe(shipped.outbound);
        expect(() =>
            db.updateOrder(
                {
                    orderNo: shipped.orderNo,
                    expectedVersion: shipped.version,
                    deliverDate: "2026/03/20",
                },
                actor,
            ),
        ).toThrow("交货日期格式不正确");
        expect(() => db.updateOrder({ orderNo: "ZM-NOPE", expectedVersion: 1, qty: 1 }, actor)).toThrow("订单不存在");
    });

    it("creates and updates customers with region fields, masked phone and derived cooperation", () => {
        const seqBefore = db.customers.reduce(
            (max, customer) => Math.max(max, Number(customer.code.slice(-4)) || 0),
            0,
        );
        const payload = {
            name: "新客户精密制造",
            contact: "王先生",
            phone: "13812345678",
            province: "江苏省",
            city: "苏州市",
            district: "吴中区",
            town: "长桥街道",
            address: "兴园路 1 号",
            ownerAccount: "chen_jie",
            payTerms: "月结 30 天",
        };
        const customer = db.createCustomer(payload, actor);
        expect(customer.code).toBe(`CUS-${String(seqBefore + 1).padStart(4, "0")}`);
        expect(customer.phone).toBe("138****5678");
        expect(customer).not.toHaveProperty("phoneFull");
        expect(customer.city).toBe("苏州市");
        expect(customer.town).toBe("长桥街道");
        expect(customer.owner).toBe("陈洁");
        // 新客户无订单 → 待跟进
        expect(customer.cooperation).toBe("待跟进");

        // 编辑：电话留空保持原掩码；付款条件与联系人可改
        const updated = db.updateCustomer(
            customer.code,
            {
                ...payload,
                expectedVersion: customer.version,
                name: "新客户精密制造有限公司",
                contact: "李女士",
                phone: "",
                payTerms: "月结 60 天",
            },
            actor,
        );
        expect(updated.contact).toBe("李女士");
        expect(updated.phone).toBe("138****5678");
        expect(updated.payTerms).toBe("月结 60 天");

        // 负责人须为在职销售或超级管理员（管理员不行）
        expect(() =>
            db.updateCustomer(
                customer.code,
                { ...payload, expectedVersion: updated.version, ownerAccount: "li_xiaomei" },
                actor,
            ),
        ).toThrow("在职销售");

        // 超级管理员可作为负责人；省市地址可空建档
        const bySuper = db.createCustomer(
            { ...payload, province: "", city: "", district: "", town: "", address: "", ownerAccount: "sys_admin" },
            actor,
        );
        expect(bySuper.owner).toBe("系统管理员");
        expect(bySuper.province).toBe("");
        expect(bySuper.address).toBe("");

        // 字段长度上限对齐契约：payTerms ≤160、address ≤300
        expect(() =>
            db.updateCustomer(
                customer.code,
                { ...payload, expectedVersion: updated.version, payTerms: "月".repeat(161) },
                actor,
            ),
        ).toThrow("付款条件最多 160 个字符");
        expect(() =>
            db.updateCustomer(
                customer.code,
                { ...payload, expectedVersion: updated.version, address: "路".repeat(301) },
                actor,
            ),
        ).toThrow("详细地址最多 300 个字符");

        // 有近期订单后派生为合作中
        const recentOrder = db.createOrder(
            {
                customerCode: customer.code,
                bomCode: db.boms[0]!.code,
                qty: 5,
                deliverDate: "2026-03-25",
                orderDate: ANCHOR,
                remark: "",
            },
            actor,
        );
        expect(db.listCustomers().find(item => item.code === customer.code)?.cooperation).toBe("合作中");
        db.cancelOrder(recentOrder.orderNo, recentOrder.version, "测试取消", actor);
        expect(db.listCustomers().find(item => item.code === customer.code)?.cooperation).toBe("待跟进");
    });

    it("validates account format and uniqueness when creating users", () => {
        expect(() => db.createUser({ name: "重复", account: SUPER_ACCOUNT, role: "staff" })).toThrow("账号已存在");
        expect(() => db.createUser({ name: "非法", account: "a!", role: "staff" })).toThrow("至少 3 位");
        const user = db.createUser({ name: "测试员工", account: "test_staff_01", role: "staff" });
        expect(user).not.toHaveProperty("password");
        expect(user.active).toBe(true);
        expect(db.listUsers().every(item => !("password" in item))).toBe(true);
    });

    it("keeps super role immutable and super account always active", () => {
        const initialSuper = db.listUsers().find(item => item.account === SUPER_ACCOUNT)!;
        db.updateUser(SUPER_ACCOUNT, { expectedVersion: initialSuper.version, name: "超管改名", role: "staff" }, actor);
        const superUser = db.listUsers().find(item => item.account === SUPER_ACCOUNT)!;
        expect(superUser.name).toBe("超管改名");
        expect(superUser.role).toBe("super"); // 角色不被覆盖
        expect(() =>
            db.setUserActive(SUPER_ACCOUNT, { expectedVersion: superUser.version, active: false }, actor),
        ).toThrow("超级管理员不可停用");
        db.updateUser(SUPER_ACCOUNT, { expectedVersion: superUser.version, name: "系统管理员", role: "super" }, actor); // 还原种子展示名
        const staff = db.createUser({ name: "可停用", account: "test_pause_01", role: "staff" });
        const inactive = db.setUserActive(staff.account, { expectedVersion: staff.version, active: false }, actor);
        expect(inactive.active).toBe(false);
        expect(db.setUserActive(staff.account, { expectedVersion: inactive.version, active: true }, actor).active).toBe(
            true,
        );
    });

    it("saves role grants and appends grant log", () => {
        const original = structuredClone(db.getGrant("warehouse"));
        const changed = {
            version: original.version,
            menus: [...original.menus, "customers"],
            actions: { ...original.actions },
        };
        const logBefore = db.grantLog.length;
        const saved = db.saveGrants("warehouse", changed, original.version, "测试授权变更", actor);
        expect(db.getGrant("warehouse").menus).toContain("customers");
        expect(db.grantLog.length).toBe(logBefore + 1);
        expect(db.grantLog[0]!.text).toBe("测试授权变更");
        // 即使未填写补充说明也记录保存动作；恢复原授权，避免影响其他用例
        db.saveGrants("warehouse", original, saved.version, "", actor);
        expect(db.grantLog.length).toBe(logBefore + 2);
        expect(db.getGrant("warehouse")).toMatchObject({ menus: original.menus, actions: original.actions });
    });
});

describe("mock db backend constraint contract", () => {
    const superActor = { account: "sys_admin", role: "super" as const, name: "系统管理员", roleLabel: "超级管理员" };

    it("invalidates every previously issued JWT version after a password change", () => {
        const user = db.createUser({ name: "改密测试", account: "password_version_01", role: "staff" });
        const oldToken = db.issueToken(user.account);
        expect(db.resolveToken(oldToken)?.account).toBe(user.account);

        db.changePassword(user.account, "123456", "new-password-01");
        expect(db.resolveToken(oldToken)).toBeNull();
        expect(db.verifyLogin(user.account, "123456")).toBeNull();
        expect(db.verifyLogin(user.account, "new-password-01")?.account).toBe(user.account);
        expect(db.resolveToken(db.issueToken(user.account))?.account).toBe(user.account);
    });

    it("resets a password to the initial 123456 and invalidates old sessions", () => {
        const user = db.createUser({ name: "重置测试", account: "password_reset_01", role: "staff" });
        db.changePassword(user.account, "123456", "custom-password-01");
        const oldToken = db.issueToken(user.account);

        const reset = db.resetUserPassword(user.account, { expectedVersion: user.version + 1 }, superActor);
        expect(reset.version).toBe(user.version + 2);
        expect(db.resolveToken(oldToken)).toBeNull();
        expect(db.verifyLogin(user.account, "custom-password-01")).toBeNull();
        expect(db.verifyLogin(user.account, "123456")?.account).toBe(user.account);

        // 乐观锁冲突与超级管理员保护
        expect(() => db.resetUserPassword(user.account, { expectedVersion: reset.version - 1 }, superActor)).toThrow(
            "用户已被其他人修改，请刷新后重试",
        );
        const superUser = db.listUsers().find(item => item.account === "sys_admin")!;
        expect(() =>
            db.resetUserPassword(superUser.account, { expectedVersion: superUser.version }, superActor),
        ).toThrow("超级管理员密码不可重置");
    });

    it("stamps createdAt on create and refreshes updatedAt on later changes", () => {
        // 种子用户代表存量系统，携带创建与变更历史（个人中心展示）；刘敏为最新入职、从未变更
        const seeded = db.listUsers().filter(item => !item.account.startsWith("test_"));
        for (const item of seeded) expect(item.createdAt).toBeTruthy();
        const sysAdmin = seeded.find(item => item.account === "sys_admin")!;
        expect(sysAdmin.updatedAt).toBeTruthy();
        expect(seeded.find(item => item.account === "liu_min")?.updatedAt).toBeUndefined();

        const user = db.createUser({ name: "时间戳测试", account: "timestamp_check_01", role: "staff" });
        expect(user.createdAt).toBeTruthy();
        expect(user.updatedAt).toBeUndefined();

        const updated = db.updateUser(
            user.account,
            { expectedVersion: user.version, name: "时间戳改名", role: "staff" },
            superActor,
        );
        expect(updated.updatedAt).toBeTruthy();
        expect(updated.createdAt).toBe(user.createdAt);
    });

    it("allows same-day inbound correction with audit, rejects stale versions, and voids without deletion", () => {
        const bomCode = microBom.code;
        const initialStock = db.stockOf(bomCode);
        const logBefore = db.inboundChangeLog.length;
        const inbound = db.createInbound({ bomCode, qty: 10, date: ANCHOR, remark: "原记录" }, superActor);
        const updated = db.updateInbound(
            inbound.no,
            {
                expectedVersion: inbound.version,
                bomCode,
                qty: 12,
                date: ANCHOR,
                remark: "已修正",
                reason: "数量录错",
            },
            superActor,
        );
        expect(updated).toMatchObject({ qty: 12, version: 2, status: "active" });
        expect(db.stockOf(bomCode)).toBe(initialStock + 12);
        expect(db.inboundChangeLog[0]).toMatchObject({ inboundNo: inbound.no, action: "update", reason: "数量录错" });
        expect(() =>
            db.updateInbound(
                inbound.no,
                { expectedVersion: 1, bomCode, qty: 13, date: ANCHOR, remark: "", reason: "并发旧值" },
                superActor,
            ),
        ).toThrow("其他人修改");

        const voided = db.voidInbound(inbound.no, updated.version, "整单录错", superActor);
        expect(voided).toMatchObject({ status: "voided", version: 3 });
        expect(db.inboundLedger.some(row => row.no === inbound.no)).toBe(true);
        expect(db.stockOf(bomCode)).toBe(initialStock);
        expect(db.inboundChangeLog).toHaveLength(logBefore + 2);

        // 直插一条跨日历史入库，验证跨日只能走库存调整、不可原地修正
        db.inboundLedger.push({
            no: "RK26010190",
            bomCode,
            qty: 7,
            date: "2026-01-05",
            time: "10:00",
            inspector: "历史检验员",
            remark: "",
            status: "active",
            version: 1,
            createdAt: "2026-01-05T10:00:00+08:00",
        });
        expect(() =>
            db.updateInbound(
                "RK26010190",
                { expectedVersion: 1, bomCode, qty: 8, date: "2026-01-05", remark: "", reason: "跨日修正" },
                superActor,
            ),
        ).toThrow("只能修正北京时间当天");
    });

    it("uses immutable stock adjustments for cross-day corrections", () => {
        const bomCode = microBom.code;
        const initialStock = db.stockOf(bomCode);
        expect(() =>
            db.createStockAdjustment(
                { bomCode, qtyDelta: -(initialStock + 1), date: ANCHOR, reason: "错误扣减" },
                superActor,
            ),
        ).toThrow("库存不能小于 0");
        const positive = db.createStockAdjustment(
            { bomCode, qtyDelta: 5, date: ANCHOR, reason: "历史入库少记" },
            superActor,
        );
        expect(db.stockOf(bomCode)).toBe(initialStock + 5);
        const reversal = db.createStockAdjustment(
            { bomCode, qtyDelta: -5, date: ANCHOR, reason: "调整单再次录错" },
            superActor,
        );
        expect(positive.no).not.toBe(reversal.no);
        expect(db.stockOf(bomCode)).toBe(initialStock);
    });

    it("blocks order cancellation while an unprinted shipment exists, then reverses that shipment before cancel", () => {
        const order = newShippableOrder();
        const initialOutbound = order.outbound;
        const initialStock = db.stockOf(order.bomCode);
        const initialOrderVersion = order.version;
        const eventCount = db.outboundQuantityEvents.length;
        const shipment = db.createOutbound({ orderNo: order.orderNo, qty: 1, date: ANCHOR, remark: "" }, superActor);

        expect(order.version).toBe(initialOrderVersion + 1);
        expect(() => db.cancelOrder(order.orderNo, order.version, "客户取消", superActor)).toThrow("请先作废");
        const voided = db.voidOutbound(shipment.no, shipment.version, "登记错误", superActor);
        expect(voided.state).toBe("voided");
        expect(order.outbound).toBe(initialOutbound);
        expect(db.stockOf(order.bomCode)).toBe(initialStock);
        expect(db.outboundQuantityEvents.slice(eventCount)).toMatchObject([
            { shipmentNo: shipment.no, qtyDelta: 1 },
            { shipmentNo: shipment.no, qtyDelta: -1, correctionOf: `${shipment.no}-E01` },
        ]);

        const cancelled = db.cancelOrder(order.orderNo, order.version, "客户取消剩余", superActor);
        expect(cancelled.lifecycleStatus).toBe("cancelled");
        expect(db.remainingOf(cancelled)).toBe(0);
        expect(db.salesOrderChangeLog[0]).toMatchObject({ event: "cancel", orderNo: order.orderNo });
    });

    it("does not relabel a fully shipped order as cancelled", () => {
        const order = newShippableOrder();
        const shipment = db.createOutbound(
            { orderNo: order.orderNo, qty: order.qty, date: ANCHOR, remark: "" },
            superActor,
        );
        // 已打印出库视为正式安排发货，才进入“无剩余量可取消”的终态口径
        db.printOutbound(shipment.no, shipment.version, "", superActor);
        const completed = db.orders.find(item => item.orderNo === order.orderNo)!;
        expect(() => db.cancelOrder(completed.orderNo, completed.version, "客户取消", superActor)).toThrow(
            "没有剩余数量",
        );
        expect(completed.lifecycleStatus).toBe("active");
    });

    it("deletes a never-shipped order with stale change log and audit entry, rejecting shipped or ledgered ones", () => {
        // 手误创建的零发货订单：删除后列表消失，专属变更日志随行清理，操作日志留删除前快照
        const order = newShippableOrder();
        db.deleteOrder(order.orderNo, order.version, superActor);
        expect(db.orders.some(item => item.orderNo === order.orderNo)).toBe(false);
        expect(db.salesOrderChangeLog.some(entry => entry.orderNo === order.orderNo)).toBe(false);
        expect(db.opLog[0]).toMatchObject({
            action: "删除销售订单",
            target: order.orderNo,
            detail: {
                orderNo: order.orderNo,
                lifecycleStatus: "active",
                cancelledAt: null,
                cancelReason: null,
                bomCode: order.bomCode,
                bomName: rotaryBom.name,
                rowVersion: order.version,
            },
        });

        // 乐观锁与不存在分支
        expect(() => db.deleteOrder(order.orderNo, order.version, superActor)).toThrow("订单不存在");
        const another = newShippableOrder();
        expect(() => db.deleteOrder(another.orderNo, another.version - 1, superActor)).toThrow("请刷新后重试");

        // 已发货订单不可删除（即使后来降到只剩部分）
        const shipped = newShippableOrder();
        db.createOutbound({ orderNo: shipped.orderNo, qty: 1, date: ANCHOR, remark: "" }, superActor);
        expect(() => db.deleteOrder(shipped.orderNo, shipped.version, superActor)).toThrow("已有发货记录");

        // 曾有出库又被作废（累计已发回到 0）也不可删除，台账引用保持完整
        const voidedCase = newShippableOrder();
        const shipment = db.createOutbound(
            { orderNo: voidedCase.orderNo, qty: 1, date: ANCHOR, remark: "" },
            superActor,
        );
        db.voidOutbound(shipment.no, shipment.version, "登记错误", superActor);
        expect(voidedCase.outbound).toBe(0);
        expect(() => db.deleteOrder(voidedCase.orderNo, voidedCase.version, superActor)).toThrow("存在出库流水");
        expect(db.outboundLedger.some(row => row.orderNo === voidedCase.orderNo)).toBe(true);
    });

    it("keeps cancellation context in the delete snapshot after cancelling then deleting an order", () => {
        // 先取消再删除：变更日志随行清理，op_log 快照是取消原因/操作人的唯一留存
        const order = newShippableOrder();
        db.cancelOrder(order.orderNo, order.version, "客户撤单", superActor);
        const cancelled = db.orders.find(item => item.orderNo === order.orderNo)!;
        db.deleteOrder(cancelled.orderNo, cancelled.version, superActor);
        expect(db.opLog[0]).toMatchObject({
            action: "删除销售订单",
            detail: {
                lifecycleStatus: "cancelled",
                cancelReason: "客户撤单",
                cancelledBy: superActor.name,
                bomName: rotaryBom.name,
                bomSpec: rotaryBom.spec,
            },
        });
    });

    it("deletes an unreferenced bom with audit entry, rejecting referenced or ledgered ones", () => {
        // 手误建档：未被订单引用、无台账流水，删除后档案消失并留完整快照
        const spare = db.createBom({
            name: "旋转XK2",
            materialItemIds: [idOf("旋转XK2", "2-1"), idOf("旋转XK2", "正面"), idOf("旋转XK2", "0.5")],
        });
        db.deleteBom(spare.code, superActor);
        expect(db.boms.some(item => item.code === spare.code)).toBe(false);
        expect(db.opLog[0]).toMatchObject({
            action: "删除 BOM",
            target: spare.code,
            detail: { code: spare.code, name: spare.name, spec: spare.spec, unit: spare.unit },
        });

        // 不存在分支
        expect(() => db.deleteBom(spare.code, superActor)).toThrow("BOM 不存在");

        // 被销售订单引用（活跃订单）不可删除
        expect(() => db.deleteBom(rotaryBom.code, superActor)).toThrow("已被销售订单引用");

        // 被已取消订单引用同样不可删除：取消不解除引用，只有物理删除才解除
        const cancelledRef = db.createBom({
            name: "旋转XK2",
            materialItemIds: [idOf("旋转XK2", "0-2"), idOf("旋转XK2", "正面"), idOf("旋转XK2", "0.5")],
        });
        const holder = db.createOrder(
            {
                customerCode: "CUS-0542",
                bomCode: cancelledRef.code,
                qty: 2,
                deliverDate: "2026-12-31",
                orderDate: ANCHOR,
                remark: "",
            },
            actor,
        );
        db.cancelOrder(holder.orderNo, holder.version, "客户撤单", superActor);
        expect(() => db.deleteBom(cancelledRef.code, superActor)).toThrow("已被销售订单引用");

        // 存在入库/库存调整流水不可删除，台账与档案的引用保持完整
        const ledgered = db.createBom({
            name: "旋转XK2",
            materialItemIds: [idOf("旋转XK2", "2-1"), idOf("旋转XK2", "反面"), idOf("旋转XK2", "0.5")],
        });
        db.createInbound({ bomCode: ledgered.code, qty: 3, date: ANCHOR, remark: "" }, actor);
        expect(() => db.deleteBom(ledgered.code, superActor)).toThrow("入库或库存调整流水");
        expect(db.boms.some(item => item.code === ledgered.code)).toBe(true);
    });

    it("treats printing as release, versions reprints, and preserves printed quantity when cancelling the remainder", () => {
        const order = newShippableOrder();
        const outboundBefore = order.outbound;
        const shipment = db.createOutbound({ orderNo: order.orderNo, qty: 1, date: ANCHOR, remark: "" }, superActor);
        const registeredVersion = shipment.version;
        const first = db.printOutbound(shipment.no, registeredVersion, "", superActor);
        expect(first).toMatchObject({ printVersion: 1, outbound: { state: "printed", version: 2 } });
        expect(first.document).toMatchObject({
            no: shipment.no,
            printVersion: 1,
            printedBy: superActor.name,
            bomCode: shipment.bomCode,
        });
        expect(db.outboundPrintLog[0]!.documentSnapshot).toEqual(first.document);
        expect(() => db.voidOutbound(shipment.no, registeredVersion, "旧请求", superActor)).toThrow("其他人处理");
        expect(() => db.printOutbound(shipment.no, first.outbound.version, "", superActor)).toThrow("重打必须填写原因");

        const second = db.printOutbound(shipment.no, first.outbound.version, "纸张破损", superActor);
        expect(second.printVersion).toBe(2);
        expect(db.outboundPrintLog.filter(row => row.shipmentNo === shipment.no).map(row => row.printVersion)).toEqual([
            2, 1,
        ]);
        const cancelled = db.cancelOrder(order.orderNo, order.version, "取消剩余数量", superActor);
        expect(cancelled.lifecycleStatus).toBe("cancelled");
        expect(cancelled.outbound).toBe(outboundBefore + 1);
        expect(db.printOutbound(shipment.no, second.outbound.version, "取消后补打存档", superActor).printVersion).toBe(
            3,
        );
    });

    it("allows only confirmed super emergency void of a printed shipment", () => {
        const order = newShippableOrder();
        const initialOutbound = order.outbound;
        const initialStock = db.stockOf(order.bomCode);
        const shipment = db.createOutbound({ orderNo: order.orderNo, qty: 1, date: ANCHOR, remark: "" }, superActor);
        const printed = db.printOutbound(shipment.no, shipment.version, "", superActor).outbound;
        expect(() =>
            db.emergencyVoidOutbound(printed.no, printed.version, "客户临时叫停", false, true, superActor),
        ).toThrow("必须确认货物尚未离开");

        const voided = db.emergencyVoidOutbound(printed.no, printed.version, "客户临时叫停", true, true, superActor);
        expect(voided.state).toBe("voided");
        expect(order.outbound).toBe(initialOutbound);
        expect(db.stockOf(order.bomCode)).toBe(initialStock);
        expect(db.outboundStateLog[0]).toMatchObject({
            event: "void-emergency",
            detail: { goodsNotDeparted: true, paperInvalidated: true },
        });
    });

    it("atomically transfers every customer before deactivating a sales owner", () => {
        const sales = db.listUsers().find(user => user.account === "chen_jie")!;
        const ownedBefore = db.customers.filter(customer => customer.ownerAccount === sales.account);
        expect(ownedBefore.length).toBeGreaterThan(0);
        const replacement = db.createUser({ name: "接任销售", account: "replacement_sales_01", role: "sales" });
        const historyBefore = db.customerOwnerHistory.length;
        const token = db.issueToken(sales.account);

        expect(() =>
            db.setUserActive(sales.account, { expectedVersion: sales.version, active: false }, superActor),
        ).toThrow("请先选择接任销售");
        expect(db.customers.filter(customer => customer.ownerAccount === sales.account)).toHaveLength(
            ownedBefore.length,
        );

        const inactive = db.setUserActive(
            sales.account,
            {
                expectedVersion: sales.version,
                active: false,
                replacementOwnerAccount: replacement.account,
                transferReason: "原负责人离职",
            },
            superActor,
        );
        expect(inactive.active).toBe(false);
        expect(db.resolveToken(token)).toBeNull();
        expect(db.customers.filter(customer => customer.ownerAccount === sales.account)).toHaveLength(0);
        expect(db.customers.filter(customer => customer.ownerAccount === replacement.account)).toHaveLength(
            ownedBefore.length,
        );
        expect(db.customerOwnerHistory.length).toBe(historyBefore + ownedBefore.length);
    });

    it("does not grant protected operations and records no-op grant saves without version churn", () => {
        const current = structuredClone(db.getGrant("staff"));
        const forbidden = {
            ...current,
            menus: [...current.menus, "permissions"],
            actions: { ...current.actions, permissions: ["view"] },
        };
        expect(() => db.saveGrants("staff", forbidden, current.version, "越权测试", superActor)).toThrow("受保护");
        expect(db.getGrant("staff")).toEqual(current);

        const logBefore = db.grantLog.length;
        const noOp = db.saveGrants("staff", current, current.version, "", superActor);
        expect(noOp.version).toBe(current.version);
        expect(db.grantLog).toHaveLength(logBefore + 1);
        expect(db.grantLog[0]!.text).toContain("无变化");
    });
});

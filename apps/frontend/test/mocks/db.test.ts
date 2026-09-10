import { describe, expect, it } from "vitest";

import { maxShipOf, readyToShip } from "@/data/views";
import { newMicroSwitchGaugeOf } from "@/data/categories";
import { ANCHOR, db } from "../../mocks/data/db";

// db 是 import 即 init 的单例，同文件内 it 顺序执行；
// 非法写入一律被整体拒绝（不改快照），因此前两个 it 不产生状态变化。
const actor = { name: "测试", roleLabel: "检验员" };

describe("mock db inventory rules", () => {
    it("seeds new micro switches with one matching-gauge bracket and static plate", () => {
        const rows = db.boms.filter(bom => bom.name === "新微动");
        expect(rows).toHaveLength(3744);
        expect(
            rows.every(
                bom =>
                    !Object.hasOwn(bom.specs, "6.3支架") &&
                    !Object.hasOwn(bom.specs, "4.8支架") &&
                    !Object.hasOwn(bom.specs, "6.3静片") &&
                    !Object.hasOwn(bom.specs, "4.8静片") &&
                    newMicroSwitchGaugeOf(bom.specs["支架"]) === newMicroSwitchGaugeOf(bom.specs["静片"]),
            ),
        ).toBe(true);
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
            const inbound = db.inboundLedger
                .filter(item => item.bomCode === bom.code)
                .reduce((sum, item) => sum + item.qty, 0);
            const outbound = db.outboundLedger
                .filter(item => item.bomCode === bom.code)
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
                customer: "华兴精密制造",
                bomCode: db.boms[0]!.code,
                qty: 5,
                deliverStart: "2026-03-20",
                deliverEnd: "2026-03-25",
                orderDate: "2026-03-10",
                remark: "",
            },
            actor,
        );

    it("issues per-day sequential order numbers prefixed by order date", () => {
        const order = newOrder();
        // 2026-03-10 无既有订单，按日序号从 001 起
        expect(order.orderNo).toBe("ZM260310001");
        expect(db.orders[0]!.orderNo).toBe(order.orderNo);
        expect(order.outbound).toBe(0);
        // 同日第二单序号递增
        expect(newOrder().orderNo).toBe("ZM260310002");
    });

    it("rejects qty below shipped and validates delivery window", () => {
        const shipped = db.orders.find(order => order.outbound > 0);
        expect(shipped).toBeTruthy();
        if (!shipped) return;
        expect(() => db.updateOrder({ orderNo: shipped.orderNo, qty: shipped.outbound - 1 })).toThrow(
            "新数量不能低于累计已发",
        );
        // 恰好等于已发量允许（就发这么多，订单结束）
        expect(db.updateOrder({ orderNo: shipped.orderNo, qty: shipped.outbound }).qty).toBe(shipped.outbound);
        expect(() => db.updateOrder({ orderNo: shipped.orderNo, deliverEnd: "2020-01-01" })).toThrow(
            "交货截止日期不能早于起始日期",
        );
        expect(() => db.updateOrder({ orderNo: "ZM-NOPE", qty: 1 })).toThrow("订单不存在");
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
        const customer = db.createCustomer(payload);
        expect(customer.code).toBe(`CUS-${String(seqBefore + 1).padStart(4, "0")}`);
        expect(customer.phone).toBe("138****5678");
        expect(customer).not.toHaveProperty("phoneFull");
        expect(customer.city).toBe("苏州市");
        expect(customer.town).toBe("长桥街道");
        expect(customer.owner).toBe("陈洁");
        // 新客户无订单 → 待跟进
        expect(customer.cooperation).toBe("待跟进");

        // 编辑：电话留空保持原掩码；付款条件与联系人可改
        const updated = db.updateCustomer(customer.code, {
            ...payload,
            name: "新客户精密制造有限公司",
            contact: "李女士",
            phone: "",
            payTerms: "月结 60 天",
        });
        expect(updated.contact).toBe("李女士");
        expect(updated.phone).toBe("138****5678");
        expect(updated.payTerms).toBe("月结 60 天");

        // 负责人须为在职销售
        expect(() => db.updateCustomer(customer.code, { ...payload, ownerAccount: "sys_admin" })).toThrow("在职销售");

        // 有近期订单后派生为合作中
        db.createOrder(
            {
                customerCode: customer.code,
                customer: customer.name,
                bomCode: db.boms[0]!.code,
                qty: 5,
                deliverStart: "2026-03-20",
                deliverEnd: "2026-03-25",
                orderDate: ANCHOR,
                remark: "",
            },
            actor,
        );
        expect(db.listCustomers().find(item => item.code === customer.code)?.cooperation).toBe("合作中");
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
        db.updateUser(SUPER_ACCOUNT, { name: "超管改名", role: "staff" });
        const superUser = db.listUsers().find(item => item.account === SUPER_ACCOUNT)!;
        expect(superUser.name).toBe("超管改名");
        expect(superUser.role).toBe("super"); // 角色不被覆盖
        expect(() => db.setUserActive(SUPER_ACCOUNT, false)).toThrow("超级管理员不可停用");
        db.updateUser(SUPER_ACCOUNT, { name: "系统管理员", role: "super" }); // 还原种子展示名
        const staff = db.createUser({ name: "可停用", account: "test_pause_01", role: "staff" });
        expect(db.setUserActive(staff.account, false).active).toBe(false);
        expect(db.setUserActive(staff.account, true).active).toBe(true);
    });

    it("saves role grants and appends grant log", () => {
        const original = structuredClone(db.getGrant("warehouse"));
        const changed = { menus: [...original.menus, "customers"], actions: { ...original.actions } };
        const logBefore = db.grantLog.length;
        db.saveGrants("warehouse", changed, "测试授权变更", actor);
        expect(db.getGrant("warehouse").menus).toContain("customers");
        expect(db.grantLog.length).toBe(logBefore + 1);
        expect(db.grantLog[0]!.text).toBe("测试授权变更");
        // 空备注不写日志；恢复原授权，避免影响其他用例
        db.saveGrants("warehouse", original, "", actor);
        expect(db.grantLog.length).toBe(logBefore + 1);
        expect(db.getGrant("warehouse")).toEqual(original);
    });
});

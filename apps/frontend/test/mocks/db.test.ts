import { describe, expect, it } from "vitest";

import { maxShipOf, readyToShip } from "@/data/views";
import { ANCHOR, db } from "../../mocks/data/db";

// db 是 import 即 init 的单例，同文件内 it 顺序执行；
// 非法写入一律被整体拒绝（不改快照），因此前两个 it 不产生状态变化。
const actor = { name: "测试", roleLabel: "检验员" };

describe("mock db inventory rules", () => {
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

        const input = { orderNo: row.orderNo, date: ANCHOR, operator: "测试", remark: "测试" };
        const before = db.snapshot();
        const badQty = [0, -1, 0.5, NaN, maxShipOf(db.snapshot(), row.orderNo) + 1];
        for (const qty of badQty) {
            expect(() => db.createOutbound({ ...input, qty }, actor)).toThrow();
        }
        expect(db.snapshot()).toEqual(before);

        const afterOutbound = db.snapshot();
        expect(() =>
            db.createInbound({ bomCode: row.bomCode, qty: -1, date: ANCHOR, inspector: "测试", remark: "" }, actor),
        ).toThrow();
        expect(db.snapshot()).toEqual(afterOutbound);
    });

    it("keeps ledger and inventory reconciled after ship and inbound", () => {
        const row = readyToShip(db.snapshot()).find(item => item.maxShip > 1);
        expect(row).toBeTruthy();
        if (!row) return;

        const before = db.snapshot();
        const allocation = maxShipOf(db.snapshot(), row.orderNo);
        const record = db.createOutbound(
            { orderNo: row.orderNo, date: ANCHOR, operator: "测试", remark: "测试", qty: 1 },
            actor,
        );
        expect(record.qty).toBe(1);
        expect(db.stockOf(row.bomCode)).toBe(row.stock - 1);
        expect(maxShipOf(db.snapshot(), row.orderNo)).toBe(allocation - 1);
        const order = db.orders.find(item => item.orderNo === row.orderNo);
        expect(order).toBeDefined();
        expect(db.remainingOf(order!)).toBe(row.remaining - 1);
        expect(db.outboundLedger.length).toBe(before.outboundLedger.length + 1);

        db.createInbound({ bomCode: row.bomCode, qty: 1, date: ANCHOR, inspector: "测试", remark: "" }, actor);
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

    it("issues sequential order numbers prefixed by order date", () => {
        const seqBefore = db.orders.reduce((max, order) => Math.max(max, Number(order.orderNo.slice(-3)) || 0), 0);
        const order = newOrder();
        expect(order.orderNo).toBe(`ZM260310${String(seqBefore + 1).padStart(3, "0")}`);
        expect(db.orders[0]!.orderNo).toBe(order.orderNo);
        expect(order.outbound).toBe(0);
    });

    it("requires a 4-char reason when changing order qty", () => {
        const order = newOrder();
        expect(() => db.updateOrder({ orderNo: order.orderNo, qty: 6 }, actor)).toThrow("至少 4 个字");
        expect(() => db.updateOrder({ orderNo: order.orderNo, qty: 6, reason: "太短" }, actor)).toThrow("至少 4 个字");
        expect(db.updateOrder({ orderNo: order.orderNo, qty: 6, reason: "客户追加订单数量" }, actor).qty).toBe(6);
        // 交期调整不涉及数量，无需原因
        expect(db.updateOrder({ orderNo: order.orderNo, deliverDate: "2026-03-28" }, actor).deliverDate).toBe(
            "2026-03-28",
        );
        expect(() => db.updateOrder({ orderNo: "ZM-NOPE", qty: 1, reason: "xxxx" }, actor)).toThrow("订单不存在");
    });

    it("masks customer phone and maps region to city", () => {
        const seqBefore = db.customers.reduce(
            (max, customer) => Math.max(max, Number(customer.code.slice(-4)) || 0),
            0,
        );
        const customer = db.createCustomer(
            {
                name: "新客户",
                contact: "王先生",
                phone: "13812345678",
                region: "华东",
                address: "苏州工业园区",
                remark: "",
            },
            actor,
        );
        expect(customer.code).toBe(`CUS-${String(seqBefore + 1).padStart(4, "0")}`);
        expect(customer.phone).toBe("138****5678");
        expect(customer.phoneFull).toBe("13812345678");
        expect(customer.city).toBe("苏州");
        expect(customer.owner).toBe(actor.name);
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

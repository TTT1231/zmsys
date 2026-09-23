/* permissions 字典与派生工具：默认授权矩阵对照 AGENTS.md 角色表，防止权限回归 */
import { describe, expect, it } from "vitest";

import type { RoleGrant, RoleId } from "@/data/permissions";

import {
    DEFAULT_GRANTS,
    buildDefaultGrants,
    buildNavSections,
    can,
    diffGrants,
    findActiveGroup,
    menuTagFor,
    menuVisible,
} from "@/data/permissions";

const grantOf = (role: RoleId): RoleGrant => DEFAULT_GRANTS[role];

describe("can / menuVisible", () => {
    it("checks perm code against role actions", () => {
        expect(can(grantOf("warehouse"), "inbound:register")).toBe(true);
        expect(can(grantOf("warehouse"), "outbound:ship")).toBe(true);
        expect(can(grantOf("warehouse"), "outbound:print")).toBe(false);
        expect(can(grantOf("admin"), "outbound:print")).toBe(true);
        expect(can(grantOf("sales"), "customers:create")).toBe(true);
        expect(can(grantOf("staff"), "orders:create")).toBe(false);
    });

    it("reserves order deletion and archiving for the super admin only", () => {
        expect(grantOf("super").actions.orders).toEqual(["view", "create", "edit", "cancel", "archive", "delete"]);
        expect(can(grantOf("super"), "orders:delete")).toBe(true);
        expect(can(grantOf("super"), "orders:archive")).toBe(true);
        for (const role of ["admin", "warehouse", "sales", "staff"] as const) {
            expect(can(grantOf(role), "orders:delete")).toBe(false);
            expect(can(grantOf(role), "orders:archive")).toBe(false);
        }
    });

    it("reserves bom deletion for the super admin only", () => {
        expect(grantOf("super").actions.bom).toEqual(["view", "create", "delete"]);
        expect(can(grantOf("super"), "bom:delete")).toBe(true);
        for (const role of ["admin", "warehouse", "sales", "staff"] as const) {
            expect(can(grantOf(role), "bom:delete")).toBe(false);
        }
    });

    it("returns false without grant", () => {
        expect(can(undefined, "orders:view")).toBe(false);
    });

    it("checks menu visibility by key", () => {
        expect(menuVisible(grantOf("sales"), "customers")).toBe(true);
        expect(menuVisible(grantOf("warehouse"), "customers")).toBe(false);
        expect(menuVisible(grantOf("admin"), "permissions")).toBe(false);
        expect(menuVisible(grantOf("super"), "permissions")).toBe(true);
    });
});

describe("buildDefaultGrants", () => {
    it("matches the role matrix documented in AGENTS.md", () => {
        const grants = buildDefaultGrants();
        // 超级管理员：全部菜单（含 permissions 子项）与全部动作
        expect(grants.super.menus).toContain("permissions");
        expect(grants.super.menus).toContain("permissions-accounts");
        expect(grants.super.actions.outbound).toEqual(["view", "ship", "void", "print"]);
        expect(grants.super.actions.permissions).toEqual(["view", "manage"]);
        // 管理员：出入库只读 + 打印，无用户权限
        expect(grants.admin.menus).not.toContain("permissions");
        expect(grants.admin.actions.inbound).toEqual(["view"]);
        expect(grants.admin.actions.outbound).toEqual(["view", "print"]);
        expect(grants.admin.actions.orders).toEqual(["view", "create", "edit", "cancel"]);
        // 仓管：可写台账不可打印，无客户档案
        expect(grants.warehouse.menus).not.toContain("customers");
        expect(grants.warehouse.actions.inbound).toEqual(["view", "register", "edit"]);
        expect(grants.warehouse.actions.outbound).toEqual(["view", "ship", "void"]);
        // 销售：业务三模块全量，出入库只读且不可打印
        expect(grants.sales.menus).not.toContain("permissions");
        expect(grants.sales.actions.customers).toEqual(["view", "create", "edit"]);
        expect(grants.sales.actions.outbound).toEqual(["view"]);
        // 员工：所有可见模块仅查看
        expect(grants.staff.menus).not.toContain("customers");
        for (const menu of ["orders", "bom", "inbound", "outbound"] as const) {
            expect(grants.staff.actions[menu]).toEqual(["view"]);
        }
    });

    it("keeps every role able to view shared modules", () => {
        for (const role of ["super", "admin", "warehouse", "sales", "staff"] as const) {
            expect(can(grantOf(role), "orders:view")).toBe(true);
            expect(can(grantOf(role), "bom:view")).toBe(true);
        }
    });
});

describe("menuTagFor", () => {
    it("summarizes grants per menu", () => {
        expect(menuTagFor("workbench", grantOf("super"))).toBe("专属视图");
        expect(menuTagFor("orders", grantOf("staff"))).toBe("只读");
        expect(menuTagFor("outbound", grantOf("super"))).toBe("全部权限");
        expect(menuTagFor("outbound", grantOf("admin"))).toBe("查看+打印");
        expect(menuTagFor("outbound", grantOf("warehouse"))).toBe("查看+发货 / 作废");
        expect(menuTagFor("unknown-menu", grantOf("super"))).toBe("");
    });

    it("returns empty string when menu has no granted actions", () => {
        expect(menuTagFor("orders", { version: 1, menus: ["orders"], actions: { orders: [] } })).toBe("");
    });
});

describe("buildNavSections", () => {
    it("renders warehouse-only note item and role alias label", () => {
        const sections = buildNavSections("warehouse", grantOf("warehouse"));
        const all = sections.flatMap(section => section.items);
        const note = all.find(item => item.label === "变更记录");
        expect(note).toMatchObject({ tag: "说明" });
        expect(note?.to).toBeUndefined();
        expect(note?.note).toContain("审计记录");
        expect(all.find(item => item.to === "/orders")?.label).toBe("待发货订单");
    });

    it("hides note item from other roles", () => {
        const all = buildNavSections("admin", grantOf("admin")).flatMap(section => section.items);
        expect(all.some(item => item.label === "变更记录")).toBe(false);
    });

    it("orders sections workbench-first and drops empty groups", () => {
        expect(buildNavSections("super", grantOf("super")).map(section => section.group)).toEqual([
            "工作台",
            "业务导航",
        ]);
        // 管理员无「用户与权限」授权，但工作台组仍有工作台/归档订单两项
        expect(buildNavSections("admin", grantOf("admin")).map(section => section.group)).toEqual([
            "工作台",
            "业务导航",
        ]);
        // 组内一项都没有时整组不出现
        const ordersOnly: RoleGrant = { version: 1, menus: ["orders"], actions: {} };
        expect(buildNavSections("admin", ordersOnly).map(section => section.group)).toEqual(["业务导航"]);
    });

    it("carries group icon for rail and horizontal menus", () => {
        const sections = buildNavSections("super", grantOf("super"));
        expect(sections.map(section => section.icon)).toEqual(["chart", "cube"]);
    });

    it("hides customer menu from warehouse nav", () => {
        const all = buildNavSections("warehouse", grantOf("warehouse")).flatMap(section => section.items);
        expect(all.some(item => item.to === "/customers")).toBe(false);
    });
});

describe("findActiveGroup", () => {
    const sections = buildNavSections("super", grantOf("super"));

    it("resolves the group owning the current route by path prefix", () => {
        expect(findActiveGroup(sections, "/workbench")?.group).toBe("工作台");
        expect(findActiveGroup(sections, "/permissions")?.group).toBe("工作台");
        expect(findActiveGroup(sections, "/orders/12345")?.group).toBe("业务导航");
    });

    it("returns undefined for routes outside the menu", () => {
        expect(findActiveGroup(sections, "/search")).toBeUndefined();
        expect(findActiveGroup(sections, "/login")).toBeUndefined();
    });
});

describe("diffGrants", () => {
    it("describes added and removed actions with catalog labels", () => {
        const before = { version: 1, menus: ["orders"], actions: { orders: ["view"] } };
        const after = { version: 2, menus: ["orders"], actions: { orders: ["view", "create"] } };
        expect(diffGrants(before, after)).toBe("新增 销售订单：新建订单");
        expect(diffGrants(after, before)).toBe("移除 销售订单：新建订单");
    });

    it("describes menu level changes with brackets", () => {
        const before = { version: 1, menus: ["orders", "customers"], actions: { orders: ["view"] } };
        const after = { version: 2, menus: ["orders"], actions: { orders: ["view"] } };
        expect(diffGrants(before, after)).toBe("移除 菜单【客户档案】");
    });

    it("combines add and remove parts in order", () => {
        const before = {
            version: 1,
            menus: ["orders"],
            actions: { orders: ["view"], customers: ["view", "create"] },
        };
        const after = { version: 2, menus: ["orders"], actions: { orders: ["view", "edit"], customers: ["view"] } };
        expect(diffGrants(before, after)).toBe("新增 销售订单：编辑订单，移除 客户档案：新建客户");
    });

    it("returns empty string for identical grants", () => {
        const grant = grantOf("admin");
        expect(diffGrants(grant, grant)).toBe("");
    });

    it("labels sub-menu keys with parent prefix", () => {
        const before = { version: 1, menus: ["permissions"], actions: {} };
        const after = { version: 2, menus: ["permissions", "permissions-accounts", "permissions-roles"], actions: {} };
        expect(diffGrants(before, after)).toBe("新增 菜单【用户与权限 · 账号管理、用户与权限 · 角色与权限】");
    });
});

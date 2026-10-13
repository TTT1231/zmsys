/* permissions 字典与派生工具：默认授权矩阵对照 AGENTS.md 角色表，防止权限回归 */
import { describe, expect, it } from "vitest";

import type { RoleGrant, RoleId } from "@/data/permissions";

import {
    DEFAULT_GRANTS,
    DEFAULT_PROTECTED_CODES,
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
        expect(can(grantOf("warehouse"), "outbound:delete")).toBe(true);
        expect(can(grantOf("admin"), "outbound:delete")).toBe(false);
        expect(can(grantOf("sales"), "customers:create")).toBe(true);
        expect(can(grantOf("staff"), "orders:create")).toBe(false);
    });

    it("reserves order deletion and archiving for the super admin only", () => {
        expect(grantOf("super").actions.orders).toEqual(["view", "create", "edit", "archive", "unarchive", "delete"]);
        expect(can(grantOf("super"), "orders:delete")).toBe(true);
        expect(can(grantOf("super"), "orders:archive")).toBe(true);
        expect(can(grantOf("super"), "orders:unarchive")).toBe(true);
        for (const role of ["admin", "warehouse", "sales", "staff"] as const) {
            expect(can(grantOf(role), "orders:delete")).toBe(false);
            expect(can(grantOf(role), "orders:archive")).toBe(false);
            expect(can(grantOf(role), "orders:unarchive")).toBe(false);
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
        // 超级管理员：全部菜单（含 permissions 子项）与全部动作（含跨天作废/删除）
        expect(grants.super.menus).toContain("permissions");
        expect(grants.super.menus).toContain("permissions-accounts");
        expect(grants.super.actions.inbound).toEqual(["view", "register", "edit", "delete", "adjust", "void-any-day"]);
        expect(grants.super.actions.outbound).toEqual(["view", "ship", "void", "delete"]);
        expect(grants.super.actions.permissions).toEqual(["view", "manage"]);
        // 分析页（交付甘特图迁出）：可授权菜单，默认仅超管持有
        expect(grants.super.menus).toContain("analytics");
        for (const role of ["admin", "warehouse", "sales", "staff"] as const) {
            expect(grants[role].menus).not.toContain("analytics");
        }
        // 管理员：出入库只读，无用户权限
        expect(grants.admin.menus).not.toContain("permissions");
        expect(grants.admin.actions.inbound).toEqual(["view"]);
        expect(grants.admin.actions.outbound).toEqual(["view"]);
        expect(grants.admin.actions.orders).toEqual(["view", "create", "edit"]);
        // 仓管：可写台账（含删除已作废），无客户档案；跨天作废仅超管
        expect(grants.warehouse.menus).not.toContain("customers");
        expect(grants.warehouse.actions.inbound).toEqual(["view", "register", "edit", "delete"]);
        expect(grants.warehouse.actions.outbound).toEqual(["view", "ship", "void", "delete"]);
        expect(can(grants.warehouse, "inbound:void-any-day")).toBe(false);
        // 销售：业务三模块全量，出入库只读
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
        expect(menuTagFor("outbound", grantOf("admin"))).toBe("只读");
        // 仓管持出库目录全部非 view 动作（打印移除后恰好全持有）；超 7 字截断展示改由入库目录覆盖
        expect(menuTagFor("outbound", grantOf("warehouse"))).toBe("全部权限");
        expect(menuTagFor("inbound", grantOf("warehouse"))).toBe("查看+入库 / 编…");
        expect(menuTagFor("unknown-menu", grantOf("super"))).toBe("");
    });

    it("returns empty string when menu has no granted actions", () => {
        expect(menuTagFor("orders", { version: 1, menus: ["orders"], actions: { orders: [] } })).toBe("");
    });

    it("labels protected system entries with the unified super-only tag", () => {
        // 系统组受保护菜单统一「超管专属」口径：不套用只读/全部权限归并（矩阵超管列同款口径）
        expect(menuTagFor("permissions", grantOf("super"))).toBe("超管专属");
        expect(menuTagFor("system-backup", grantOf("super"))).toBe("超管专属");
        expect(menuTagFor("system-restore", grantOf("super"))).toBe("超管专属");
        // 系统日志已降为普通可授权码：超管仅持 view 动作，按通用口径标「只读」
        expect(menuTagFor("system-logs", grantOf("super"))).toBe("只读");
    });
});

describe("DEFAULT_PROTECTED_CODES（兜底受保护全集 = 迁移播种默认态）", () => {
    it("covers seeded protected menus, children and actions", () => {
        for (const code of [
            "menu:permissions",
            "menu:permissions-accounts",
            "menu:permissions-roles",
            "menu:permissions-matrix",
            "menu:system-backup",
            "menu:system-restore",
            "permissions:view",
            "permissions:manage",
            "system-backup:run",
            "system-restore:run",
            "orders:delete",
            "orders:archive",
            "orders:unarchive",
            "customers:bulk-transfer",
            "menu:bom-structure",
            "bom-structure:view",
            "bom-structure:manage",
            "bom:delete",
            "inbound:adjust",
            "inbound:void-any-day",
        ]) {
            expect(DEFAULT_PROTECTED_CODES.has(code), code).toBe(true);
        }
        // 普通可授权权限不在受保护全集（系统日志 20261013100000 迁移起已降级）
        expect(DEFAULT_PROTECTED_CODES.has("orders:view")).toBe(false);
        expect(DEFAULT_PROTECTED_CODES.has("menu:analytics")).toBe(false);
        expect(DEFAULT_PROTECTED_CODES.has("menu:system-logs")).toBe(false);
        expect(DEFAULT_PROTECTED_CODES.has("system-logs:view")).toBe(false);
    });
});

describe("运行时受保护集（protectedCodes，超管可解锁）", () => {
    const unlocked = new Set<string>();

    it("解锁后菜单标签按授权正常派生，不再「超管专属」；默认参仍走兜底集", () => {
        expect(menuTagFor("permissions", grantOf("super"), unlocked)).toBe("全部权限");
        expect(menuTagFor("permissions", grantOf("super"))).toBe("超管专属");
    });

    it("系统日志已降为普通可授权码：授权即进侧边栏，标签按通用口径派生", () => {
        const adminGranted: RoleGrant = {
            version: 1,
            menus: [...grantOf("admin").menus, "system-logs"],
            actions: { ...grantOf("admin").actions, "system-logs": ["view"] },
        };
        const items = buildNavSections("admin", adminGranted)
            .find(section => section.group === "系统")
            ?.items.find(item => item.to === "/system-logs");
        expect(items?.tag).toBe("只读");
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
            "系统",
        ]);
        // 管理员默认无「分析页」「用户与权限」授权：工作台组仅剩工作台，归档订单随业务导航组；非 super 无系统组
        expect(buildNavSections("admin", grantOf("admin")).map(section => section.group)).toEqual([
            "工作台",
            "业务导航",
        ]);
        const adminAll = buildNavSections("admin", grantOf("admin")).flatMap(section => section.items);
        expect(adminAll.find(item => item.to === "/analytics")).toBeUndefined();
        expect(
            buildNavSections("admin", grantOf("admin"))
                .find(section => section.group === "业务导航")
                ?.items.some(item => item.to === "/archived-orders"),
        ).toBe(true);
        // 组内一项都没有时整组不出现
        const ordersOnly: RoleGrant = { version: 1, menus: ["orders"], actions: {} };
        expect(buildNavSections("admin", ordersOnly).map(section => section.group)).toEqual(["业务导航"]);
    });

    it("carries group icon for rail and horizontal menus", () => {
        const sections = buildNavSections("super", grantOf("super"));
        expect(sections.map(section => section.icon)).toEqual(["chart", "briefcase", "sliders"]);
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
        expect(findActiveGroup(sections, "/analytics")?.group).toBe("工作台");
        expect(findActiveGroup(sections, "/permissions")?.group).toBe("系统");
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

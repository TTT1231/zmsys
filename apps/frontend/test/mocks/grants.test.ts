// @vitest-environment jsdom
/* 授权持久化清洗：localStorage 被篡改塞入脏授权行（protected 动作授给普通角色、
   permissions 菜单外泄）时，加载即剔除，不会进入授权面（对齐后端 JWT 侧过滤）。 */
import { expect, it } from "vitest";
import { buildDefaultGrants } from "@/data/permissions";
import { GRANT_LS_KEY, GRANT_LS_VERSION } from "../../mocks/data/db";

// 先注入脏数据再动态 import：db 模块加载时执行 loadGrants，顺序不能颠倒
const dirty = buildDefaultGrants();
dirty.admin.actions.orders = ["view", "create", "edit", "cancel", "delete"];
dirty.admin.actions.bom = ["view", "create", "delete"];
dirty.admin.menus = [...dirty.admin.menus, "permissions"];
localStorage.setItem(GRANT_LS_KEY, JSON.stringify({ version: GRANT_LS_VERSION, grants: dirty }));

const { db } = await import("../../mocks/data/db");

it("loads persisted grants with protected actions and menus stripped for non-super roles", () => {
    const admin = db.getGrant("admin");
    expect(admin.actions.orders).toEqual(["view", "create", "edit", "cancel"]);
    expect(admin.actions.bom).toEqual(["view", "create"]);
    expect(admin.menus).not.toContain("permissions");
});

it("keeps the full default grant set for the locked super role", () => {
    expect(db.getGrant("super").actions.orders).toContain("delete");
    expect(db.getGrant("super").actions.bom).toContain("delete");
    expect(db.getGrant("super").menus).toContain("permissions");
});

/* 后端契约同步：MySQL 权限/BOM 种子与前端字典一致，JWT 本体不落 sys_user */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BOM_CATEGORIES } from "@/data/categories";
import { ACTION_CATALOG, DEFAULT_GRANTS, MENU_CATALOG } from "@/data/permissions";

const sql = readFileSync(resolve(process.cwd(), "../../docs/mysql-8-schema.sql"), "utf8");

describe("mysql backend baseline", () => {
    it("seeds every grantable menu and action permission code", () => {
        const menuKeys = MENU_CATALOG.filter(menu => !menu.onlyFor).flatMap(menu => [
            menu.key,
            ...(menu.children ?? []).map(child => child.key),
        ]);
        menuKeys.forEach(menu => expect(sql).toContain(`'menu:${menu}'`));
        Object.entries(ACTION_CATALOG).forEach(([menu, actions]) =>
            actions.forEach(action => expect(sql).toContain(`'${menu}:${action.id}'`)),
        );
    });

    it("seeds the documented default grants for every non-super role", () => {
        for (const role of ["admin", "warehouse", "sales", "staff"] as const) {
            DEFAULT_GRANTS[role].menus.forEach(menu =>
                expect(sql).toContain(`('${role}', 'menu:${menu}', 'BOOTSTRAP', NULL)`),
            );
            Object.entries(DEFAULT_GRANTS[role].actions).forEach(([menu, actions]) =>
                actions.forEach(action => expect(sql).toContain(`('${role}', '${menu}:${action}', 'BOOTSTRAP', NULL)`)),
            );
        }
    });

    it("seeds every backend-authoritative BOM category and field", () => {
        BOM_CATEGORIES.forEach(category => {
            expect(sql).toContain(`'${category.key}', '${category.name}', '${category.codePrefix}'`);
            category.groups.forEach(node => {
                node.items.forEach(item => expect(sql).toContain(`(${item.id}, ${node.id}, '${item.name}'`));
            });
        });
        // 预生成组合模式已移除：XK3 与 spec_schema 不再落库
        expect(sql).not.toContain("'xk3'");
        expect(sql).not.toContain("spec_schema");
    });

    it("stores only a JWT invalidation version, not JWT values", () => {
        const userTable = sql.match(/CREATE TABLE sys_user \([\s\S]*?\n\) ENGINE=/)?.[0] ?? "";
        expect(userTable).toContain("token_version");
        expect(userTable).not.toMatch(/access_token|refresh_token|jwt_token/i);
    });
});

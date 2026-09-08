/* 用户与角色授权 handlers：sys_user / sys_grant 对应的 API */
import { http } from "msw";
import type { CreateUserInput, RoleDef, UpdateUserInput } from "@/api";
import type { RoleGrant, RoleId, GrantMap } from "@/data/permissions";
import { ROLES, ROLE_IDS } from "@/data/permissions";
import { db } from "../data/db";
import { authenticate, fail, ok } from "./shared";

export const userHandlers = [
    http.get("/api/users", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        return ok(db.listUsers());
    }),

    http.post("/api/users", async ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        const body = (await request.json().catch(() => null)) as CreateUserInput | null;
        if (!body?.name?.trim()) return fail("请输入姓名");
        try {
            return ok(db.createUser(body));
        } catch (error) {
            return fail(error instanceof Error ? error.message : "用户创建失败");
        }
    }),

    http.put("/api/users/:account", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        const body = (await request.json().catch(() => null)) as UpdateUserInput | null;
        if (!body?.name?.trim()) return fail("请输入姓名");
        try {
            return ok(db.updateUser(String(params.account), body));
        } catch (error) {
            return fail(error instanceof Error ? error.message : "用户更新失败");
        }
    }),

    http.patch("/api/users/:account/status", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        const body = (await request.json().catch(() => null)) as { active?: boolean } | null;
        if (!body || typeof body.active !== "boolean") return fail("请求参数错误");
        try {
            return ok(db.setUserActive(String(params.account), body.active));
        } catch (error) {
            return fail(error instanceof Error ? error.message : "状态更新失败");
        }
    }),
];

export const roleHandlers = [
    http.get("/api/roles", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        return ok(ROLES satisfies RoleDef[]);
    }),

    // 全量授权（权限矩阵 / 角色编辑聚合读取）。注意先于 /:roleId 注册避免路径歧义
    http.get("/api/roles/grants", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        return ok(db.grants satisfies GrantMap);
    }),

    http.get("/api/roles/grants/log", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        return ok(db.grantLog.map(entry => ({ ...entry })));
    }),

    http.put("/api/roles/:roleId/grants", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        const roleId = String(params.roleId) as RoleId;
        if (!(ROLE_IDS as string[]).includes(roleId)) return fail("角色不存在", 404);
        if (roleId === "super") return fail("超级管理员为内置角色，授权不可修改", 403);
        const body = (await request.json().catch(() => null)) as { grant?: RoleGrant; note?: string } | null;
        if (!body?.grant?.menus || !body?.grant?.actions) return fail("请求参数错误");
        db.saveGrants(roleId, body.grant, body.note ?? "", auth.actor);
        return ok(body.grant);
    }),
];

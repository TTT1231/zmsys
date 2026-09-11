/* 用户与角色授权 handlers：sys_user / sys_grant 对应的 API */
import { http } from "msw";
import type { CreateUserInput, RoleDef, SetUserStatusInput, UpdateUserInput } from "@/api";
import type { RoleGrant, RoleId, GrantMap } from "@/data/permissions";
import { ROLES, ROLE_IDS } from "@/data/permissions";
import { db } from "../data/db";
import { authenticate, authorized, fail, idempotent, ok } from "./shared";

const statusOf = (message: string) =>
    message.includes("不存在") ? 404 : /已被|已存在|请先|同一/.test(message) ? 409 : 400;

export const userHandlers = [
    http.get("/api/customer-owner-options", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "customers:view")) return fail("无权查看客户负责人选项", 403);
        return ok(
            db
                .listUsers()
                .filter(user => user.role === "sales" && user.active)
                .map(({ name, account }) => ({ name, account })),
        );
    }),

    http.get("/api/users", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "permissions:view")) return fail("无权查看用户列表", 403);
        return ok(db.listUsers());
    }),

    http.post("/api/users", async ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "permissions:manage")) return fail("无权新增用户", 403);
        const body = (await request.json().catch(() => null)) as CreateUserInput | null;
        if (!body?.name?.trim()) return fail("请输入姓名");
        try {
            return ok(idempotent(request, auth.user.account, "users:create", body, () => db.createUser(body)));
        } catch (error) {
            const message = error instanceof Error ? error.message : "用户创建失败";
            return fail(message, message.includes("同一 Idempotency-Key") ? 409 : 400);
        }
    }),

    http.put("/api/users/:account", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "permissions:manage")) return fail("无权编辑用户", 403);
        const body = (await request.json().catch(() => null)) as UpdateUserInput | null;
        if (!body?.name?.trim()) return fail("请输入姓名");
        if (!Number.isSafeInteger(body.expectedVersion)) return fail("缺少用户版本");
        try {
            return ok(db.updateUser(String(params.account), body, auth.actor));
        } catch (error) {
            const message = error instanceof Error ? error.message : "用户更新失败";
            return fail(message, statusOf(message));
        }
    }),

    http.patch("/api/users/:account/status", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "permissions:manage")) return fail("无权修改用户状态", 403);
        const body = (await request.json().catch(() => null)) as SetUserStatusInput | null;
        if (!body || typeof body.active !== "boolean" || !Number.isSafeInteger(body.expectedVersion)) {
            return fail("请求参数错误");
        }
        try {
            return ok(db.setUserActive(String(params.account), body, auth.actor));
        } catch (error) {
            const message = error instanceof Error ? error.message : "状态更新失败";
            return fail(message, statusOf(message));
        }
    }),
];

export const roleHandlers = [
    http.get("/api/roles", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "permissions:view")) return fail("无权查看角色", 403);
        return ok(ROLES satisfies RoleDef[]);
    }),

    // 全量授权（权限矩阵 / 角色编辑聚合读取）。注意先于 /:roleId 注册避免路径歧义
    http.get("/api/roles/grants", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "permissions:view")) return fail("无权查看角色授权", 403);
        return ok(db.grants satisfies GrantMap);
    }),

    http.get("/api/roles/grants/log", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "permissions:view")) return fail("无权查看授权日志", 403);
        return ok(db.grantLog.map(entry => ({ ...entry })));
    }),

    http.put("/api/roles/:roleId/grants", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "permissions:manage")) return fail("无权修改角色授权", 403);
        const roleId = String(params.roleId) as RoleId;
        if (!(ROLE_IDS as string[]).includes(roleId)) return fail("角色不存在", 404);
        if (roleId === "super") return fail("超级管理员为内置角色，授权不可修改", 403);
        const body = (await request.json().catch(() => null)) as {
            grant?: RoleGrant;
            expectedVersion?: number;
            note?: string;
        } | null;
        if (!body?.grant?.menus || !body?.grant?.actions) return fail("请求参数错误");
        if (!Number.isSafeInteger(body.expectedVersion)) return fail("缺少授权版本");
        try {
            return ok(db.saveGrants(roleId, body.grant, body.expectedVersion!, body.note ?? "", auth.actor));
        } catch (error) {
            const message = error instanceof Error ? error.message : "授权保存失败";
            return fail(message, message.includes("其他人") ? 409 : 400);
        }
    }),
];

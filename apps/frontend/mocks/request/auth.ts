import { http } from "msw";
import { db } from "../data/db";
import { authenticate, fail, ok } from "./shared";

export const authHandlers = [
    // 登录失败用 400（401 保留给 token 失效，避免触发全局登出跳转）
    http.post("/api/auth/login", async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { account?: string; password?: string } | null;
        if (!body?.account?.trim() || !body?.password) return fail("请输入账号与密码");
        const user = db.verifyLogin(body.account, body.password);
        if (!user) return fail("账号或密码错误");
        const { password: _password, tokenVersion: _tokenVersion, ...safe } = user;
        return ok({ accessToken: db.issueToken(safe.account), user: safe });
    }),

    http.post("/api/auth/logout", () => ok(null)),

    http.get("/api/auth/profile", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        return ok({ user: auth.user, grant: db.getGrant(auth.user.role) });
    }),

    // 个人中心：修改自己的密码（不强制；成功后旧 token 失效，用户重新登录）。
    // 姓名等资料为管理员域，由 PUT /users/{account} 维护，不再提供自助改名
    http.put("/api/auth/password", async ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        const body = (await request.json().catch(() => null)) as { oldPassword?: string; newPassword?: string } | null;
        if (!body?.oldPassword || !body?.newPassword) return fail("请输入旧密码与新密码");
        try {
            db.changePassword(auth.user.account, body.oldPassword, body.newPassword);
            return ok(null);
        } catch (error) {
            return fail(error instanceof Error ? error.message : "密码修改失败");
        }
    }),
];

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
        const { password: _password, ...safe } = user;
        return ok({ accessToken: db.issueToken(safe.account), user: safe });
    }),

    http.post("/api/auth/logout", () => ok(null)),

    http.get("/api/auth/profile", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        return ok({ user: auth.user, grant: db.getGrant(auth.user.role) });
    }),
];

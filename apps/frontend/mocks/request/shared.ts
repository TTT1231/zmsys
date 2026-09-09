/* handler 公共工具：信封响应、延迟、token 鉴权 */
import { HttpResponse, delay } from "msw";
import type { Actor } from "../data/db";
import type { WbUser } from "@/api";
import { ROLES } from "@/data/permissions";
import { db } from "../data/db";

/** 成功信封（400–900ms 随机延迟：让加载/刷新的过渡效果可感知，仍不至于拖慢演示） */
export async function ok<T>(data: T) {
    await delay(400 + Math.random() * 500);
    return HttpResponse.json({ code: 0, data, message: "ok" });
}

/** 失败信封：HTTP 状态码同时作为业务 code */
export function fail(message: string, status: number = 400) {
    return HttpResponse.json({ code: status, data: null, message }, { status });
}

export interface AuthContext {
    user: WbUser;
    actor: Actor;
}

/** 解析 Bearer token 得到当前用户；无效返回 null（handler 应答 401） */
export function authenticate(request: Request): AuthContext | null {
    const header = request.headers.get("Authorization");
    if (!header?.startsWith("Bearer ")) return null;
    const user = db.resolveToken(header.slice(7));
    if (!user) return null;
    const { password: _password, ...safe } = user;
    return { user: safe, actor: { name: safe.name, roleLabel: roleLabelOf(safe.role) } };
}

export function roleLabelOf(role: string): string {
    return ROLES.find(item => item.id === role)?.name ?? role;
}

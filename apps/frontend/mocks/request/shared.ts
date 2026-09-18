/* handler 公共工具：信封响应、延迟、token 鉴权 */
import { HttpResponse, delay } from "msw";
import type { Actor } from "../data/db";
import type { WbUser } from "@/api";
import { ROLES, can, type PermCode } from "@/data/permissions";
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

interface IdempotencyEntry {
    fingerprint: string;
    result: unknown;
}

const idempotencyCache = new Map<string, IdempotencyEntry>();

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

/** 模拟真实后端成功写请求的幂等重放；同 key 换请求体会冲突。 */
export function idempotent<T>(
    request: Request,
    actorAccount: string,
    operationKey: string,
    body: unknown,
    execute: () => T,
): T {
    const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (key.length < 8 || key.length > 128 || !/^[\x21-\x7E]+$/.test(key)) {
        throw new Error("缺少或非法的 Idempotency-Key");
    }
    const cacheKey = `${actorAccount}\u0000${operationKey}\u0000${key}`;
    const fingerprint = canonicalJson(body);
    const previous = idempotencyCache.get(cacheKey);
    if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error("同一 Idempotency-Key 不能用于不同请求");
        return structuredClone(previous.result) as T;
    }
    const result = execute();
    const snapshot = structuredClone(result);
    idempotencyCache.set(cacheKey, { fingerprint, result: snapshot });
    return structuredClone(snapshot);
}

/** 解析 Bearer token 得到当前用户；无效返回 null（handler 应答 401） */
export function authenticate(request: Request): AuthContext | null {
    const header = request.headers.get("Authorization");
    if (!header?.startsWith("Bearer ")) return null;
    const user = db.resolveToken(header.slice(7));
    if (!user) return null;
    const { password: _password, tokenVersion: _tokenVersion, ...safe } = user;
    return {
        user: safe,
        actor: { account: safe.account, role: safe.role, name: safe.name, roleLabel: roleLabelOf(safe.role) },
    };
}

/** mock 与真实后端一致：JWT 只解析身份，动作授权实时读取当前角色授权。 */
export function authorized(auth: AuthContext, permission: PermCode): boolean {
    return auth.user.role === "super" || can(db.getGrant(auth.user.role), permission);
}

export function roleLabelOf(role: string): string {
    return ROLES.find(item => item.id === role)?.name ?? role;
}

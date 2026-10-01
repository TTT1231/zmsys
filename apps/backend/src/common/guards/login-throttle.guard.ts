import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";

/**
 * 登录暴力破解限流：按 IP + 账号内存计数，窗口内超阈值返回 429。
 * 独立进程内存实现（部署单实例足够；多实例部署时换集中式存储）。
 * 429 经统一异常信封返回；过期条目在 Map 超过清扫阈值时惰性删除，
 * 防止独立 IP/账号对长期累积导致的无界增长。
 */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
    /** 阈值与窗口暴露为静态字段：e2e 调低配额跑 429 用例 */
    static maxAttempts = 10;
    static windowMs = 5 * 60 * 1000;
    /** 过期条目惰性清扫阈值：超过即遍历删除已过期项 */
    private static sweepThreshold = 1000;

    private readonly attempts = new Map<string, { count: number; resetAt: number }>();

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<{
            ip?: string;
            body?: { account?: string };
        }>();
        const key = `${request.ip ?? "unknown"}:${request.body?.account ?? ""}`;
        const now = Date.now();
        if (this.attempts.size >= LoginThrottleGuard.sweepThreshold) {
            for (const [staleKey, entry] of this.attempts) {
                if (now > entry.resetAt) {
                    this.attempts.delete(staleKey);
                }
            }
        }
        const entry = this.attempts.get(key);
        if (!entry || now > entry.resetAt) {
            this.attempts.set(key, { count: 1, resetAt: now + LoginThrottleGuard.windowMs });
            return true;
        }
        entry.count += 1;
        if (entry.count > LoginThrottleGuard.maxAttempts) {
            throw new HttpException("登录尝试过于频繁，请稍后再试", HttpStatus.TOO_MANY_REQUESTS);
        }
        return true;
    }
}

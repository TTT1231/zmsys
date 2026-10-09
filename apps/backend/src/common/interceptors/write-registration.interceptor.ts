/**
 * 写请求登记拦截器（db-scheme.md §10.4）：在全部 guard 通过后执行。
 * 非读请求（含公共登录、backup/run）原子检查「非维护态且请求代次仍相同」后登记计数；
 * 跨过一次维护激活的请求 503（重新请求时重新鉴权）。计数在 handler 完成/出错后释放
 * （finalize），HTTP 断线不提前释放——观察流由 handler 自身收尾。
 */
import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
    ServiceUnavailableException,
} from "@nestjs/common";
import { finalize } from "rxjs";
import { MAINTENANCE_GENERATION_KEY, MaintenanceState } from "../../domain/maintenance-state";

interface RequestLike {
    method?: string;
    [key: string]: unknown;
}

@Injectable()
export class WriteRegistrationInterceptor implements NestInterceptor {
    constructor(private readonly state: MaintenanceState) {}

    intercept(context: ExecutionContext, next: CallHandler) {
        const request = context.switchToHttp().getRequest<RequestLike>();
        const method = typeof request.method === "string" ? request.method.toUpperCase() : "";
        // GET/HEAD/OPTIONS 不产生写入，不登记（维护白名单在 guard 层放行）
        if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
            return next.handle();
        }
        const generation = request[MAINTENANCE_GENERATION_KEY];
        if (typeof generation !== "number" || !this.state.tryRegisterWrite(generation)) {
            throw new ServiceUnavailableException("系统恢复维护中，暂时无法处理请求，请稍后重试");
        }
        // 释放语义：finalize 覆盖 complete/error/unsubscribe。Nest + Fastify 管线中
        // HTTP 客户端断线不会取消 handler 的 observable（handler 继续执行至自身收尾，
        // 例：流式备份 await done 后才返回），因此这里不会因断线提前释放；unsubscribe
        // 分支仅覆盖上游运算符主动取消的防御场景
        return next.handle().pipe(finalize(() => this.state.releaseWrite()));
    }
}

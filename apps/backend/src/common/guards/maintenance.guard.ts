/**
 * 维护态守卫（db-scheme.md §10.4）：排在 JwtAuthGuard 之前。
 * 为每个请求记录当前维护代次（供写计数拦截器做跨激活判定）；
 * 维护激活期间仅放行只读白名单（GET），其余请求 503。
 */
import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
    isMaintenanceReadOnlyPath,
    MAINTENANCE_GENERATION_KEY,
    MaintenanceState,
} from "../../domain/maintenance-state";

interface RequestLike {
    method?: string;
    url?: string;
    [key: string]: unknown;
}

@Injectable()
export class MaintenanceGuard implements CanActivate {
    constructor(private readonly state: MaintenanceState) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<RequestLike>();
        const method = typeof request.method === "string" ? request.method : "";
        const url = typeof request.url === "string" ? request.url : "";
        request[MAINTENANCE_GENERATION_KEY] = this.state.generation();
        if (!this.state.isActive()) {
            return true;
        }
        if (isMaintenanceReadOnlyPath(method, url)) {
            return true;
        }
        throw new ServiceUnavailableException("系统恢复维护中，暂时无法处理请求，请稍后重试");
    }
}

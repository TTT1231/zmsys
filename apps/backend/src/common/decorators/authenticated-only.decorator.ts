import { SetMetadata } from "@nestjs/common";
import { AUTH_ONLY_KEY } from "../../constants";

/**
 * 声明“仅需登录、不校验权限码”。每个端点必须显式三选一：
 * @Public() / @AuthenticatedOnly() / @Permissions([...])，
 * 未声明任何访问策略的端点由 PermissionsGuard 默认拒绝（漏写装饰器 ≠ 越权放行），
 * 由 test/guard-coverage.spec.ts 架构测试强制。
 */
export const AuthenticatedOnly = () => SetMetadata(AUTH_ONLY_KEY, true);

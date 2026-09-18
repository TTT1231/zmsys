import type { RoleCode } from "../../constants";

/**
 * 挂载到 request.user 的会话用户，由 JwtStrategy.validate 产出。
 * 横切类型：业务 service 以 actor: AuthUser 接收当前用户。
 */
export interface AuthUser {
    id: string;
    account: string;
    name: string;
    role: RoleCode;
    isSuper: boolean;
    rowVersion: number;
    permissions: ReadonlySet<string>;
}

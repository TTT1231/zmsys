import type { RoleCode } from "../constants";

/** RoleGrant 为 auth 与 roles 共用的契约类型，已迁至 access-control 共享层 */
export type { RoleGrant } from "../access-control/types";

/** GET /roles 条目 */
export interface RoleDef {
    id: RoleCode;
    name: string;
    locked?: boolean;
}

export type GrantMap = Record<RoleCode, import("../access-control/types").RoleGrant>;

/** GET /roles/grants/log 条目 */
export interface GrantLogEntry {
    time: string;
    user: string;
    text: string;
}

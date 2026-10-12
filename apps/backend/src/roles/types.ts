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

/** GET /permissions/catalog 条目（sys_permission 行的契约投影；protected 为运行时状态） */
export interface PermissionCatalogEntry {
    code: string;
    kind: "MENU" | "ACTION";
    menuKey: string;
    actionId: string | null;
    label: string;
    protected: boolean;
}

/** GET /permissions/catalog/log 条目（与 GrantLogEntry 同展示形态，文案服务端拼装） */
export interface ProtectionLogEntry {
    time: string;
    user: string;
    text: string;
}

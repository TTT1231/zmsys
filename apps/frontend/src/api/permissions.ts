import type { RoleGrant, RoleId, GrantMap } from "@/data/permissions";
import type { GrantLogEntry, PermissionCatalogEntry, ProtectionLogEntry, SetPermissionProtectionInput } from "./types";
import { requestClient } from "@/http";

/** 全量角色授权（权限矩阵 / 角色编辑页聚合读取） */
export function fetchGrants(): Promise<GrantMap> {
    return requestClient.get<GrantMap>("/roles/grants");
}

/** 保存单角色授权；note 为前端 diffGrants 生成的人话变更说明，服务端记入授权日志 */
export function saveRoleGrants(
    roleId: RoleId,
    input: { grant: RoleGrant; expectedVersion: number; note: string },
): Promise<RoleGrant> {
    return requestClient.put<RoleGrant>(`/roles/${roleId}/grants`, input);
}

export function fetchGrantLog(): Promise<GrantLogEntry[]> {
    return requestClient.get<GrantLogEntry[]>("/roles/grants/log");
}

/** 权限目录（含各码运行时受保护状态），「受保护权限」管理与编辑器灰显用 */
export function fetchPermissionCatalog(): Promise<PermissionCatalogEntry[]> {
    return requestClient.get<PermissionCatalogEntry[]>("/permissions/catalog");
}

/** 解锁/加锁受保护权限（仅 super 角色；权限码含冒号，须 URL 编码）；reason 记入审计 */
export function setPermissionProtection(
    code: string,
    input: SetPermissionProtectionInput,
): Promise<PermissionCatalogEntry> {
    return requestClient.patch<PermissionCatalogEntry>(
        `/permissions/catalog/${encodeURIComponent(code)}/protected`,
        input,
    );
}

/** 保护开关审计日志（最新在前） */
export function fetchProtectionLog(): Promise<ProtectionLogEntry[]> {
    return requestClient.get<ProtectionLogEntry[]>("/permissions/catalog/log");
}

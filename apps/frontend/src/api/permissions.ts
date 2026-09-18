import type { RoleGrant, RoleId, GrantMap } from "@/data/permissions";
import type { GrantLogEntry, RoleDef } from "./types";
import { requestClient } from "@/http";

export function fetchRoles(): Promise<RoleDef[]> {
    return requestClient.get<RoleDef[]>("/roles");
}

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

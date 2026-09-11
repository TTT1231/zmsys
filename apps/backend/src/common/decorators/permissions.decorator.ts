import { SetMetadata } from '@nestjs/common';
import { PERMISSIONS_KEY, type PermissionCode } from '../../constants';

export interface PermissionsMetadata {
    codes: PermissionCode[];
    message: string;
}

/** 声明端点要求的权限码；super 直通，其余角色按 sys_grant 实时授权校验 */
export const Permissions = (codes: PermissionCode[], message = '无权执行该操作') =>
    SetMetadata(PERMISSIONS_KEY, {
        codes,
        message,
    } satisfies PermissionsMetadata);

import type { RoleCode } from '../constants';

/** /auth/profile 与 /roles/grants 的授权结构；actions 按 menuKey 分组 actionId */
export interface RoleGrant {
    version: number;
    menus: string[];
    actions: Record<string, string[]>;
}

/** 用户展示对象（openapi WbUser）；version 即 sys_user.row_version */
export interface WbUser {
    version: number;
    name: string;
    account: string;
    role: RoleCode;
    active: boolean;
    last: string;
}

/** Guard 元数据键：标记跳过 JWT 校验的公开端点 */
export const IS_PUBLIC_KEY = "isPublic";

/** Guard 元数据键：声明“仅需登录、不校验权限码”的端点（默认拒绝策略的显式放行） */
export const AUTH_ONLY_KEY = "authenticatedOnly";

/** Guard 元数据键：端点要求的权限码与 403 提示文案 */
export const PERMISSIONS_KEY = "requiredPermissions";

/** 固定五个内置角色，与 sys_role 播种顺序一致 */
export const ROLE_CODES = ["super", "admin", "warehouse", "sales", "staff"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

/** 可通过接口分配的角色（openapi CreateRoleId）：新增与改派均不得选 super */
export const CREATE_ROLE_CODES = ["admin", "warehouse", "sales", "staff"] as const;
export type CreateRoleCode = (typeof CREATE_ROLE_CODES)[number];

export const isRoleCode = (value: string): value is RoleCode => (ROLE_CODES as readonly string[]).includes(value);

/** super 为内置锁定角色，服务端固定视为全量权限，不依赖 sys_grant 行 */
export const SUPER_ROLE_CODE = "super" as const;

/** sales 为客户归属与离岗移交的业务主体（db-scheme.md §4.1） */
export const SALES_ROLE_CODE = "sales" as const;

/** 合法客户负责人角色：启用中的销售或超级管理员方可持有/接手客户 */
export const CUSTOMER_OWNER_ROLE_CODES = [SALES_ROLE_CODE, SUPER_ROLE_CODE] as const;

/** 角色是否具备客户负责人资格（负责人校验与移交的唯一判定口径） */
export const isEligibleCustomerOwner = (roleCode: string): boolean =>
    (CUSTOMER_OWNER_ROLE_CODES as readonly string[]).includes(roleCode);

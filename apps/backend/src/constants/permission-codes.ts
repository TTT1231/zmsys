/**
 * 权限码常量目录，与 sys_permission 播种数据一一对应。
 * 格式约定（db-scheme.md §3.3）：菜单码 `menu:<menuKey>`，动作码 `<menuKey>:<actionId>`。
 * 新增权限码必须先加进迁移播种，再在此登记。
 * 受保护 = 默认仅 super 持有；super 可经 PATCH /permissions/catalog/:code/protected
 * 运行时解锁后授予其他角色，重新加锁自动收回（db-scheme.md §3.3/§3.6）。
 */
export const PERMISSIONS = {
    // ---- 菜单 ----
    MENU_WORKBENCH: "menu:workbench",
    MENU_ORDERS: "menu:orders",
    MENU_CUSTOMERS: "menu:customers",
    MENU_BOM: "menu:bom",
    MENU_INBOUND: "menu:inbound",
    MENU_OUTBOUND: "menu:outbound",
    MENU_STOCK: "menu:stock",
    MENU_ARCHIVED_ORDERS: "menu:archived-orders",
    MENU_ANALYTICS: "menu:analytics", // 可授权菜单，默认仅超管（不播普通角色授权行）
    MENU_SYSTEM_LOGS: "menu:system-logs", // 可授权菜单，默认仅超管（不播普通角色授权行）
    // 受保护菜单（默认仅 super，超管可运行时解锁下放）
    MENU_PERMISSIONS: "menu:permissions",
    MENU_PERMISSIONS_ACCOUNTS: "menu:permissions-accounts",
    MENU_PERMISSIONS_ROLES: "menu:permissions-roles",
    MENU_PERMISSIONS_MATRIX: "menu:permissions-matrix",

    // ---- 订单 ----
    ORDERS_VIEW: "orders:view",
    ORDERS_CREATE: "orders:create",
    ORDERS_EDIT: "orders:edit",
    ORDERS_DELETE: "orders:delete", // 受保护
    ORDERS_ARCHIVE: "orders:archive", // 受保护
    ORDERS_UNARCHIVE: "orders:unarchive", // 受保护：归档回退（仅归档操作人本人可用）

    // ---- 客户 ----
    CUSTOMERS_VIEW: "customers:view",
    CUSTOMERS_CREATE: "customers:create",
    CUSTOMERS_EDIT: "customers:edit",
    CUSTOMERS_BULK_TRANSFER: "customers:bulk-transfer", // 受保护

    // ---- BOM ----
    BOM_VIEW: "bom:view",
    BOM_CREATE: "bom:create",
    BOM_DELETE: "bom:delete", // 受保护

    // ---- BOM 结构（受保护，仅 super）----
    MENU_BOM_STRUCTURE: "menu:bom-structure",
    BOM_STRUCTURE_VIEW: "bom-structure:view",
    BOM_STRUCTURE_MANAGE: "bom-structure:manage",

    // ---- 入库 ----
    INBOUND_VIEW: "inbound:view",
    INBOUND_REGISTER: "inbound:register",
    INBOUND_EDIT: "inbound:edit",
    INBOUND_DELETE: "inbound:delete", // 默认授仓管，超管可按需授予其他角色
    INBOUND_ADJUST: "inbound:adjust", // 受保护
    INBOUND_VOID_ANY_DAY: "inbound:void-any-day", // 受保护：跨天作废

    // ---- 出库 ----
    OUTBOUND_VIEW: "outbound:view",
    OUTBOUND_SHIP: "outbound:ship",
    OUTBOUND_VOID: "outbound:void",
    OUTBOUND_DELETE: "outbound:delete", // 默认授仓管，超管可按需授予其他角色

    // ---- 用户与权限（受保护，默认仅 super）----
    PERMISSIONS_VIEW: "permissions:view",
    PERMISSIONS_MANAGE: "permissions:manage",

    // ---- 系统（备份/恢复菜单码与执行动作均受保护，默认仅 super）----
    MENU_SYSTEM_BACKUP: "menu:system-backup",
    MENU_SYSTEM_RESTORE: "menu:system-restore",
    SYSTEM_BACKUP_RUN: "system-backup:run", // 受保护
    SYSTEM_RESTORE_RUN: "system-restore:run", // 受保护
    // ---- 系统日志（可授权动作，默认仅超管，不播普通角色授权行）----
    SYSTEM_LOGS_VIEW: "system-logs:view",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

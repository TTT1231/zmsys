/**
 * 权限码常量目录，与 sys_permission 播种数据一一对应。
 * 格式约定（db-scheme.md §3.3）：菜单码 `menu:<menuKey>`，动作码 `<menuKey>:<actionId>`。
 * 新增权限码必须先加进迁移播种，再在此登记。
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
    // 受保护菜单（仅 super）
    MENU_PERMISSIONS: "menu:permissions",
    MENU_PERMISSIONS_ACCOUNTS: "menu:permissions-accounts",
    MENU_PERMISSIONS_ROLES: "menu:permissions-roles",
    MENU_PERMISSIONS_MATRIX: "menu:permissions-matrix",

    // ---- 订单 ----
    ORDERS_VIEW: "orders:view",
    ORDERS_CREATE: "orders:create",
    ORDERS_EDIT: "orders:edit",
    ORDERS_CANCEL: "orders:cancel",
    ORDERS_DELETE: "orders:delete", // 受保护
    ORDERS_ARCHIVE: "orders:archive", // 受保护

    // ---- 客户 ----
    CUSTOMERS_VIEW: "customers:view",
    CUSTOMERS_CREATE: "customers:create",
    CUSTOMERS_EDIT: "customers:edit",
    CUSTOMERS_BULK_TRANSFER: "customers:bulk-transfer", // 受保护

    // ---- BOM ----
    BOM_VIEW: "bom:view",
    BOM_CREATE: "bom:create",
    BOM_DELETE: "bom:delete", // 受保护

    // ---- 入库 ----
    INBOUND_VIEW: "inbound:view",
    INBOUND_REGISTER: "inbound:register",
    INBOUND_EDIT: "inbound:edit",
    INBOUND_ADJUST: "inbound:adjust", // 受保护

    // ---- 出库 ----
    OUTBOUND_VIEW: "outbound:view",
    OUTBOUND_SHIP: "outbound:ship",
    OUTBOUND_VOID: "outbound:void",
    OUTBOUND_PRINT: "outbound:print",
    OUTBOUND_EMERGENCY_VOID: "outbound:emergency-void", // 受保护

    // ---- 用户与权限（受保护，仅 super）----
    PERMISSIONS_VIEW: "permissions:view",
    PERMISSIONS_MANAGE: "permissions:manage",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

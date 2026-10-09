/**
 * 备份分组目录（单一来源，db-scheme.md §10.1）：
 * - 每组声明 tables 与 dependsOn；完整备份 = 目录全集（动态计算，不硬编码清单）；
 * - 后端 run/restore 自行闭包展开；前端 BackupPage 的 applyLinkage 是本表的镜像；
 * - 运行态表 sys_permission / api_idempotency / sys_restore_job 永不入备份
 *   （sys_permission 是迁移播种的目录数据，后两者是运行态；replace 不清空 sys_restore_job）。
 *
 * 入库↔出库互为依赖（v_bom_stock 口径：出库冲销可回指入库/调整，入库调整可关联出库冲销）；
 * bom 依赖 sequences：nextBomCode 的 INSERT IGNORE 只初始化缺失行。
 */

export interface BackupGroupDef {
    key: string;
    label: string;
    tables: readonly string[];
    dependsOn: readonly string[];
}

export const BACKUP_GROUPS: readonly BackupGroupDef[] = [
    {
        key: "users",
        label: "用户与权限",
        tables: ["sys_role", "sys_user", "sys_grant", "sys_grant_log", "sys_user_change_log"],
        dependsOn: [],
    },
    {
        key: "sequences",
        label: "单号计数器",
        tables: ["biz_sequence"],
        dependsOn: [],
    },
    {
        key: "customers",
        label: "客户档案",
        tables: ["custom_table", "customer_owner_history"],
        dependsOn: ["users", "sequences"],
    },
    {
        key: "bom",
        label: "物料与BOM",
        tables: ["bom_category", "material_group", "material_item", "bom_table", "bom_item"],
        dependsOn: ["users", "sequences"],
    },
    {
        key: "orders",
        label: "销售订单",
        tables: ["sales_order_table", "sales_order_change_log"],
        dependsOn: ["customers", "bom", "users", "sequences"],
    },
    {
        key: "inbound",
        label: "成品入库",
        tables: ["inbound_ledger", "inbound_change_log", "stock_adjustment"],
        dependsOn: ["bom", "users", "sequences", "outbound"],
    },
    {
        key: "outbound",
        label: "成品出库",
        tables: ["outbound_shipment", "outbound_ledger", "outbound_state_log"],
        dependsOn: ["orders", "sequences", "inbound"],
    },
    {
        key: "system",
        label: "系统与日志",
        tables: ["op_log"],
        dependsOn: ["users"],
    },
] as const;

/** 运行态表：永不入备份（目录数据 + 幂等/恢复凭证） */
export const RUNTIME_TABLES: readonly string[] = ["sys_permission", "api_idempotency", "sys_restore_job"];

/** replace 模式执行前可清理的运行表（api_idempotency 是可重建的幂等占位） */
export const CLEANABLE_RUNTIME_TABLES: readonly string[] = ["api_idempotency"];

const GROUP_BY_KEY = new Map(BACKUP_GROUPS.map(group => [group.key, group]));

export const ALL_GROUP_KEYS: readonly string[] = BACKUP_GROUPS.map(group => group.key);

/** 未知分组名直接抛错（调用方转 400） */
export function expandGroupClosure(keys: readonly string[]): Set<string> {
    const closure = new Set<string>();
    const visit = (key: string): void => {
        if (closure.has(key)) return;
        const group = GROUP_BY_KEY.get(key);
        if (!group) {
            throw new Error(`未知备份分组：${key}`);
        }
        closure.add(key);
        for (const dep of group.dependsOn) {
            visit(dep);
        }
    };
    for (const key of keys) {
        visit(key);
    }
    return closure;
}

/** 分组闭包覆盖的全部表（去重）；顺序无关——输出顺序由 FK 拓扑决定 */
export function closureTables(keys: readonly string[]): Set<string> {
    const tables = new Set<string>();
    for (const key of expandGroupClosure(keys)) {
        for (const table of GROUP_BY_KEY.get(key)!.tables) {
            tables.add(table);
        }
    }
    return tables;
}

/** 全部目录表（完整备份 = 目录全集，动态计算） */
export function allCatalogTables(): Set<string> {
    return closureTables(ALL_GROUP_KEYS);
}

/** 完整备份判定：所选分组的闭包已覆盖目录全集 */
export function isFullBackupClosure(keys: readonly string[]): boolean {
    const closure = expandGroupClosure(keys);
    return ALL_GROUP_KEYS.every(key => closure.has(key));
}

/* 用户与权限 · 前端权限字典
 * - 菜单 / 操作字典（MENU_CATALOG / ACTION_CATALOG）随代码版本维护
 * - 角色 → 菜单 / 操作的授权关系是后端数据（sys_grant 表），经 /auth/profile 下发、
 *   /roles/:roleId/grants 编辑；本文件只保留字典与纯派生工具
 * - 权限码格式 `${menuKey}:${actionId}`，如 outbound:print
 */

export type RoleId = "super" | "admin" | "warehouse" | "sales" | "staff";

export interface MenuNode {
    key: string;
    label: string;
    icon: string;
    group: "工作台" | "业务导航" | "系统";
    to?: string;
    end?: boolean;
    /** 说明型入口（无路由），点击弹出说明 */
    note?: string;
    /** 角色别名的菜单名，如仓管的订单页叫「待发货订单」 */
    labelByRole?: Partial<Record<RoleId, string>>;
    /** 仅对特定角色展示的固定项（不参与授权勾选）；带 to 的仍可导航 */
    onlyFor?: RoleId[];
    /** 受保护菜单只能由超级管理员持有（服务端 protected=1 不播授权行），不参与授权勾选 */
    protected?: boolean;
    children?: Array<{ key: string; label: string }>;
}

export interface ActionDef {
    id: string;
    label: string;
    /** 受保护动作只能由超级管理员持有，不能授权给其他角色 */
    protected?: boolean;
}

/* 组定义：侧边栏一级导航（图标轨 / 水平菜单 / 树形分组的共用元数据）。
   工作台组用 chart：grid 已是子项「工作台」的图标，避免组/子项同图 */
export const NAV_GROUPS = [
    { group: "工作台", icon: "chart" },
    { group: "业务导航", icon: "briefcase" },
    { group: "系统", icon: "sliders" },
] as const;

export const MENU_CATALOG: MenuNode[] = [
    { key: "workbench", label: "工作台", icon: "grid", group: "工作台", to: "/workbench", end: true },
    {
        key: "archived-orders",
        label: "归档订单",
        icon: "archive",
        group: "工作台",
        to: "/archived-orders",
    },
    {
        key: "permissions",
        label: "用户与权限",
        icon: "shield",
        group: "工作台",
        to: "/permissions",
        protected: true,
        children: [
            { key: "permissions-accounts", label: "账号管理" },
            { key: "permissions-roles", label: "角色与权限" },
            { key: "permissions-matrix", label: "权限矩阵" },
        ],
    },
    {
        key: "orders",
        label: "销售订单",
        icon: "order",
        group: "业务导航",
        to: "/orders",
        labelByRole: { warehouse: "待发货订单" },
    },
    { key: "customers", label: "客户档案", icon: "contacts", group: "业务导航", to: "/customers" },
    { key: "bom", label: "物料与 BOM", icon: "bom", group: "业务导航", to: "/bom" },
    { key: "inbound", label: "成品入库", icon: "inbound", group: "业务导航", to: "/inbound" },
    { key: "outbound", label: "成品出库", icon: "outbound", group: "业务导航", to: "/outbound" },
    { key: "stock", label: "库存", icon: "stock", group: "业务导航", to: "/stock" },
    {
        key: "changelog",
        label: "变更记录",
        icon: "log",
        group: "业务导航",
        onlyFor: ["warehouse"],
        note: "审计记录：业务创建、订单变更、入库修正、库存调整、出库作废及负责人移交均保留操作人与时间，不可删除、不可篡改。",
    },
    /* 系统组：系统日志、数据库备份与恢复入口；备份/恢复仅超级管理员可见 */
    {
        key: "system-backup",
        label: "备份",
        icon: "database",
        group: "系统",
        to: "/system/backup",
        onlyFor: ["super"],
    },
    {
        key: "system-restore",
        label: "恢复",
        icon: "restore",
        group: "系统",
        to: "/system/restore",
        onlyFor: ["super"],
    },
    {
        key: "system-logs",
        label: "系统日志",
        icon: "log",
        group: "系统",
        to: "/system-logs",
        protected: true,
    },
];

/* 操作字典：id 同时用于后端接口授权和页面按钮；即使页面入口尚未上线，
 * 也必须先在这里固定权限码，避免后端出现无授权保护的写接口。 */
export const ACTION_CATALOG = {
    orders: [
        { id: "view", label: "查看" },
        { id: "create", label: "新建订单" },
        { id: "edit", label: "编辑订单" },
        { id: "archive", label: "归档订单", protected: true },
        { id: "delete", label: "删除订单", protected: true },
    ],
    customers: [
        { id: "view", label: "查看" },
        { id: "create", label: "新建客户" },
        { id: "edit", label: "编辑客户" },
        { id: "bulk-transfer", label: "批量移交负责人", protected: true },
    ],
    bom: [
        { id: "view", label: "查看" },
        { id: "create", label: "新建 BOM" },
        { id: "delete", label: "删除 BOM", protected: true },
    ],
    inbound: [
        { id: "view", label: "查看台账" },
        { id: "register", label: "检验入库" },
        { id: "edit", label: "当天修正/作废" },
        { id: "delete", label: "删除入库记录" },
        { id: "adjust", label: "跨日库存调整", protected: true },
        { id: "void-any-day", label: "跨天作废入库", protected: true },
    ],
    outbound: [
        { id: "view", label: "查看台账" },
        { id: "ship", label: "登记发货" },
        { id: "void", label: "作废" },
        { id: "print", label: "打印" },
        { id: "delete", label: "删除出库记录" },
    ],
    permissions: [
        { id: "view", label: "查看", protected: true },
        { id: "manage", label: "用户与角色管理", protected: true },
    ],
    /* 系统组动作（受保护，仅 super）：不参与普通角色的授权编辑，此处登记仅为
     * 固定权限码字面量与前端 can() 判断 */
    "system-backup": [{ id: "run", label: "执行备份", protected: true }],
    "system-restore": [{ id: "run", label: "执行恢复", protected: true }],
    "system-logs": [{ id: "view", label: "查看", protected: true }],
} as const satisfies Record<string, readonly ActionDef[]>;

/* 仅限特定角色的动作组（组级 onlyFor）：不出现在权限编辑器，也不进入
 * 普通角色的默认授权——受保护动作本就只有 super 能持有 */
export const ONLY_FOR_ACTION_GROUPS: ReadonlyMap<string, readonly RoleId[]> = new Map([
    ["system-backup", ["super"]],
    ["system-restore", ["super"]],
]);

/** 权限码字面量联合（"outbound:print" 等），拼错编译期报错 */
export type PermCode = {
    [M in keyof typeof ACTION_CATALOG]: `${M}:${(typeof ACTION_CATALOG)[M][number]["id"]}`;
}[keyof typeof ACTION_CATALOG];

/** 字符串 key 的安全索引（动态菜单 key 查操作目录） */
export function actionsOf(menu: string): readonly ActionDef[] | undefined {
    return (ACTION_CATALOG as Record<string, readonly ActionDef[]>)[menu];
}

export const ROLES: Array<{ id: RoleId; name: string; locked?: boolean }> = [
    { id: "super", name: "超级管理员", locked: true },
    { id: "admin", name: "管理员" },
    { id: "warehouse", name: "仓管" },
    { id: "sales", name: "销售" },
    { id: "staff", name: "员工" },
];

export const ROLE_IDS = ROLES.map(role => role.id);

export interface RoleGrant {
    /** 后端整组授权的乐观锁版本 */
    version: number;
    menus: string[];
    actions: Record<string, string[]>;
}

export type GrantMap = Record<RoleId, RoleGrant>;

const allActions = (menu: keyof typeof ACTION_CATALOG) => ACTION_CATALOG[menu].map(action => action.id);

/* 默认授权 = AGENTS.md 权限矩阵 */
export function buildDefaultGrants(): GrantMap {
    return {
        super: {
            version: 1,
            // 说明型 onlyFor 项（无路由）不占权限码；系统组备份/恢复菜单 super 实际持有
            menus: MENU_CATALOG.flatMap(menu =>
                menu.onlyFor && !menu.to ? [] : [menu.key, ...(menu.children ?? []).map(child => child.key)],
            ),
            actions: Object.fromEntries(
                (Object.keys(ACTION_CATALOG) as Array<keyof typeof ACTION_CATALOG>).map(menu => [
                    menu,
                    allActions(menu),
                ]),
            ),
        },
        admin: {
            version: 1,
            menus: ["workbench", "orders", "archived-orders", "customers", "bom", "inbound", "outbound", "stock"],
            actions: {
                // 删除订单/删除 BOM 为受保护动作（仅超级管理员），普通角色不随 allActions 下发
                orders: ["view", "create", "edit"],
                customers: ["view", "create", "edit"],
                bom: ["view", "create"],
                inbound: ["view"],
                outbound: ["view", "print"],
            },
        },
        warehouse: {
            version: 1,
            menus: ["workbench", "orders", "archived-orders", "bom", "inbound", "outbound", "stock"],
            actions: {
                orders: ["view"],
                bom: ["view"],
                // 删除已作废记录：默认授予仓管（非受保护，超管可按需授予其他角色）
                inbound: ["view", "register", "edit", "delete"],
                outbound: ["view", "ship", "void", "delete"],
            },
        },
        sales: {
            version: 1,
            menus: ["workbench", "orders", "archived-orders", "customers", "bom", "inbound", "outbound", "stock"],
            actions: {
                orders: ["view", "create", "edit"],
                customers: ["view", "create", "edit"],
                bom: ["view", "create"],
                inbound: ["view"],
                outbound: ["view"],
            },
        },
        staff: {
            version: 1,
            menus: ["workbench", "orders", "archived-orders", "bom", "inbound", "outbound", "stock"],
            actions: {
                orders: ["view"],
                bom: ["view"],
                inbound: ["view"],
                outbound: ["view"],
            },
        },
    };
}

export const DEFAULT_GRANTS = buildDefaultGrants();

/* ---------- 派生工具 ---------- */

/** 权限码判断：can(grant, "outbound:print") */
export function can(grant: RoleGrant | undefined, perm: PermCode): boolean {
    if (!grant) return false;
    const [menu, action] = perm.split(":");
    return (grant.actions[menu] ?? []).includes(action);
}

export function menuVisible(grant: RoleGrant, key: string): boolean {
    return grant.menus.includes(key);
}

export function menuLabelFor(menu: MenuNode, role: RoleId): string {
    return menu.labelByRole?.[role] ?? menu.label;
}

const ACTION_SHORT: Record<string, string> = {
    create: "新建",
    edit: "编辑",
    archive: "归档",
    delete: "删除",
    "bulk-transfer": "移交",
    register: "入库",
    adjust: "调整",
    ship: "发货",
    void: "作废",
    "void-any-day": "跨天作废",
    print: "打印",
    manage: "管理",
};

/** 侧边栏 / 预览用的权限摘要标签 */
export function menuTagFor(menuKey: string, grant: RoleGrant): string {
    if (menuKey === "workbench") return "专属视图";
    // 系统组动作全部受保护（无 view 基线），不适用「只读/全部权限」口径
    if (ONLY_FOR_ACTION_GROUPS.has(menuKey)) return "超管专属";
    const actions = actionsOf(menuKey);
    if (!actions) return "";
    const chosen = grant.actions[menuKey] ?? [];
    if (!chosen.length) return "";
    const nonView = actions.filter(action => action.id !== "view" && chosen.includes(action.id));
    if (!nonView.length) return "只读";
    if (nonView.length === actions.length - 1) return "全部权限";
    const names = nonView.map(action => ACTION_SHORT[action.id] ?? action.label).join(" / ");
    return names.length > 7 ? `查看+${names.slice(0, 6)}…` : `查看+${names}`;
}

export interface NavItem {
    label: string;
    icon: string;
    to?: string;
    end?: boolean;
    tag?: string;
    note?: string;
}

export interface NavSection {
    group: string;
    /** 组图标（图标轨 / 水平菜单用，取自 NAV_GROUPS） */
    icon: string;
    items: NavItem[];
}

/** 按角色 + 授权生成侧边栏二级导航（一级分组 + 二级页面，含仓管固定说明项「变更记录」
 * 与 super 专属的系统组可导航入口） */
export function buildNavSections(role: RoleId, grant: RoleGrant): NavSection[] {
    const sections: NavSection[] = [];
    for (const { group, icon } of NAV_GROUPS) {
        const items: NavItem[] = [];
        for (const menu of MENU_CATALOG) {
            if (menu.group !== group) continue;
            if (menu.onlyFor) {
                if (menu.onlyFor.includes(role)) {
                    if (menu.to) {
                        // 带路由的 onlyFor 项（系统组备份/恢复）：super 可导航
                        items.push({
                            label: menu.label,
                            icon: menu.icon,
                            to: menu.to,
                            end: menu.end,
                            tag: menuTagFor(menu.key, grant),
                        });
                    } else {
                        items.push({ label: menu.label, icon: menu.icon, note: menu.note, tag: "说明" });
                    }
                }
                continue;
            }
            if (!menuVisible(grant, menu.key)) continue;
            items.push({
                label: menuLabelFor(menu, role),
                icon: menu.icon,
                to: menu.key === "workbench" ? "/workbench" : menu.to,
                end: menu.key === "workbench" ? true : menu.end,
                tag: menuTagFor(menu.key, grant),
            });
        }
        if (items.length) sections.push({ group, icon, items });
    }
    return sections;
}

/** 由当前路由反算激活的分组（图标轨高亮 / 双列子面板内容的单一真源） */
export function findActiveGroup(sections: NavSection[], pathname: string): NavSection | undefined {
    return sections.find(section => section.items.some(item => item.to && pathname.startsWith(item.to)));
}

/** 授权对比（before → after），用于变更日志明细 */
export function diffGrants(before: RoleGrant, after: RoleGrant): string {
    const labelOf = (key: string) => {
        const menu = MENU_CATALOG.find(item => item.key === key);
        if (menu) return menu.label;
        for (const parent of MENU_CATALOG) {
            const child = (parent.children ?? []).find(item => item.key === key);
            if (child) return `${parent.label} · ${child.label}`;
        }
        return key;
    };
    const add: string[] = [];
    const del: string[] = [];
    const menuAdded = after.menus.filter(key => !before.menus.includes(key)).map(labelOf);
    const menuDel = before.menus.filter(key => !after.menus.includes(key)).map(labelOf);
    if (menuAdded.length) add.push(`菜单【${menuAdded.join("、")}】`);
    if (menuDel.length) del.push(`菜单【${menuDel.join("、")}】`);
    for (const menu of Object.keys(ACTION_CATALOG)) {
        const catalog = actionsOf(menu) ?? [];
        const nameOf = (id: string) => catalog.find(action => action.id === id)?.label ?? id;
        const beforeActions = before.actions[menu] ?? [];
        const afterActions = after.actions[menu] ?? [];
        const aAdd = afterActions.filter(id => !beforeActions.includes(id)).map(nameOf);
        const aDel = beforeActions.filter(id => !afterActions.includes(id)).map(nameOf);
        if (aAdd.length) add.push(`${labelOf(menu)}：${aAdd.join("、")}`);
        if (aDel.length) del.push(`${labelOf(menu)}：${aDel.join("、")}`);
    }
    const parts: string[] = [];
    if (add.length) parts.push(`新增 ${add.join("；")}`);
    if (del.length) parts.push(`移除 ${del.join("；")}`);
    return parts.join("，");
}

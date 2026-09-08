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
    group: "业务导航" | "系统设置";
    to?: string;
    end?: boolean;
    /** 说明型入口（无路由），点击弹出说明 */
    note?: string;
    /** 角色别名的菜单名，如仓管的订单页叫「待发货订单」 */
    labelByRole?: Partial<Record<RoleId, string>>;
    /** 仅对特定角色展示的固定项（不参与授权勾选） */
    onlyFor?: RoleId[];
    children?: Array<{ key: string; label: string }>;
}

export interface ActionDef {
    id: string;
    label: string;
}

export const MENU_CATALOG: MenuNode[] = [
    { key: "workbench", label: "工作台", icon: "grid", group: "业务导航", to: "/workbench", end: true },
    {
        key: "orders",
        label: "销售订单",
        icon: "order",
        group: "业务导航",
        to: "/orders",
        labelByRole: { warehouse: "待发货订单" },
    },
    { key: "customers", label: "客户档案", icon: "users", group: "业务导航", to: "/customers" },
    { key: "bom", label: "物料与 BOM", icon: "layers", group: "业务导航", to: "/bom" },
    { key: "inbound", label: "成品入库", icon: "inbound", group: "业务导航", to: "/inbound" },
    { key: "outbound", label: "成品出库", icon: "truck", group: "业务导航", to: "/outbound" },
    {
        key: "permissions",
        label: "用户与权限",
        icon: "shield",
        group: "系统设置",
        to: "/permissions",
        children: [
            { key: "permissions-accounts", label: "账号管理" },
            { key: "permissions-roles", label: "角色与权限" },
            { key: "permissions-matrix", label: "权限矩阵" },
        ],
    },
    {
        key: "changelog",
        label: "变更记录",
        icon: "log",
        group: "业务导航",
        onlyFor: ["warehouse"],
        note: "变更记录：保留操作人、时间与业务对象的完整审计链，记录不可删除、不可篡改；数量更正需填写修改原因。",
    },
];

/* 操作字典：id 与页面按钮一一对应；更正记录（inbound/outbound 的 edit）等
 * UI 落地前不入字典，避免矩阵展示不存在的能力 */
export const ACTION_CATALOG = {
    orders: [
        { id: "view", label: "查看" },
        { id: "create", label: "新建订单" },
        { id: "edit", label: "编辑订单" },
    ],
    customers: [
        { id: "view", label: "查看" },
        { id: "create", label: "新建客户" },
    ],
    bom: [
        { id: "view", label: "查看" },
        { id: "create", label: "新建 BOM" },
    ],
    inbound: [
        { id: "view", label: "查看台账" },
        { id: "register", label: "检验入库" },
    ],
    outbound: [
        { id: "view", label: "查看台账" },
        { id: "ship", label: "登记发货" },
        { id: "print", label: "打印出库单" },
    ],
    permissions: [
        { id: "view", label: "查看" },
        { id: "manage", label: "用户与角色管理" },
    ],
} as const satisfies Record<string, readonly ActionDef[]>;

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
    menus: string[];
    actions: Record<string, string[]>;
}

export type GrantMap = Record<RoleId, RoleGrant>;

const allActions = (menu: keyof typeof ACTION_CATALOG) => ACTION_CATALOG[menu].map(action => action.id);

/* 默认授权 = AGENTS.md 权限矩阵 */
export function buildDefaultGrants(): GrantMap {
    return {
        super: {
            menus: MENU_CATALOG.flatMap(menu =>
                menu.onlyFor ? [] : [menu.key, ...(menu.children ?? []).map(child => child.key)],
            ),
            actions: Object.fromEntries(
                (Object.keys(ACTION_CATALOG) as Array<keyof typeof ACTION_CATALOG>).map(menu => [
                    menu,
                    allActions(menu),
                ]),
            ),
        },
        admin: {
            menus: ["workbench", "orders", "customers", "bom", "inbound", "outbound"],
            actions: {
                orders: allActions("orders"),
                customers: allActions("customers"),
                bom: allActions("bom"),
                inbound: ["view"],
                outbound: ["view", "print"],
            },
        },
        warehouse: {
            menus: ["workbench", "orders", "bom", "inbound", "outbound"],
            actions: {
                orders: ["view"],
                bom: ["view"],
                inbound: ["view", "register"],
                outbound: ["view", "ship"],
            },
        },
        sales: {
            menus: ["workbench", "orders", "customers", "bom", "inbound", "outbound"],
            actions: {
                orders: allActions("orders"),
                customers: allActions("customers"),
                bom: allActions("bom"),
                inbound: ["view"],
                outbound: ["view"],
            },
        },
        staff: {
            menus: ["workbench", "orders", "bom", "inbound", "outbound"],
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
    register: "入库",
    ship: "发货",
    print: "打印",
    manage: "管理",
};

/** 侧边栏 / 预览用的权限摘要标签 */
export function menuTagFor(menuKey: string, grant: RoleGrant): string {
    if (menuKey === "workbench") return "专属视图";
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
    items: NavItem[];
}

/** 按角色 + 授权生成侧边栏导航（含仓管固定说明项「变更记录」） */
export function buildNavSections(role: RoleId, grant: RoleGrant): NavSection[] {
    const sections: NavSection[] = [];
    for (const group of ["业务导航", "系统设置"] as const) {
        const items: NavItem[] = [];
        for (const menu of MENU_CATALOG) {
            if (menu.group !== group) continue;
            if (menu.onlyFor) {
                if (menu.onlyFor.includes(role)) {
                    items.push({ label: menu.label, icon: menu.icon, note: menu.note, tag: "说明" });
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
        if (items.length) sections.push({ group, items });
    }
    return sections;
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

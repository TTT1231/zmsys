import { useState } from "react";
import { Navigate } from "react-router";
import { ListState, RecordCard } from "@/components/ui/MobileList";
import { Badge, Button, TableLink } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { PageHeading } from "@/components/ui/PageHeading";
import { SelectField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/lib/icons";
import { useApp } from "@/context/AppContext";
import {
    useCreateUser,
    useGrantLog,
    useGrants,
    useSaveGrants,
    useSetUserActive,
    useUpdateUser,
    useWbSnapshot,
} from "@/data/queries";
import { EMPTY_SNAPSHOT } from "@/data/views";
import type { WbUser } from "@/api";
import {
    ACTION_CATALOG,
    DEFAULT_GRANTS,
    MENU_CATALOG,
    ROLES,
    actionsOf,
    diffGrants,
    type RoleGrant,
    type RoleId,
} from "@/data/permissions";
import { num } from "@/lib/format";

type PermTab = "accounts" | "roles" | "matrix";

const TABS: Array<{ key: PermTab; label: string }> = [
    { key: "accounts", label: "账号管理" },
    { key: "roles", label: "角色与权限" },
    { key: "matrix", label: "权限矩阵" },
];

const roleNameOf = (id: RoleId) => ROLES.find(role => role.id === id)?.name ?? id;
const clone = (value: RoleGrant): RoleGrant => JSON.parse(JSON.stringify(value));
const topMenuCount = (grant: RoleGrant) =>
    MENU_CATALOG.filter(menu => !menu.onlyFor && grant.menus.includes(menu.key)).length;

const EVENT_TONE: Record<string, string> = { danger: "danger", warning: "pending", info: "ready", neutral: "progress" };
const EVENT_STATE_TONE: Record<string, string> = { 待核对: "pending", 已拦截: "danger", 已生效: "success" };

export function PermissionsPage() {
    const { can } = useApp();
    const { data, isLoading } = useWbSnapshot();
    const snap = data ?? EMPTY_SNAPSHOT;
    const [tab, setTab] = useState<PermTab>("accounts");

    if (!can("permissions:view")) return <Navigate to="/workbench" replace />;

    const users = snap.users;
    const events = snap.systemEvents;
    const roleCount = new Set(users.map(user => user.role)).size;

    return (
        <div className="flex flex-col gap-5">
            <PageHeading eyebrow="系统设置" title="用户与权限" description="维护账号与角色，配置菜单与操作权限。" />

            <div className="grid grid-cols-3 gap-2.5">
                {[
                    { label: "用户总数", value: users.length, unit: "人" },
                    { label: "角色数量", value: roleCount, unit: "个" },
                    { label: "待处理系统事件", value: events.filter(event => event.open).length, unit: "条" },
                ].map(kpi => (
                    <div
                        key={kpi.label}
                        className="relative flex min-h-18.5 flex-col justify-center overflow-hidden rounded-card border border-line/70 bg-white/90 px-4 py-3 shadow-xs"
                    >
                        <span className="absolute top-0 bottom-0 left-0 w-0.75 bg-[#c7d2fe]" />
                        <span className="text-[11.5px] text-muted">
                            {kpi.label}{" "}
                            <strong className="tnum ml-1 text-[20px] font-bold text-ink">{num(kpi.value)}</strong>
                            <span className="ml-1 text-[11.5px] text-subtle">{kpi.unit}</span>
                        </span>
                    </div>
                ))}
            </div>

            <div className="task-tabs" role="tablist" aria-label="权限管理视图">
                {TABS.map(item => (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-pressed={tab === item.key}
                        onClick={() => setTab(item.key)}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {tab === "accounts" && <AccountsTab users={users} isLoading={isLoading} />}
            {tab === "roles" && <RolesTab users={users} />}
            {tab === "matrix" && <MatrixTab />}

            <SystemEventsPanel events={events} isLoading={isLoading} />
            <GrantLogPanel />
        </div>
    );
}

/* ================= Tab 1 · 账号管理 ================= */

function AccountsTab({ users, isLoading }: { users: WbUser[]; isLoading: boolean }) {
    const [editing, setEditing] = useState<WbUser | "new" | null>(null);
    const toast = useToast();
    const resetPwd = (user: WbUser) => toast(`已重置【${user.name}】的密码并通知本人（演示）`);

    return (
        <>
            <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
                <div className="flex items-center justify-between gap-3 border-b border-line bg-gradient-to-b from-white to-[#fcfcfd] px-5 py-4">
                    <h2 className="text-[15px] font-semibold text-ink">用户列表</h2>
                    <Button variant="secondary" icon="plus" onClick={() => setEditing("new")}>
                        新增用户
                    </Button>
                </div>
                <div className="mobile-records">
                    <ListState loading={isLoading} empty={!users.length}>
                        {users.map(user => (
                            <RecordCard
                                key={user.id}
                                title={user.name}
                                subtitle={`${user.account} · ${roleNameOf(user.role)}`}
                                badge={
                                    <Badge tone={user.active ? "success" : "progress"}>
                                        {user.active ? "启用" : "已停用"}
                                    </Badge>
                                }
                                actions={
                                    user.role === "super" ? undefined : (
                                        <>
                                            <Button variant="secondary" onClick={() => setEditing(user)}>
                                                编辑
                                            </Button>
                                            <Button variant="secondary" onClick={() => resetPwd(user)}>
                                                重置密码
                                            </Button>
                                            <UserActiveToggle user={user} />
                                        </>
                                    )
                                }
                            >
                                <p>最近登录 {user.last}</p>
                            </RecordCard>
                        ))}
                    </ListState>
                </div>
                <div className="hidden overflow-x-auto lg:block">
                    <table className="w-full min-w-180 border-collapse">
                        <thead>
                            <tr className="bg-[#f8fafc] text-left text-[12px] text-muted">
                                <th className="px-5 py-2.5 font-semibold">用户</th>
                                <th className="px-3 py-2.5 font-semibold">角色</th>
                                <th className="px-3 py-2.5 font-semibold">账号</th>
                                <th className="px-3 py-2.5 font-semibold">状态</th>
                                <th className="px-3 py-2.5 font-semibold">最近登录</th>
                                <th className="px-5 py-2.5 text-right font-semibold">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id} className="border-t border-line/70 transition hover:bg-row-hover">
                                    <td className="px-5 py-3">
                                        <div className="flex items-center gap-2.5">
                                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary-strong">
                                                {user.name.slice(0, 1)}
                                            </span>
                                            <span className="text-[13px] font-semibold text-ink">{user.name}</span>
                                        </div>
                                    </td>
                                    <td className="px-3 py-3">
                                        <Badge tone="ready">{roleNameOf(user.role)}</Badge>
                                    </td>
                                    <td className="px-3 py-3 tnum text-[13px] text-muted">{user.account}</td>
                                    <td className="px-3 py-3">
                                        <UserActiveToggle user={user} asSwitch />
                                    </td>
                                    <td className="px-3 py-3 tnum text-[13px] text-muted">{user.last}</td>
                                    <td className="px-5 py-3 text-right whitespace-nowrap">
                                        {user.role === "super" ? (
                                            <span className="text-[12.5px] text-subtle">内置账号</span>
                                        ) : (
                                            <>
                                                <TableLink onClick={() => setEditing(user)}>编辑</TableLink>
                                                <span className="mx-2 text-line-strong">·</span>
                                                <TableLink onClick={() => resetPwd(user)}>重置密码</TableLink>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
            {editing !== null && (
                <UserDialog user={editing === "new" ? null : editing} users={users} onClose={() => setEditing(null)} />
            )}
        </>
    );
}

/* 启用 / 停用：桌面表格内是开关，移动卡片内是按钮 */
function UserActiveToggle({ user, asSwitch }: { user: WbUser; asSwitch?: boolean }) {
    const setActive = useSetUserActive();
    if (user.role === "super") {
        return <Badge tone="success">启用</Badge>;
    }
    const toggle = () => setActive.mutate({ account: user.account, active: !user.active });
    if (asSwitch) {
        return (
            <button
                type="button"
                role="switch"
                aria-checked={user.active}
                aria-label={`${user.active ? "停用" : "启用"} ${user.name}`}
                onClick={toggle}
                className={`relative h-5 w-9 rounded-full transition ${user.active ? "bg-success" : "bg-line-strong"}`}
            >
                <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition ${user.active ? "translate-x-4" : ""}`}
                />
            </button>
        );
    }
    return (
        <Button variant="secondary" onClick={toggle}>
            {user.active ? "停用" : "启用"}
        </Button>
    );
}

function UserDialog({ user, users, onClose }: { user: WbUser | null; users: WbUser[]; onClose: () => void }) {
    const createUser = useCreateUser();
    const updateUser = useUpdateUser();
    const pending = createUser.isPending || updateUser.isPending;
    const [name, setName] = useState(user?.name ?? "");
    const [account, setAccount] = useState(user?.account ?? "");
    const [role, setRole] = useState<RoleId>(user?.role ?? "staff");
    const [errors, setErrors] = useState<{ name?: string; account?: string }>({});

    const submit = () => {
        const next: typeof errors = {};
        if (!name.trim()) next.name = "请填写姓名";
        const accountOk = /^[A-Za-z0-9_]{3,}$/.test(account.trim());
        if (!accountOk) next.account = "账号需为字母 / 数字 / 下划线";
        else if (users.some(item => item.account === account.trim() && item.account !== user?.account))
            next.account = "账号已存在";
        setErrors(next);
        if (Object.keys(next).length) return;
        const onSuccess = () => onClose();
        if (user) {
            // account 创建后不可改，仅更新姓名与角色
            updateUser.mutate({ account: user.account, name: name.trim(), role }, { onSuccess });
        } else {
            createUser.mutate({ name: name.trim(), account: account.trim(), role }, { onSuccess });
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            label="系统设置"
            title={user ? "编辑用户" : "新增用户"}
            width={440}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>
                        取消
                    </Button>
                    <Button onClick={submit} disabled={pending}>
                        保存
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <TextField
                    label="姓名"
                    required
                    value={name}
                    error={errors.name}
                    autoComplete="off"
                    onChange={event => setName(event.target.value)}
                />
                <TextField
                    label="登录账号"
                    required
                    value={account}
                    error={errors.account}
                    autoComplete="off"
                    placeholder="例：li_xiaomei"
                    disabled={!!user}
                    onChange={event => setAccount(event.target.value)}
                />
                <SelectField
                    label="所属角色"
                    required
                    value={role}
                    disabled={user?.role === "super"}
                    onChange={event => setRole(event.target.value as RoleId)}
                >
                    {ROLES.map(item => (
                        <option key={item.id} value={item.id}>
                            {item.name}
                        </option>
                    ))}
                </SelectField>
                {!user && <p className="text-[12px] text-subtle">初始密码由系统生成，首次登录需修改。</p>}
            </div>
        </Modal>
    );
}

/* ================= Tab 2 · 角色与权限 ================= */

function RolesTab({ users }: { users: WbUser[] }) {
    const { refreshProfile } = useApp();
    const { data: grantsData, isLoading: grantsLoading } = useGrants();
    const saveGrants = useSaveGrants();
    const grants = grantsData ?? DEFAULT_GRANTS;
    const [activeRole, setActiveRole] = useState<RoleId>("admin");
    const [draft, setDraft] = useState<RoleGrant | null>(null);
    const locked = ROLES.find(role => role.id === activeRole)?.locked ?? false;
    const effective = draft ?? grants[activeRole] ?? { menus: [], actions: {} };

    const selectRole = (id: RoleId) => {
        if (id === activeRole) return;
        if (draft && !window.confirm("当前角色有未保存的授权修改，切换后将丢弃。确认切换？")) return;
        setActiveRole(id);
        setDraft(null);
    };

    const edit = (mutate: (grant: RoleGrant) => void) => {
        setDraft(prev => {
            const grant = prev ? clone(prev) : clone(grants[activeRole]);
            mutate(grant);
            return grant;
        });
    };

    const toggleMenu = (key: string, checked: boolean) =>
        edit(grant => {
            const menu = MENU_CATALOG.find(item => item.key === key);
            const keys = menu?.children ? [key, ...menu.children.map(child => child.key)] : [key];
            keys.forEach(item => {
                grant.menus = checked
                    ? Array.from(new Set([...grant.menus, item]))
                    : grant.menus.filter(menuKey => menuKey !== item);
            });
            if (actionsOf(key)) {
                if (checked) {
                    if (!(grant.actions[key] ?? []).length) grant.actions[key] = ["view"];
                } else {
                    grant.actions[key] = [];
                }
            } else {
                // 子菜单勾选 → 父菜单可见
                const parent = MENU_CATALOG.find(item => (item.children ?? []).some(child => child.key === key));
                if (parent && checked && !grant.menus.includes(parent.key)) grant.menus.push(parent.key);
            }
        });

    const toggleAction = (menuKey: string, actionId: string, checked: boolean) =>
        edit(grant => {
            const current = grant.actions[menuKey] ?? [];
            grant.actions[menuKey] = checked ? [...current, actionId] : current.filter(id => id !== actionId);
            if (checked) {
                if (!grant.menus.includes(menuKey)) grant.menus.push(menuKey);
                const parent = MENU_CATALOG.find(item => (item.children ?? []).some(child => child.key === menuKey));
                if (parent && !grant.menus.includes(parent.key)) grant.menus.push(parent.key);
            }
        });

    const toggleAll = (checked: boolean) =>
        edit(grant => {
            grant.menus = checked
                ? MENU_CATALOG.flatMap(menu =>
                      menu.onlyFor ? [] : [menu.key, ...(menu.children ?? []).map(child => child.key)],
                  )
                : [];
            grant.actions = Object.fromEntries(
                Object.keys(ACTION_CATALOG).map(menu => [
                    menu,
                    checked ? (actionsOf(menu) ?? []).map(action => action.id) : [],
                ]),
            );
        });

    const save = () => {
        if (locked || !draft) return;
        const before = grants[activeRole];
        const diff = diffGrants(before, draft);
        saveGrants.mutate(
            {
                roleId: activeRole,
                grant: clone(draft),
                note: `角色【${roleNameOf(activeRole)}】授权变更：${diff || "无变化"}`,
            },
            {
                onSuccess: () => {
                    setDraft(null);
                    // 若改的是当前登录用户的角色，刷新自身权限（菜单/按钮立即生效）
                    void refreshProfile();
                },
            },
        );
    };

    const reset = () => {
        setDraft(clone(DEFAULT_GRANTS[activeRole]));
    };

    const status = locked
        ? "内置角色 · 授权固定"
        : grantsLoading
          ? "加载中…"
          : draft
            ? "编辑中（未保存）"
            : "已保存生效";

    return (
        <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="flex flex-col gap-5">
                <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
                    <div className="border-b border-line bg-gradient-to-b from-white to-[#fcfcfd] px-5 py-4">
                        <h2 className="text-[15px] font-semibold text-ink">角色</h2>
                    </div>
                    <div className="flex flex-col gap-2 p-3">
                        {ROLES.map(role => {
                            const grant = grants[role.id];
                            return (
                                <button
                                    key={role.id}
                                    type="button"
                                    onClick={() => selectRole(role.id)}
                                    className={`rounded-[12px] border px-3.5 py-3 text-left transition ${
                                        role.id === activeRole
                                            ? "border-primary bg-primary-soft shadow-[0_0_0_1px_var(--color-primary)]"
                                            : "border-line bg-white hover:border-primary-border hover:bg-row-hover"
                                    }`}
                                >
                                    <span className="flex items-center gap-2">
                                        <span className="text-[13.5px] font-semibold text-ink">{role.name}</span>
                                        {role.locked && (
                                            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-line bg-[#f8fafc] px-2 py-px text-[10.5px] text-muted">
                                                <Icon name="shield" size={11} />
                                                内置
                                            </span>
                                        )}
                                    </span>
                                    <span className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-subtle">
                                        <Icon name="users" size={12} />
                                        成员 {users.filter(user => user.role === role.id).length} 人 · 菜单{" "}
                                        {topMenuCount(grant)} 项
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </section>
            </div>

            <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-gradient-to-b from-white to-[#fcfcfd] px-5 py-4">
                    <div className="flex items-baseline gap-2.5">
                        <h2 className="text-[15px] font-semibold text-ink">{roleNameOf(activeRole)}</h2>
                        <span className={`text-[12px] ${draft ? "text-warning" : "text-muted"}`}>{status}</span>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="secondary"
                            className="min-h-8.5 px-3 text-[12.5px]"
                            disabled={locked}
                            onClick={reset}
                        >
                            恢复默认
                        </Button>
                        <Button className="min-h-8.5 px-3 text-[12.5px]" disabled={locked || !draft} onClick={save}>
                            保存授权
                        </Button>
                    </div>
                </div>

                <div className="flex flex-col gap-6 p-5">
                    <div>
                        <div className="mb-2 flex items-center justify-between">
                            <h3 className="text-[13px] font-semibold text-ink">菜单权限</h3>
                            <label
                                className={`flex items-center gap-1.5 text-[12px] font-medium text-primary ${locked ? "pointer-events-none opacity-50" : ""}`}
                            >
                                <input
                                    type="checkbox"
                                    className="accent-primary"
                                    checked={MENU_CATALOG.every(
                                        menu => menu.onlyFor || effective.menus.includes(menu.key),
                                    )}
                                    onChange={event => toggleAll(event.target.checked)}
                                />
                                全选
                            </label>
                        </div>
                        <div className="rounded-[12px] border border-line bg-[#fdfdff] px-3 py-2">
                            {MENU_CATALOG.filter(menu => !menu.onlyFor).map(menu => (
                                <div key={menu.key}>
                                    <label
                                        className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 hover:bg-row-hover ${locked ? "pointer-events-none opacity-50" : ""}`}
                                    >
                                        <input
                                            type="checkbox"
                                            className="accent-primary"
                                            checked={effective.menus.includes(menu.key)}
                                            onChange={event => toggleMenu(menu.key, event.target.checked)}
                                        />
                                        <Icon name={menu.icon} size={17} className="shrink-0 text-muted" />
                                        <span className="text-[13.5px] text-ink">{menu.label}</span>
                                    </label>
                                    {menu.children && (
                                        <div className="ml-6.5 border-l border-dashed border-line pl-1.5">
                                            {menu.children.map(child => (
                                                <label
                                                    key={child.key}
                                                    className={`flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2 hover:bg-row-hover ${locked ? "pointer-events-none opacity-50" : ""}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="accent-primary"
                                                        checked={effective.menus.includes(child.key)}
                                                        onChange={event => toggleMenu(child.key, event.target.checked)}
                                                    />
                                                    <span className="text-[12.5px] text-td">└ {child.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h3 className="mb-2.5 text-[13px] font-semibold text-ink">操作权限（按钮 / 动作级）</h3>
                        <div className="rounded-[12px] border border-line bg-[#fdfdff] px-4 py-1">
                            {Object.entries(ACTION_CATALOG).map(([menuKey, actions]) => {
                                const menuOn = effective.menus.includes(menuKey);
                                const chosen = effective.actions[menuKey] ?? [];
                                return (
                                    <div
                                        key={menuKey}
                                        className={`border-b border-dashed border-line py-3 last:border-b-0 ${menuOn && !locked ? "" : "pointer-events-none opacity-45"}`}
                                    >
                                        <div className="mb-2 flex items-center gap-2">
                                            <Icon
                                                name={MENU_CATALOG.find(menu => menu.key === menuKey)?.icon ?? "grid"}
                                                size={15}
                                                className="text-muted"
                                            />
                                            <span className="text-[13px] font-semibold text-ink">
                                                {MENU_CATALOG.find(menu => menu.key === menuKey)?.label ?? menuKey}
                                            </span>
                                            {!menuOn && (
                                                <span className="text-[11.5px] text-subtle">（菜单未授权）</span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {actions.map(action => {
                                                const checked = chosen.includes(action.id);
                                                return (
                                                    <label
                                                        key={action.id}
                                                        className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition ${
                                                            checked
                                                                ? "border-primary-border bg-primary-soft font-semibold text-primary-strong"
                                                                : "border-line bg-white text-td"
                                                        }`}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            className="sr-only"
                                                            checked={checked}
                                                            onChange={event =>
                                                                toggleAction(menuKey, action.id, event.target.checked)
                                                            }
                                                        />
                                                        <span
                                                            className={`h-1.5 w-1.5 rounded-full ${checked ? "bg-primary" : "bg-line-strong"}`}
                                                        />
                                                        {action.label}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <h3 className="mb-1 text-[13px] font-semibold text-ink">
                            该角色成员（{users.filter(user => user.role === activeRole).length}）
                        </h3>
                        {users.filter(user => user.role === activeRole).length ? (
                            <div className="divide-y divide-dashed divide-line">
                                {users
                                    .filter(user => user.role === activeRole)
                                    .map(user => (
                                        <div key={user.id} className="flex items-center gap-2.5 py-2.5">
                                            <span className="flex h-7.5 w-7.5 items-center justify-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary-strong">
                                                {user.name.slice(0, 1)}
                                            </span>
                                            <span className="text-[13px] font-medium text-ink">{user.name}</span>
                                            <span className="text-[11.5px] text-muted">{user.account}</span>
                                            <span className="ml-auto">
                                                <Badge tone={user.active ? "success" : "progress"}>
                                                    {user.active ? "启用" : "已停用"}
                                                </Badge>
                                            </span>
                                        </div>
                                    ))}
                            </div>
                        ) : (
                            <p className="py-2 text-[12.5px] text-subtle">暂无成员，可在「账号管理」中分配。</p>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
}

/* ================= Tab 3 · 权限矩阵 ================= */

function MatrixTab() {
    const { data } = useGrants();
    const grants = data ?? DEFAULT_GRANTS;
    const modules = MENU_CATALOG.filter(menu => !menu.onlyFor && menu.key !== "workbench");
    return (
        <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
            <div className="border-b border-line bg-gradient-to-b from-white to-[#fcfcfd] px-5 py-4">
                <h2 className="text-[15px] font-semibold text-ink">角色 × 模块权限矩阵</h2>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-215 border-collapse">
                    <thead>
                        <tr className="bg-[#f8fafc] text-[12px] text-muted">
                            <th className="border border-line px-3 py-2.5 text-left font-semibold">模块 \\ 角色</th>
                            {ROLES.map(role => (
                                <th key={role.id} className="border border-line px-3 py-2.5 text-center font-semibold">
                                    {role.name}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {modules.map(menu => (
                            <tr key={menu.key}>
                                <th className="border border-line bg-[#fcfcfd] px-3 py-2 text-left text-[12.5px] font-semibold whitespace-nowrap text-ink">
                                    {menu.label}
                                </th>
                                {ROLES.map(role => {
                                    const grant = grants[role.id];
                                    if (!grant.menus.includes(menu.key)) {
                                        return (
                                            <td
                                                key={role.id}
                                                className="border border-line px-3 py-2 text-center text-[#c0c5cf]"
                                            >
                                                —
                                            </td>
                                        );
                                    }
                                    const actions = actionsOf(menu.key);
                                    if (!actions) {
                                        return (
                                            <td key={role.id} className="border border-line px-3 py-2 text-center">
                                                <Badge>可见</Badge>
                                            </td>
                                        );
                                    }
                                    const chosen = grant.actions[menu.key] ?? [];
                                    const nonView = actions.filter(
                                        action => action.id !== "view" && chosen.includes(action.id),
                                    );
                                    if (!nonView.length) {
                                        return (
                                            <td key={role.id} className="border border-line px-3 py-2 text-center">
                                                <Badge>只读</Badge>
                                            </td>
                                        );
                                    }
                                    if (nonView.length === actions.length - 1) {
                                        return (
                                            <td
                                                key={role.id}
                                                className="border border-line px-3 py-2 text-center text-[12px] font-semibold text-success"
                                            >
                                                全部权限
                                            </td>
                                        );
                                    }
                                    return (
                                        <td key={role.id} className="border border-line px-3 py-2 text-center">
                                            <span className="inline-flex max-w-45 flex-wrap justify-center gap-1">
                                                {nonView.map(action => (
                                                    <Badge
                                                        key={action.id}
                                                        tone={action.id === "print" ? "ready" : "progress"}
                                                    >
                                                        {action.label}
                                                    </Badge>
                                                ))}
                                            </span>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

/* ================= 系统事件 / 变更日志 ================= */

function SystemEventsPanel({
    events,
    isLoading,
}: {
    events: Array<{
        level: string;
        levelTone: string;
        module: string;
        item: string;
        ref: string;
        found: string;
        state: string;
        open: boolean;
    }>;
    isLoading: boolean;
}) {
    return (
        <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-gradient-to-b from-white to-[#fcfcfd] px-5 py-4">
                <h2 className="text-[15px] font-semibold text-ink">系统事件</h2>
                <span className="text-[12px] text-subtle">
                    待处理 {events.filter(event => event.open).length} / {events.length}
                </span>
            </div>
            <div className="mobile-records">
                <ListState loading={isLoading} empty={!events.length}>
                    {events.map(event => (
                        <RecordCard
                            key={event.ref + event.item}
                            title={event.item}
                            subtitle={`${event.module} · ${event.ref}`}
                            badge={<Badge tone={event.open ? "pending" : "success"}>{event.state}</Badge>}
                        >
                            <p>
                                {event.level} · {event.found}
                            </p>
                        </RecordCard>
                    ))}
                </ListState>
            </div>
            <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-190 border-collapse">
                    <thead>
                        <tr className="bg-[#f8fafc] text-left text-[12px] text-muted">
                            <th className="px-5 py-2.5 font-semibold">级别</th>
                            <th className="px-3 py-2.5 font-semibold">模块</th>
                            <th className="px-3 py-2.5 font-semibold">事项</th>
                            <th className="px-3 py-2.5 font-semibold">对象</th>
                            <th className="px-3 py-2.5 font-semibold">发现时间</th>
                            <th className="px-5 py-2.5 font-semibold">状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        {events.map(event => (
                            <tr
                                key={event.ref + event.item}
                                className="border-t border-line/70 transition hover:bg-row-hover"
                            >
                                <td className="px-5 py-3">
                                    <Badge tone={EVENT_TONE[event.levelTone] ?? "progress"}>{event.level}</Badge>
                                </td>
                                <td className="px-3 py-3 text-[13px] text-td">{event.module}</td>
                                <td className="px-3 py-3 text-[13px] text-td">{event.item}</td>
                                <td className="px-3 py-3 tnum text-[12.5px] font-medium text-[#475467]">{event.ref}</td>
                                <td className="px-3 py-3 tnum text-[13px] text-td">{event.found}</td>
                                <td className="px-5 py-3">
                                    <Badge tone={EVENT_STATE_TONE[event.state] ?? "progress"}>{event.state}</Badge>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function GrantLogPanel() {
    const { data } = useGrantLog();
    const logs = (data ?? []).slice(0, 8);
    return (
        <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
            <div className="border-b border-line bg-gradient-to-b from-white to-[#fcfcfd] px-5 py-4">
                <h2 className="text-[15px] font-semibold text-ink">权限变更日志</h2>
            </div>
            <div className="flex flex-col px-5 py-2">
                {logs.length ? (
                    logs.map((entry, index) => (
                        <div
                            key={`${entry.time}-${index}`}
                            className="flex gap-3 border-b border-dashed border-line py-2.5 last:border-b-0"
                        >
                            <span className="tnum w-17.5 shrink-0 pt-px text-[11.5px] text-muted">{entry.time}</span>
                            <span className="w-16 shrink-0 text-[12px] font-semibold text-ink">{entry.user}</span>
                            <span className="text-[12.5px] leading-relaxed text-td">{entry.text}</span>
                        </div>
                    ))
                ) : (
                    <p className="py-4 text-[12.5px] text-subtle">暂无变更记录</p>
                )}
            </div>
        </section>
    );
}

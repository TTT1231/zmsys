import { useState, type ReactNode } from "react";
import { Navigate } from "react-router";
import { ListState, RecordCard } from "@/components/ui/MobileList";
import { Badge } from "@/components/ui/Badge";
import { Button, TableLink } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PageHeading } from "@/components/ui/PageHeading";
import { SelectField, TextArea, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/toastContexts";
import { Icon } from "@/lib/icons";
import { useApp } from "@/context/useApp";
import {
    useCreateUser,
    useGrantLog,
    useGrants,
    useResetUserPassword,
    useSaveGrants,
    useSetUserActive,
    useUpdateUser,
    useWbView,
} from "@/data/queries";
import type { Customer, CustomerOwnerOption, WbUser } from "@/api";
import {
    ACTION_CATALOG,
    DEFAULT_GRANTS,
    MENU_CATALOG,
    ONLY_FOR_ACTION_GROUPS,
    ROLES,
    actionsOf,
    diffGrants,
    type RoleGrant,
    type RoleId,
} from "@/data/permissions";
import { num } from "@/lib/format";
import { copyText } from "@/lib/clipboard";

type PermTab = "accounts" | "roles" | "matrix";

/** 契约初始密码：新增用户与重置密码统一为 123456（后端 INITIAL_PASSWORD 同值） */
const INITIAL_PASSWORD = "123456";

const TABS: Array<{ key: PermTab; label: string }> = [
    { key: "accounts", label: "账号管理" },
    { key: "roles", label: "角色与权限" },
    { key: "matrix", label: "权限矩阵" },
];

const roleNameOf = (id: RoleId) => ROLES.find(role => role.id === id)?.name ?? id;
const clone = (value: RoleGrant): RoleGrant => JSON.parse(JSON.stringify(value));
const topMenuCount = (grant: RoleGrant) =>
    MENU_CATALOG.filter(menu => !menu.onlyFor && grant.menus.includes(menu.key)).length;
/** 离岗移交预判：销售名下仍有客户时，改角色 / 停用须指定接任销售（后端同规则兜底校验） */
const ownedCustomerCount = (customers: Customer[], account: string) =>
    customers.filter(customer => customer.ownerAccount === account).length;

export function PermissionsPage() {
    const { can } = useApp();
    const { snap, isLoading } = useWbView();
    const { data: grantLogData } = useGrantLog();
    const [tab, setTab] = useState<PermTab>("accounts");

    if (!can("permissions:view")) return <Navigate to="/workbench" replace />;

    const users = snap.users;
    const roleCount = new Set(users.map(user => user.role)).size;

    return (
        <div className="flex flex-col gap-5">
            <PageHeading eyebrow="工作台" title="用户与权限" description="维护账号与角色，配置菜单与操作权限。" />

            <div className="grid grid-cols-3 gap-2.5">
                {[
                    { label: "用户总数", value: users.length, unit: "人" },
                    { label: "角色数量", value: roleCount, unit: "个" },
                    { label: "权限变更记录", value: grantLogData?.length ?? 0, unit: "条" },
                ].map(kpi => (
                    <div
                        key={kpi.label}
                        className="relative flex min-h-18.5 flex-col justify-center overflow-hidden rounded-card border border-line/70 bg-surface/90 px-4 py-3 shadow-xs"
                    >
                        <span className="absolute top-0 bottom-0 left-0 w-0.75 bg-primary-border" />
                        <span className="text-12 text-muted">
                            {kpi.label}{" "}
                            <strong className="tnum ml-1 text-20 font-bold text-ink">{num(kpi.value)}</strong>
                            <span className="ml-1 text-12 text-subtle">{kpi.unit}</span>
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

            {tab === "accounts" && (
                <AccountsTab
                    users={users}
                    customers={snap.customers}
                    ownerOptions={snap.customerOwnerOptions}
                    isLoading={isLoading}
                />
            )}
            {tab === "roles" && <RolesTab users={users} />}
            {tab === "matrix" && <MatrixTab />}

            <GrantLogPanel />
        </div>
    );
}

/* ================= Tab 1 · 账号管理 ================= */

function AccountsTab({
    users,
    customers,
    ownerOptions,
    isLoading,
}: {
    users: WbUser[];
    customers: Customer[];
    ownerOptions: CustomerOwnerOption[];
    isLoading: boolean;
}) {
    const [editing, setEditing] = useState<WbUser | "new" | null>(null);
    const [resetting, setResetting] = useState<WbUser | null>(null);

    return (
        <>
            <section className="overflow-hidden rounded-panel border border-line bg-surface/97 shadow-card">
                <div className="flex items-center justify-between gap-3 border-b border-line bg-linear-to-b from-surface to-panel px-5 py-4">
                    <h2 className="text-15 font-semibold text-ink">用户列表</h2>
                    <Button variant="secondary" icon="plus" onClick={() => setEditing("new")}>
                        新增用户
                    </Button>
                </div>
                <div className="mobile-records">
                    <ListState loading={isLoading} empty={!users.length}>
                        {users.map(user => (
                            <RecordCard
                                key={user.account}
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
                                            <Button variant="secondary" onClick={() => setResetting(user)}>
                                                重置密码
                                            </Button>
                                            <UserActiveToggle
                                                user={user}
                                                customers={customers}
                                                ownerOptions={ownerOptions}
                                            />
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
                    <table className="data-table w-full min-w-180 border-collapse">
                        <thead>
                            <tr className="text-left text-13 text-muted">
                                <th className="cell-pad-wide">用户</th>
                                <th>角色</th>
                                <th>账号</th>
                                <th>状态</th>
                                <th>最近登录</th>
                                <th className="cell-pad-wide text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.account}>
                                    <td className="cell-pad-wide">
                                        <div className="flex items-center gap-2.5">
                                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-14 font-semibold text-primary-strong">
                                                {user.name.slice(0, 1)}
                                            </span>
                                            <span className="text-14 font-semibold text-ink">{user.name}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <Badge tone="ready">{roleNameOf(user.role)}</Badge>
                                    </td>
                                    <td className="tnum text-14 text-muted">{user.account}</td>
                                    <td>
                                        <UserActiveToggle
                                            user={user}
                                            customers={customers}
                                            ownerOptions={ownerOptions}
                                            asSwitch
                                        />
                                    </td>
                                    <td className="tnum text-14 text-muted">{user.last}</td>
                                    <td className="cell-pad-wide text-right whitespace-nowrap">
                                        {user.role === "super" ? (
                                            <span className="text-13 text-subtle">内置账号</span>
                                        ) : (
                                            <>
                                                <TableLink onClick={() => setEditing(user)}>编辑</TableLink>
                                                <span className="mx-2 text-line-strong">·</span>
                                                <TableLink onClick={() => setResetting(user)}>重置密码</TableLink>
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
                <UserDialog
                    user={editing === "new" ? null : editing}
                    users={users}
                    customers={customers}
                    ownerOptions={ownerOptions}
                    onClose={() => setEditing(null)}
                />
            )}
            {resetting !== null && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />}
        </>
    );
}

/* 重置密码二次确认：确认后调用接口，成功留在弹窗内展示初始密码（可复制），
 * 避免密码随 toast 一闪而过；重置后对方旧会话立即失效，需用初始密码重新登录 */
function ResetPasswordModal({ user, onClose }: { user: WbUser; onClose: () => void }) {
    const resetPwd = useResetUserPassword();
    const toast = useToast();
    const [done, setDone] = useState(false);

    const confirm = () => {
        resetPwd.mutate(
            { account: user.account, expectedVersion: user.version },
            {
                onSuccess: () => setDone(true),
            },
        );
    };

    const copyPassword = async () => {
        if (await copyText(INITIAL_PASSWORD)) toast.success("已复制初始密码");
    };

    return (
        <Modal
            open
            onClose={onClose}
            label="用户与权限"
            title={done ? "密码已重置" : "重置密码"}
            width={440}
            footer={
                done ? (
                    <Button size="sm" onClick={onClose}>
                        我已知晓
                    </Button>
                ) : (
                    <>
                        <Button size="sm" variant="secondary" onClick={onClose}>
                            取消
                        </Button>
                        <Button size="sm" onClick={confirm} disabled={resetPwd.isPending}>
                            {resetPwd.isPending ? "重置中…" : "确认重置"}
                        </Button>
                    </>
                )
            }
        >
            {done ? (
                <div className="flex flex-col items-center gap-2 py-1.5 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success-soft">
                        <Icon name="check" size={22} className="text-success" />
                    </span>
                    <p className="text-14 font-semibold text-ink">新密码已生效</p>
                    <div className="mt-1.5 flex w-full items-center justify-center gap-3.5 rounded-xl border border-primary-border bg-primary-soft px-4 py-3.5">
                        <span className="tnum text-24 font-bold tracking-[0.18em] text-primary-strong">
                            {INITIAL_PASSWORD}
                        </span>
                        <Button
                            variant="secondary"
                            size="sm"
                            className="min-h-8 gap-1.5 px-2.5 text-13"
                            onClick={copyPassword}
                            aria-label="复制初始密码"
                            title="复制初始密码"
                        >
                            <Icon name="copy" size={13} />
                            复制
                        </Button>
                    </div>
                    <p className="text-13 text-subtle">请告知本人使用新密码登录，其当前登录已失效</p>
                </div>
            ) : (
                <div className="flex flex-col gap-3.5">
                    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-soft px-3.5 py-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-14 font-semibold text-primary-strong">
                            {user.name.slice(0, 1)}
                        </span>
                        <div className="min-w-0">
                            <p className="truncate text-14 font-semibold text-ink">{user.name}</p>
                            <p className="tnum text-13 text-muted">{user.account}</p>
                        </div>
                    </div>
                    <ul className="flex flex-col gap-2.5">
                        <li className="flex items-center gap-2.5 text-14 text-td">
                            <span className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-full bg-primary-soft">
                                <Icon name="lock" size={14} className="text-primary-strong" />
                            </span>
                            <span>
                                登录密码将重置为{" "}
                                <strong className="tnum font-semibold text-ink">{INITIAL_PASSWORD}</strong>
                            </span>
                        </li>
                        <li className="flex items-center gap-2.5 text-14 text-td">
                            <span className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-full bg-warning-soft">
                                <Icon name="logout" size={14} className="text-warning" />
                            </span>
                            <span>该账号当前登录将立即退出</span>
                        </li>
                    </ul>
                </div>
            )}
        </Modal>
    );
}

/* 启用 / 停用：桌面表格内是开关，移动卡片内是按钮。
 * 停用在岗销售且名下仍有客户时先弹移交确认，避免被后端 400 拒绝。 */
function UserActiveToggle({
    user,
    customers,
    ownerOptions,
    asSwitch,
}: {
    user: WbUser;
    customers: Customer[];
    ownerOptions: CustomerOwnerOption[];
    asSwitch?: boolean;
}) {
    const setActive = useSetUserActive();
    const toast = useToast();
    const [transferring, setTransferring] = useState(false);
    if (user.role === "super") {
        return <Badge tone="success">启用</Badge>;
    }
    const ownedCount = ownedCustomerCount(customers, user.account);
    const candidates = ownerOptions.filter(option => option.account !== user.account);
    const toggle = () => {
        if (user.active && user.role === "sales" && ownedCount > 0) {
            setTransferring(true);
            return;
        }
        setActive.mutate(
            { account: user.account, expectedVersion: user.version, active: !user.active },
            {
                onSuccess: () =>
                    toast.success(user.active ? `已停用【${user.name}】，其登录会话已失效` : `已启用【${user.name}】`),
            },
        );
    };
    const control = asSwitch ? (
        <button
            type="button"
            role="switch"
            aria-checked={user.active}
            aria-label={`${user.active ? "停用" : "启用"} ${user.name}`}
            onClick={toggle}
            className={`relative h-5 w-9 rounded-full transition ${user.active ? "bg-success" : "bg-line-strong"}`}
        >
            <span
                className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-surface shadow-xs transition ${user.active ? "translate-x-4" : ""}`}
            />
        </button>
    ) : (
        <Button variant="secondary" onClick={toggle}>
            {user.active ? "停用" : "启用"}
        </Button>
    );
    return (
        <>
            {control}
            {transferring && (
                <DeactivateTransferModal
                    user={user}
                    ownedCount={ownedCount}
                    candidates={candidates}
                    onClose={() => setTransferring(false)}
                />
            )}
        </>
    );
}

/* 停用销售前移交客户：接任者 + 原因（后端要求原因 2-500 字符） */
function DeactivateTransferModal({
    user,
    ownedCount,
    candidates,
    onClose,
}: {
    user: WbUser;
    ownedCount: number;
    candidates: CustomerOwnerOption[];
    onClose: () => void;
}) {
    const setActive = useSetUserActive();
    const toast = useToast();
    const [replacement, setReplacement] = useState("");
    const [reason, setReason] = useState("");
    const [errors, setErrors] = useState<{ replacement?: string; reason?: string }>({});

    const confirm = () => {
        const next: typeof errors = {};
        if (!replacement) next.replacement = "请选择接任销售";
        if (!validTransferReason(reason)) next.reason = TRANSFER_REASON_ERROR;
        setErrors(next);
        if (Object.keys(next).length) return;
        setActive.mutate(
            {
                account: user.account,
                expectedVersion: user.version,
                active: false,
                replacementOwnerAccount: replacement,
                transferReason: reason.trim(),
            },
            {
                onSuccess: () => {
                    toast.success(`已停用【${user.name}】，名下 ${ownedCount} 个客户已移交给接任销售`);
                    onClose();
                },
            },
        );
    };

    return (
        <Modal
            open
            onClose={onClose}
            label="用户与权限"
            title="停用销售并移交客户"
            width={440}
            footer={
                <>
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" onClick={confirm} disabled={setActive.isPending}>
                        确认停用并移交
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-14 leading-relaxed text-td">
                    即将停用【{user.name}（{user.account}）】，名下 {ownedCount} 个客户将移交给接任销售继续跟进。
                </p>
                <TransferFields
                    candidates={candidates}
                    replacement={replacement}
                    reason={reason}
                    errors={errors}
                    onReplacement={setReplacement}
                    onReason={setReason}
                />
            </div>
        </Modal>
    );
}

function UserDialog({
    user,
    users,
    customers,
    ownerOptions,
    onClose,
}: {
    user: WbUser | null;
    users: WbUser[];
    customers: Customer[];
    ownerOptions: CustomerOwnerOption[];
    onClose: () => void;
}) {
    const createUser = useCreateUser();
    const updateUser = useUpdateUser();
    const toast = useToast();
    const pending = createUser.isPending || updateUser.isPending;
    const [name, setName] = useState(user?.name ?? "");
    const [account, setAccount] = useState(user?.account ?? "");
    const [role, setRole] = useState<RoleId>(user?.role ?? "staff");
    const [replacement, setReplacement] = useState("");
    const [reason, setReason] = useState("");
    const [errors, setErrors] = useState<{ name?: string; account?: string; replacement?: string; reason?: string }>(
        {},
    );
    // 在岗销售被改为其他角色 = 离岗：名下仍有客户则必须移交（后端同规则兜底校验）
    const ownedCount = user ? ownedCustomerCount(customers, user.account) : 0;
    const needTransfer = !!user && user.role === "sales" && role !== "sales" && ownedCount > 0;
    const candidates = ownerOptions.filter(option => !user || option.account !== user.account);

    const submit = () => {
        const next: typeof errors = {};
        if (!name.trim()) next.name = "请填写姓名";
        const accountOk = /^[A-Za-z0-9_]{3,}$/.test(account.trim());
        if (!accountOk) next.account = "账号需为字母 / 数字 / 下划线";
        else if (users.some(item => item.account === account.trim() && item.account !== user?.account))
            next.account = "账号已存在";
        if (needTransfer) {
            if (!replacement) next.replacement = "请选择接任销售";
            if (!validTransferReason(reason)) next.reason = TRANSFER_REASON_ERROR;
        }
        setErrors(next);
        if (Object.keys(next).length) return;
        const done = (message: string) => () => {
            toast.success(message);
            onClose();
        };
        if (user) {
            // account 创建后不可改，仅更新姓名与角色；离岗移交随角色变更一并提交
            updateUser.mutate(
                {
                    account: user.account,
                    expectedVersion: user.version,
                    name: name.trim(),
                    role,
                    ...(needTransfer ? { replacementOwnerAccount: replacement, transferReason: reason.trim() } : {}),
                },
                {
                    onSuccess: done(
                        `用户【${name.trim()}】已更新${needTransfer ? `，名下 ${ownedCount} 个客户已移交` : ""}`,
                    ),
                },
            );
        } else {
            if (role === "super") return;
            createUser.mutate(
                { name: name.trim(), account: account.trim(), role },
                { onSuccess: done(`用户【${name.trim()}】已创建，初始密码为 ${INITIAL_PASSWORD}`) },
            );
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            label="用户与权限"
            title={user ? "编辑用户" : "新增用户"}
            width={440}
            footer={
                <>
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" onClick={submit} disabled={pending}>
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
                    maxLength={20}
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
                    {ROLES.filter(item => item.id !== "super" || user?.role === "super").map(item => (
                        <option key={item.id} value={item.id}>
                            {item.name}
                        </option>
                    ))}
                </SelectField>
                {needTransfer && (
                    <TransferFields
                        candidates={candidates}
                        replacement={replacement}
                        reason={reason}
                        errors={errors}
                        onReplacement={setReplacement}
                        onReason={setReason}
                    />
                )}
                {!user && (
                    <p className="text-13 text-subtle">初始密码统一为 {INITIAL_PASSWORD}，用户可登录后按需修改。</p>
                )}
            </div>
        </Modal>
    );
}

/* ---------- 离岗移交（编辑改角色 / 停用共用） ---------- */

const TRANSFER_REASON_ERROR = "移交原因需 2-500 字符";
const validTransferReason = (reason: string) => {
    const length = reason.trim().length;
    return length >= 2 && length <= 500;
};

/* 接任销售候选为启用中的其他销售（来自 /customer-owner-options，后端校验同规则） */
function TransferFields({
    candidates,
    replacement,
    reason,
    errors,
    onReplacement,
    onReason,
}: {
    candidates: CustomerOwnerOption[];
    replacement: string;
    reason: string;
    errors: { replacement?: string; reason?: string };
    onReplacement: (value: string) => void;
    onReason: (value: string) => void;
}) {
    return (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/60 bg-warning/5 p-3.5">
            <p className="text-13 leading-relaxed text-td">
                <Icon name="alert" size={13} className="mr-1 -mt-px inline text-warning" />
                该销售名下仍有客户，离岗前须指定接任销售并填写移交原因。
            </p>
            {candidates.length ? (
                <SelectField
                    label="接任销售"
                    required
                    value={replacement}
                    error={errors.replacement}
                    onChange={event => onReplacement(event.target.value)}
                >
                    <option value="">请选择</option>
                    {candidates.map(option => (
                        <option key={option.account} value={option.account}>
                            {option.name}（{option.account}）
                        </option>
                    ))}
                </SelectField>
            ) : (
                <p className="text-13 text-danger">暂无其他在职销售可接任，请先启用其他销售账号。</p>
            )}
            <TextArea
                label="移交原因"
                required
                value={reason}
                error={errors.reason}
                placeholder="例：岗位调整，名下客户由接任销售继续跟进"
                maxLength={500}
                onChange={event => onReason(event.target.value)}
            />
        </div>
    );
}

/* ================= Tab 2 · 角色与权限 ================= */

function RolesTab({ users }: { users: WbUser[] }) {
    const { refreshProfile } = useApp();
    const toast = useToast();
    const { data: grantsData, isLoading: grantsLoading } = useGrants();
    const saveGrants = useSaveGrants();
    const grants = grantsData ?? DEFAULT_GRANTS;
    const [activeRole, setActiveRole] = useState<RoleId>("admin");
    const [draft, setDraft] = useState<RoleGrant | null>(null);
    const locked = ROLES.find(role => role.id === activeRole)?.locked ?? false;
    const effective = draft ?? grants[activeRole] ?? { version: 0, menus: [], actions: {} };
    const roleMembers = users.filter(user => user.role === activeRole);

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
                      // 受保护菜单只能由超级管理员持有：全选写入同样跳过（含其子菜单）
                      menu.onlyFor || menu.protected
                          ? []
                          : [menu.key, ...(menu.children ?? []).map(child => child.key)],
                  )
                : [];
            grant.actions = Object.fromEntries(
                Object.keys(ACTION_CATALOG).map(menu => [
                    menu,
                    checked ? (actionsOf(menu) ?? []).filter(action => !action.protected).map(action => action.id) : [],
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
                    toast.success(`角色【${roleNameOf(activeRole)}】授权已保存`);
                    // 若改的是当前登录用户的角色，刷新自身权限（菜单/按钮立即生效）
                    void refreshProfile();
                },
                // 乐观锁冲突（他人已保存）等失败：保留草稿并提示，用户可刷新后重勾
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
                <section className="overflow-hidden rounded-panel border border-line bg-surface/97 shadow-card">
                    <div className="border-b border-line bg-linear-to-b from-surface to-panel px-5 py-4">
                        <h2 className="text-15 font-semibold text-ink">角色</h2>
                    </div>
                    <div className="flex flex-col gap-2 p-3">
                        {ROLES.map(role => {
                            const grant = grants[role.id];
                            return (
                                <button
                                    key={role.id}
                                    type="button"
                                    onClick={() => selectRole(role.id)}
                                    className={`rounded-xl border px-3.5 py-3 text-left transition ${
                                        role.id === activeRole
                                            ? "border-primary bg-primary-soft shadow-[0_0_0_1px_var(--color-primary)]"
                                            : "border-line bg-surface hover:border-primary-border hover:bg-row-hover"
                                    }`}
                                >
                                    <span className="flex items-center gap-2">
                                        <span className="text-14 font-semibold text-ink">{role.name}</span>
                                        {role.locked && (
                                            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-line bg-soft px-2 py-px text-11 text-muted">
                                                <Icon name="shield" size={11} />
                                                内置
                                            </span>
                                        )}
                                    </span>
                                    <span className="mt-1.5 flex items-center gap-1.5 text-12 text-subtle">
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

            <section className="overflow-hidden rounded-panel border border-line bg-surface/97 shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-linear-to-b from-surface to-panel px-5 py-4">
                    <div className="flex items-baseline gap-2.5">
                        <h2 className="text-15 font-semibold text-ink">{roleNameOf(activeRole)}</h2>
                        <span className={`text-13 ${draft ? "text-warning" : "text-muted"}`}>{status}</span>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="secondary" disabled={locked} onClick={reset}>
                            恢复默认
                        </Button>
                        <Button disabled={locked || !draft} onClick={save}>
                            保存授权
                        </Button>
                    </div>
                </div>

                <div className="flex flex-col gap-6 p-5">
                    <div>
                        <div className="mb-2 flex items-center justify-between">
                            <h3 className="text-14 font-semibold text-ink">菜单权限</h3>
                            <label
                                className={`flex items-center gap-1.5 text-13 font-medium text-primary-strong ${locked ? "pointer-events-none opacity-50" : ""}`}
                            >
                                <input
                                    type="checkbox"
                                    className="accent-primary"
                                    checked={MENU_CATALOG.every(
                                        menu => menu.onlyFor || menu.protected || effective.menus.includes(menu.key),
                                    )}
                                    onChange={event => toggleAll(event.target.checked)}
                                />
                                全选
                            </label>
                        </div>
                        <div className="rounded-xl border border-line bg-panel px-3 py-2">
                            {MENU_CATALOG.filter(menu => !menu.onlyFor && !menu.protected).map(menu => (
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
                                        <span className="text-14 text-ink">{menu.label}</span>
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
                                                    <span className="text-13 text-td">└ {child.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h3 className="mb-1 text-14 font-semibold text-ink">操作权限（按钮 / 动作级）</h3>
                        <p className="mb-2.5 text-12 leading-5 text-subtle">
                            灰色不可勾选项为受保护权限（如删除订单、删除 BOM），仅超级管理员持有， 不能授权给其他角色。
                        </p>
                        <div className="rounded-xl border border-line bg-panel px-4 py-1">
                            {Object.entries(ACTION_CATALOG)
                                .filter(([menuKey]) => !ONLY_FOR_ACTION_GROUPS.has(menuKey))
                                .map(([menuKey, actions]) => {
                                    const menuOn = effective.menus.includes(menuKey);
                                    const chosen = effective.actions[menuKey] ?? [];
                                    return (
                                        <div
                                            key={menuKey}
                                            className={`border-b border-dashed border-line py-3 last:border-b-0 ${menuOn && !locked ? "" : "pointer-events-none opacity-45"}`}
                                        >
                                            <div className="mb-2 flex items-center gap-2">
                                                <Icon
                                                    name={
                                                        MENU_CATALOG.find(menu => menu.key === menuKey)?.icon ?? "grid"
                                                    }
                                                    size={15}
                                                    className="text-muted"
                                                />
                                                <span className="text-14 font-semibold text-ink">
                                                    {MENU_CATALOG.find(menu => menu.key === menuKey)?.label ?? menuKey}
                                                </span>
                                                {!menuOn && <span className="text-12 text-subtle">（菜单未授权）</span>}
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {actions.map(action => {
                                                    const checked = chosen.includes(action.id);
                                                    const isProtected = "protected" in action && action.protected;
                                                    return (
                                                        <label
                                                            key={action.id}
                                                            title={
                                                                isProtected
                                                                    ? "受保护权限：仅超级管理员持有，不可授权"
                                                                    : undefined
                                                            }
                                                            className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-13 transition ${
                                                                isProtected
                                                                    ? "cursor-not-allowed border-line bg-soft text-subtle opacity-60"
                                                                    : "cursor-pointer " +
                                                                      (checked
                                                                          ? "border-primary-border bg-primary-soft font-semibold text-primary-strong"
                                                                          : "border-line bg-surface text-td")
                                                            }`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                className="sr-only"
                                                                checked={checked}
                                                                disabled={isProtected}
                                                                onChange={event =>
                                                                    toggleAction(
                                                                        menuKey,
                                                                        action.id,
                                                                        event.target.checked,
                                                                    )
                                                                }
                                                            />
                                                            <span
                                                                className={`h-1.5 w-1.5 rounded-full ${checked ? "bg-primary" : "bg-line-strong"}`}
                                                            />
                                                            {action.label}
                                                            {isProtected && (
                                                                <span className="sr-only">（仅超级管理员）</span>
                                                            )}
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
                        <h3 className="mb-1 text-14 font-semibold text-ink">该角色成员（{roleMembers.length}）</h3>
                        {roleMembers.length ? (
                            <div className="divide-y divide-dashed divide-line">
                                {roleMembers.map(user => (
                                    <div key={user.account} className="flex items-center gap-2.5 py-2.5">
                                        <span className="flex h-7.5 w-7.5 items-center justify-center rounded-full bg-primary-soft text-13 font-semibold text-primary-strong">
                                            {user.name.slice(0, 1)}
                                        </span>
                                        <span className="text-14 font-medium text-ink">{user.name}</span>
                                        <span className="text-12 text-muted">{user.account}</span>
                                        <span className="ml-auto">
                                            <Badge tone={user.active ? "success" : "progress"}>
                                                {user.active ? "启用" : "已停用"}
                                            </Badge>
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="py-2 text-13 text-subtle">暂无成员，可在「账号管理」中分配。</p>
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
    // 系统模块虽仅超管可用，也纳入矩阵作为授权举证；工作台是固定入口，不单独列模块。
    const modules = MENU_CATALOG.filter(
        menu => menu.group === "系统" || (!menu.onlyFor && !menu.protected && menu.key !== "workbench"),
    );
    return (
        <section className="overflow-hidden rounded-panel border border-line bg-surface/97 shadow-card">
            <div className="border-b border-line bg-linear-to-b from-surface to-panel px-5 py-4">
                <h2 className="text-15 font-semibold text-ink">角色 × 模块权限矩阵</h2>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-215 border-collapse">
                    <thead>
                        <tr className="bg-soft text-13 text-muted">
                            <th className="border border-line px-3 py-2.5 text-left font-semibold">模块</th>
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
                                <th className="border border-line bg-panel px-3 py-2 text-left text-13 font-semibold whitespace-nowrap text-ink">
                                    {menu.label}
                                </th>
                                {ROLES.map(role => {
                                    const grant = grants[role.id];
                                    // 系统接口按受保护动作校验；普通角色即使出现脏菜单授权行也无访问权。
                                    if (
                                        (menu.group === "系统" && role.id !== "super") ||
                                        !grant.menus.includes(menu.key)
                                    ) {
                                        return (
                                            <td
                                                key={role.id}
                                                className="border border-line px-3 py-2 text-center text-placeholder"
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
                                                className="border border-line px-3 py-2 text-center text-13 font-semibold text-success"
                                            >
                                                全部权限
                                            </td>
                                        );
                                    }
                                    return (
                                        <td key={role.id} className="border border-line px-3 py-2 text-center">
                                            <span className="inline-flex max-w-45 flex-wrap justify-center gap-1">
                                                {nonView.map(action => (
                                                    <Badge key={action.id} tone="progress">
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

/* ================= 变更日志 ================= */

/* 日志文本形如「角色【仓管】授权变更：新增 …」，拆出角色与动作类型分区展示 */
const LOG_ACTIONS = ["授权变更", "授权确认", "授权保存"] as const;
/** 从 LOG_ACTIONS 生成，避免动作清单与剥离正则两处维护 */
const LOG_ACTION_PATTERN = new RegExp(`^(${LOG_ACTIONS.join("|")})[：:]?\\s*`);
const LOG_ACTION_DOTS: Record<(typeof LOG_ACTIONS)[number], string> = {
    授权变更: "bg-primary",
    授权确认: "bg-success",
    授权保存: "bg-line-strong",
};

/* 角色 → 图标：按职责选型（仓管管货物、销售跑发货） */
const ROLE_ICONS: Record<RoleId, string> = {
    super: "shield",
    admin: "settings",
    warehouse: "cube",
    sales: "truck",
    staff: "users",
};

function parseGrantLog(text: string) {
    const roleMatch = text.match(/^角色【(.+?)】/);
    const role = roleMatch?.[1] ?? "";
    // 日志里的角色可能是中文名（页面备注）也可能是 role id（后端兜底文案）
    const roleDef = ROLES.find(item => item.name === role || item.id === role);
    const rest = roleMatch ? text.slice(roleMatch[0].length) : text;
    const action = LOG_ACTIONS.find(word => rest.startsWith(word));
    return {
        role,
        roleIcon: roleDef ? ROLE_ICONS[roleDef.id] : "users",
        action: action ?? "授权记录",
        detail: rest.replace(LOG_ACTION_PATTERN, ""),
        dot: (action && LOG_ACTION_DOTS[action]) || "bg-primary",
    };
}

/* 明细高亮词表：菜单 / 操作名加浅底，增删动词按语义着色，非技术用户一眼看清改了什么 */
const DETAIL_TERMS = [
    ...MENU_CATALOG.flatMap(menu => [menu.label, ...(menu.children ?? []).map(child => child.label)]),
    ...Object.values(ACTION_CATALOG).flatMap(actions => actions.map(action => action.label)),
]
    .filter((label, index, all) => all.indexOf(label) === index)
    .sort((a, b) => b.length - a.length);
const DETAIL_TERM_RE = new RegExp(
    `${DETAIL_TERMS.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}|新增|移除|未授权`,
    "g",
);
const DETAIL_VERB_STYLES: Record<string, string> = {
    新增: "font-semibold text-success",
    移除: "font-semibold text-danger",
    未授权: "font-semibold text-warning",
};

function renderDetail(text: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    let last = 0;
    for (const match of text.matchAll(DETAIL_TERM_RE)) {
        if (match.index > last) nodes.push(text.slice(last, match.index));
        const word = match[0];
        nodes.push(
            <span
                key={match.index}
                className={DETAIL_VERB_STYLES[word] ?? "rounded-sm bg-soft px-0.75 font-medium text-ink"}
            >
                {word}
            </span>,
        );
        last = match.index + word.length;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
}

function GrantLogPanel() {
    const { data } = useGrantLog();
    const logs = (data ?? []).slice(0, 8);
    return (
        <section className="overflow-hidden rounded-panel border border-line bg-surface/97 shadow-card">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-linear-to-b from-surface to-panel px-5 py-4">
                <h2 className="text-15 font-semibold text-ink">权限变更日志</h2>
                {!!logs.length && <span className="text-12 text-subtle">最近 {logs.length} 条</span>}
            </div>
            {logs.length ? (
                <div className="px-5 py-3">
                    <ol className="flex flex-col border-l border-line pl-4">
                        {logs.map((entry, index) => {
                            const log = parseGrantLog(entry.text);
                            return (
                                <li key={`${entry.time}-${index}`} className="relative py-3">
                                    <span className={`absolute top-5.75 -left-5.25 h-2 w-2 rounded-full ${log.dot}`} />
                                    <div className="flex items-center gap-2.5">
                                        <span className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
                                            <Icon name={log.roleIcon} size={15} className="text-primary-strong" />
                                        </span>
                                        <span className="text-14 font-semibold whitespace-nowrap text-ink">
                                            {log.role || "权限"}
                                        </span>
                                        <span className="text-13 whitespace-nowrap text-muted">· {log.action}</span>
                                        <span className="ml-auto shrink-0 pl-2 text-12 whitespace-nowrap text-subtle">
                                            {entry.user} · <span className="tnum">{entry.time}</span>
                                        </span>
                                    </div>
                                    <p className="mt-1.5 pl-10 text-13 leading-relaxed text-td">
                                        {renderDetail(log.detail)}
                                    </p>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            ) : (
                <p className="px-5 py-4 text-13 text-subtle">暂无变更记录</p>
            )}
        </section>
    );
}

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icons";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Badge";
import { PageLoading } from "@/components/ui/PageLoading";
import { useSystemLogs, useWbSnapshot } from "@/data/queries";
import { EMPTY_SNAPSHOT } from "@/data/views";
import { OrderDetailModal } from "@/pages/orders/OrdersPage";
import { BomDetailModal } from "@/pages/bom/BomPage";
import { VoucherModal } from "@/pages/inbound/InboundPage";
import { OutboundDetailModal } from "@/pages/outbound/OutboundPage";
import { CustomerDetailModal } from "@/pages/customers/CustomersPage";
import type { Snapshot, SystemLogAction, SystemLogChange, SystemLogDomain, SystemLogEntry } from "@/api";

/** 关键词防抖：输入停顿 300ms 才并入查询（避免逐字符触发请求） */
function useDebouncedValue<T>(value: T, delay = 300): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}

/* ---------- 动作 / 域的展示元数据（颜色一律语义令牌；图标复用注册表） ---------- */

type DomainKey = SystemLogDomain | "all";

const DOMAIN_TABS: Array<{ key: DomainKey; label: string }> = [
    { key: "all", label: "全部" },
    { key: "customer", label: "客户档案" },
    { key: "order", label: "销售订单" },
    { key: "bom", label: "物料与 BOM" },
    { key: "inbound", label: "成品入库" },
    { key: "outbound", label: "成品出库" },
];

const DOMAIN_LABELS: Record<SystemLogDomain, string> = {
    customer: "客户档案",
    order: "销售订单",
    bom: "物料与 BOM",
    inbound: "成品入库",
    outbound: "成品出库",
};

/** 域徽章的短标签（卡片目标行用两字域） */
const DOMAIN_CHIPS: Record<SystemLogDomain, string> = {
    customer: "客户",
    order: "订单",
    bom: "BOM",
    inbound: "入库",
    outbound: "出库",
};

interface ActionMeta {
    label: string;
    /** 动作词（卡片标题「某某 + 动作词 + 宾语」） */
    verb: string;
    icon: string;
    /** 图标圆底与强调色（soft 底 + 语义字色） */
    tone: string;
}

const ACTION_META: Record<SystemLogAction, ActionMeta> = {
    create: { label: "新建", verb: "新建了", icon: "plus", tone: "bg-success-soft text-success" },
    edit: { label: "编辑", verb: "编辑了", icon: "edit", tone: "bg-primary-soft text-primary-strong" },
    transfer: { label: "负责人移交", verb: "移交了客户负责人", icon: "transfer", tone: "bg-teal-soft text-teal" },
    archive: { label: "归档", verb: "归档了", icon: "archive", tone: "bg-violet-soft text-violet" },
    delete: { label: "删除", verb: "删除了", icon: "trash", tone: "bg-danger-soft text-danger" },
    void: { label: "作废", verb: "作废了", icon: "cancel", tone: "bg-warning-soft text-warning" },
    ship: { label: "登记发货", verb: "登记了发货", icon: "truck", tone: "bg-teal-soft text-teal" },
    adjust: { label: "库存调整", verb: "调整了库存", icon: "minus", tone: "bg-primary-soft text-primary-strong" },
};

const ACTION_OPTIONS: Array<{ value: string; label: string }> = [
    { value: "all", label: "全部操作" },
    ...Object.entries(ACTION_META).map(([value, meta]) => ({ value, label: meta.label })),
];

const RANGE_OPTIONS = [
    { value: "today", label: "今天" },
    { value: "7d", label: "最近 7 天" },
    { value: "30d", label: "最近 30 天" },
    { value: "custom", label: "自定义范围" },
];

/** 角色代号 → 展示名（与 ROLES 字典一致；未知值原样回显） */
const ROLE_LABELS: Record<string, string> = {
    super: "超级管理员",
    admin: "管理员",
    warehouse: "仓管",
    sales: "销售",
    staff: "员工",
};

/** ISO 时刻 → 北京日期键 yyyy-MM-dd（与后端时间窗口同界） */
const beijingDayOf = (iso: string): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(iso));

/** ISO 时刻 → 北京 HH:mm（卡片右上角时间） */
const beijingTimeOf = (iso: string): string =>
    new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(new Date(iso));

/** ISO 时刻 → 北京 yyyy-MM-dd HH:mm（卡片时间带完整日期，跨日回看不依赖分组标题） */
const beijingDateTimeOf = (iso: string): string => `${beijingDayOf(iso)} ${beijingTimeOf(iso)}`;

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 日标题：今天 · 9 月 27 日 周六；非今日仅 N 月 N 日 周X */
const dayHeadingOf = (day: string): string => {
    const [, month, date] = day.split("-");
    const weekday = WEEKDAYS[new Date(`${day}T12:00:00+08:00`).getDay()] ?? "";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const label = `${Number(month)} 月 ${Number(date)} 日 ${weekday}`;
    return day === today ? `今天 · ${label}` : label;
};

/** 事件卡片标题宾语：移交/发货/调整为固定宾语，其余拼接域名 */
const objectOf = (entry: SystemLogEntry): string => {
    if (entry.action === "transfer") return "";
    if (entry.action === "ship") return "";
    if (entry.action === "adjust") return "";
    if (entry.action === "void") {
        return entry.domain === "inbound" ? "入库记录" : "出库记录";
    }
    return DOMAIN_LABELS[entry.domain];
};

/** 编号点击 → 详情弹窗目标（存业务码，渲染时从快照回捞整行数据） */
type DetailTarget = { kind: SystemLogDomain; code: string };

/** 快照回捞：编号是否对应存活实体行（删除类事件的目标行不在快照，编号降级为纯文本） */
function hasLiveEntity(domain: SystemLogDomain, code: string, snap: Snapshot): boolean {
    switch (domain) {
        case "order":
            return snap.orders.some(item => item.orderNo === code);
        case "bom":
            return snap.boms.some(item => item.code === code);
        case "inbound":
            return snap.inboundLedger.some(item => item.no === code);
        case "outbound":
            return snap.outboundLedger.some(item => item.no === code);
        case "customer":
            return snap.customers.some(item => item.code === code);
    }
}

/** 变更值链接语义：key → 详情域（BOM 编码 → BOM 详情、订单号 → 订单详情） */
function linkDomainOf(key: string | undefined): SystemLogDomain | null {
    if (key === "bomCode") return "bom";
    if (key === "orderNo") return "order";
    return null;
}

/* ---------- 页面 ---------- */

export function SystemLogsPage() {
    const [tab, setTab] = useState<DomainKey>("all");
    const [keyword, setKeyword] = useState("");
    const [action, setAction] = useState("all");
    // 默认最近 7 天（审计日志业界惯例：GitHub 默认近 3 个月，无人只默认当天）
    const [range, setRange] = useState<"today" | "7d" | "30d" | "custom">("7d");
    // custom 延迟生效：草稿仅在点「应用范围」或 Enter 时并入 applied
    const [draftFrom, setDraftFrom] = useState("");
    const [draftTo, setDraftTo] = useState("");
    const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
    const [dateError, setDateError] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword);
    // 业务详情弹窗数据源：全量聚合快照（与搜索页同源共享 React Query 缓存）
    const { data: snapData } = useWbSnapshot();
    const snap = snapData ?? EMPTY_SNAPSHOT;
    const [detail, setDetail] = useState<DetailTarget | null>(null);

    // 自定义范围未应用有效日期前不发起查询（缺 from/to 会被后端 400 拒绝）
    const pendingCustom = range === "custom" && !applied;
    const filters = useMemo(
        () => ({
            ...(tab !== "all" ? { domain: tab as SystemLogDomain } : {}),
            ...(action !== "all" ? { action: action as SystemLogAction } : {}),
            range,
            ...(range === "custom" && applied ? { from: applied.from, to: applied.to } : {}),
            ...(debouncedKeyword.trim() ? { keyword: debouncedKeyword.trim() } : {}),
            limit: 20,
        }),
        [tab, action, range, applied, debouncedKeyword],
    );
    const {
        data,
        isLoading,
        isError,
        error,
        refetch,
        isFetchingNextPage,
        isFetchNextPageError,
        hasNextPage,
        fetchNextPage,
    } = useSystemLogs(filters, !pendingCustom);
    const entries = data?.pages.flatMap(page => page.items) ?? [];

    const applyCustomRange = () => {
        if (!draftFrom || !draftTo || draftFrom > draftTo) {
            setDateError("请选择完整日期，且开始日期不能晚于结束日期。");
            return;
        }
        setDateError("");
        setApplied({ from: draftFrom, to: draftTo });
    };

    const reset = () => {
        setTab("all");
        setKeyword("");
        setAction("all");
        setRange("7d");
        setDraftFrom("");
        setDraftTo("");
        setApplied(null);
        setDateError("");
    };

    // 按北京日分组（保持服务端降序）；相邻同日事件归入同组（依赖查询结果引用而非派生数组）
    const groups = useMemo(() => {
        const items = data?.pages.flatMap(page => page.items) ?? [];
        const byDay = new Map<string, SystemLogEntry[]>();
        for (const entry of items) {
            const day = beijingDayOf(entry.occurredAt);
            const bucket = byDay.get(day) ?? [];
            bucket.push(entry);
            byDay.set(day, bucket);
        }
        return [...byDay.entries()];
    }, [data]);

    return (
        <div className="flex flex-col gap-5">
            <h1 className="sr-only">系统日志</h1>
            <section className="overflow-hidden rounded-panel border border-line bg-surface/97 shadow-card">
                {/* 筛选分两行：业务域 tab 独占一行（6 个 tab 挤一行会换行错乱），
                    搜索与下拉在第二行 */}
                <div className="list-card-primary">
                    <div className="task-tabs flex flex-wrap gap-1" aria-label="业务类型筛选">
                        {DOMAIN_TABS.map(item => (
                            <button
                                type="button"
                                key={item.key}
                                aria-pressed={tab === item.key}
                                onClick={() => setTab(item.key)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                    <TableHeaderActions className="ml-auto" />
                </div>
                <div className="list-toolbar flex flex-wrap items-center gap-2.5 border-b border-line bg-linear-to-b from-surface to-panel px-5 py-3">
                    <label className="flex h-10 min-w-45 flex-1 items-center gap-2 rounded-btn border border-line-strong bg-surface px-3 lg:max-w-90">
                        <Icon name="search" size={15} className="text-subtle" />
                        <input
                            value={keyword}
                            onChange={event => setKeyword(event.target.value)}
                            placeholder="操作人、编号或名称"
                            aria-label="关键词"
                            className="w-full bg-transparent text-14 text-ink outline-none placeholder:text-subtle"
                        />
                    </label>
                    <select
                        value={action}
                        onChange={event => setAction(event.target.value)}
                        aria-label="操作类型"
                        className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink"
                    >
                        {ACTION_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <select
                        value={range}
                        onChange={event => {
                            setRange(event.target.value as typeof range);
                            setDateError("");
                        }}
                        aria-label="时间范围"
                        className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink"
                    >
                        {RANGE_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={reset}
                        className="min-h-10 px-1 text-14 font-medium text-primary-strong transition hover:text-primary"
                    >
                        重置
                    </button>
                </div>

                {range === "custom" && (
                    <div className="border-b border-line bg-soft/60 px-5 py-3">
                        <div className="grid items-end gap-2.5 md:grid-cols-[minmax(0,190px)_minmax(0,190px)_auto]">
                            <label className="flex flex-col gap-1 text-13 font-medium text-td">
                                开始日期
                                <input
                                    type="date"
                                    value={draftFrom}
                                    onChange={event => setDraftFrom(event.target.value)}
                                    aria-invalid={!!dateError && !draftFrom}
                                    className="h-10 rounded-input border border-line-strong bg-surface px-2.5 text-14 text-ink"
                                />
                            </label>
                            <label className="flex flex-col gap-1 text-13 font-medium text-td">
                                结束日期
                                <input
                                    type="date"
                                    value={draftTo}
                                    onChange={event => setDraftTo(event.target.value)}
                                    aria-invalid={!!dateError && !draftTo}
                                    className="h-10 rounded-input border border-line-strong bg-surface px-2.5 text-14 text-ink"
                                />
                            </label>
                            <Button type="button" onClick={applyCustomRange}>
                                应用范围
                            </Button>
                            <p className="text-12 text-subtle md:col-span-3">
                                包含起止日期；较长时间范围也会分批加载。
                            </p>
                            {dateError && (
                                <p role="alert" className="text-13 text-danger md:col-span-3">
                                    {dateError}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                <div className="px-5 py-4">
                    {pendingCustom ? (
                        <EmptyState description="请选择开始与结束日期，并点击「应用范围」后查看。" imageSize={120} />
                    ) : isLoading ? (
                        <PageLoading className="py-16" />
                    ) : isError && entries.length === 0 ? (
                        /* 首批加载失败：与空态区分，提供重试入口。加载更多失败时
                           isError 同样为真（v5 中 error 非空即 isError），但已加载
                           的批次必须保留——仅在无数据时整页报错 */
                        <div className="flex flex-col items-center gap-3 py-12 text-center">
                            <Icon name="alert" size={28} className="text-danger" />
                            <p className="text-14 text-td">日志加载失败：{error?.message ?? "网络异常"}</p>
                            <Button variant="secondary" icon="refresh" onClick={() => void refetch()}>
                                重试
                            </Button>
                        </div>
                    ) : entries.length === 0 ? (
                        <EmptyState
                            description="没有找到对应记录，试试更换业务类型、操作类型或关键词。"
                            imageSize={120}
                        />
                    ) : (
                        <div className="flex flex-col gap-1">
                            {groups.map(([day, items]) => (
                                <section key={day} aria-label={`${day} 的操作`}>
                                    <div className="flex items-center gap-3 py-2.5 text-13 font-bold text-td">
                                        <span>{dayHeadingOf(day)}</span>
                                        {/* 日标题右侧分隔线延伸至行尾（原型 day-heading:after） */}
                                        <span aria-hidden="true" className="h-px flex-1 bg-line" />
                                    </div>
                                    <ol className="ml-2 border-l border-line pl-6">
                                        {items.map(entry => (
                                            <EventCard
                                                key={entry.id}
                                                entry={entry}
                                                snap={snap}
                                                onOpenDetail={setDetail}
                                            />
                                        ))}
                                    </ol>
                                </section>
                            ))}
                            {hasNextPage && (
                                <div className="flex flex-col items-center gap-1.5 py-4">
                                    <Button
                                        variant="secondary"
                                        disabled={isFetchingNextPage}
                                        onClick={() => void fetchNextPage()}
                                    >
                                        {isFetchingNextPage ? "正在加载…" : "加载更多记录"}
                                    </Button>
                                    {isFetchNextPageError && (
                                        <p role="alert" className="text-12 text-danger">
                                            加载更多失败，请重试
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </section>
            <p className="flex items-center gap-2 px-1 text-12 text-subtle">
                <Icon name="shield" size={15} className="shrink-0" />
                客户联系电话只显示「已变更」，不会在日志中展示完整号码；编辑明细日志随业务数据的保留期清理。
            </p>
            {/* 编号点击 → 业务详情弹窗（SearchPage 同款：state 存业务码，渲染时从快照回捞；
                目标已删除时回捞为 null，弹窗不渲染） */}
            {detail?.kind === "order" && (
                <OrderDetailModal
                    order={snap.orders.find(item => item.orderNo === detail.code) ?? null}
                    snap={snap}
                    onClose={() => setDetail(null)}
                />
            )}
            {detail?.kind === "bom" && (
                <BomDetailModal
                    bom={snap.boms.find(item => item.code === detail.code) ?? null}
                    categories={snap.bomCategories}
                    onClose={() => setDetail(null)}
                />
            )}
            {detail?.kind === "inbound" && (
                <VoucherModal
                    row={snap.inboundLedger.find(item => item.no === detail.code) ?? null}
                    snap={snap}
                    onClose={() => setDetail(null)}
                />
            )}
            {detail?.kind === "outbound" && (
                <OutboundDetailModal
                    row={snap.outboundLedger.find(item => item.no === detail.code) ?? null}
                    snap={snap}
                    onClose={() => setDetail(null)}
                />
            )}
            {detail?.kind === "customer" && (
                <CustomerDetailModal
                    customer={snap.customers.find(item => item.code === detail.code) ?? null}
                    snap={snap}
                    onClose={() => setDetail(null)}
                />
            )}
        </div>
    );
}

/* ---------- 事件卡片 ---------- */

function EventCard({
    entry,
    snap,
    onOpenDetail,
}: {
    entry: SystemLogEntry;
    snap: Snapshot;
    onOpenDetail: (target: DetailTarget) => void;
}) {
    const meta = ACTION_META[entry.action];
    const first = entry.changes?.[0];
    // 明细惰性渲染：首次展开才创建字段节点（折叠态不预生成 DOM）
    const [expanded, setExpanded] = useState(false);
    const hasDetail = (entry.changes?.length ?? 0) > 0 || !!entry.reason;
    return (
        <li className="relative mb-2 rounded-card border border-line bg-surface px-4 py-3 shadow-xs transition hover:border-primary-border/60">
            {/* 时间线圆点（动作色） */}
            <span
                aria-hidden="true"
                className={`absolute top-5 -left-[27px] h-2.5 w-2.5 rounded-full ring-3 ring-surface ${dotToneOf(entry.action)}`}
            />
            <div className="flex items-start gap-3">
                <span className={`grid h-8.5 w-8.5 shrink-0 place-items-center rounded-btn ${meta.tone}`}>
                    <Icon name={meta.icon} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                    <h3 className="flex flex-wrap items-center gap-1.5 text-14 leading-6 font-semibold text-ink">
                        <span>{entry.actor.name}</span>
                        {/* 动作词不染色（含「了」）：动作语义由图标方块与时间线圆点承载，标题保持纯文本 */}
                        <span>{meta.verb}</span>
                        {objectOf(entry) && <span>{objectOf(entry)}</span>}
                        <span className="tnum ml-auto pl-2 text-12 font-normal text-muted">
                            {beijingDateTimeOf(entry.occurredAt)}
                        </span>
                    </h3>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-12 text-muted">
                        <span>{ROLE_LABELS[entry.actor.role] ?? entry.actor.role}</span>
                        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-placeholder" />
                        <span>{DOMAIN_LABELS[entry.domain]}</span>
                    </div>
                </div>
            </div>
            {/* 目标行与首条变更合并为一行：域 chip + 编号 + 名称 + 预览 */}
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-11.5">
                <span className="rounded-md bg-soft px-1.5 py-0.5 text-11 font-semibold text-td-strong">
                    {DOMAIN_CHIPS[entry.domain]}
                </span>
                {/* 编号可点击弹详情：库存调整无专属详情视图；目标已删除（快照无行）时降级为纯文本 */}
                {entry.action !== "adjust" && hasLiveEntity(entry.domain, entry.targetCode, snap) ? (
                    <button
                        type="button"
                        onClick={() => onOpenDetail({ kind: entry.domain, code: entry.targetCode })}
                        className="tnum cursor-pointer text-12 font-bold text-primary-strong transition hover:underline"
                    >
                        {entry.targetCode}
                    </button>
                ) : (
                    <span className="tnum text-12 font-bold text-primary-strong">{entry.targetCode}</span>
                )}
                {entry.targetName && <span className="text-12 text-td">{entry.targetName}</span>}
                {first && (
                    <>
                        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-placeholder" />
                        <span className="text-12 text-muted">{first.label}</span>
                        {first.before !== null && (
                            <span className="rounded-md bg-soft px-1.5 py-0.5 text-12 text-muted line-through">
                                {first.before}
                            </span>
                        )}
                        {first.before !== null && <Icon name="chevron-right" size={13} className="text-placeholder" />}
                        <FirstChangeAfter entry={entry} change={first} snap={snap} onOpenDetail={onOpenDetail} />
                    </>
                )}
            </div>
            {hasDetail && (
                <div className="mt-1.5 border-t border-line pl-11.5">
                    <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setExpanded(value => !value)}
                        className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 text-12 font-semibold text-primary-strong"
                    >
                        查看变更详情
                        <Icon
                            name="chevron-down"
                            size={14}
                            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                        />
                    </button>
                    {expanded && (
                        <div className="pb-2">
                            {(entry.changes?.length ?? 0) > 0 && (
                                <p className="mb-1 text-11 font-semibold tracking-wide text-subtle">本次记录</p>
                            )}
                            {entry.changes?.map(change => (
                                <div
                                    key={change.label}
                                    className="flex items-start gap-3 border-b border-line/60 py-1.5 text-12 leading-6 last:border-b-0"
                                >
                                    <span className="min-w-20 shrink-0 text-muted">{change.label}</span>
                                    <span className="wrap-break-word text-td">
                                        {/* 新建类（before=null）直接显示值，不再重复「新建记录」前缀：
                                            新建语境已由卡片标题交代 */}
                                        {change.before === null ? null : (
                                            <>
                                                {change.before} <span aria-hidden="true">→</span>{" "}
                                            </>
                                        )}
                                        <span
                                            className={
                                                change.before === null
                                                    ? "font-semibold"
                                                    : `font-semibold ${textToneOf(entry.action)}`
                                            }
                                        >
                                            <LinkedChangeValue
                                                change={change}
                                                snap={snap}
                                                onOpenDetail={onOpenDetail}
                                            />
                                        </span>
                                    </span>
                                </div>
                            ))}
                            {entry.reason && (
                                <p className="mt-1.5 rounded-btn bg-soft px-3 py-2 text-12 leading-6 text-td">
                                    <strong className="font-semibold">操作原因：</strong>
                                    {entry.reason}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </li>
    );
}

/* ---------- 语义值链接（BOM 编码 / 订单号 → 对应详情弹窗；目标已删除时降级纯文本） ---------- */

/** 目标行首条变更的新值 chip */
function FirstChangeAfter({
    entry,
    change,
    snap,
    onOpenDetail,
}: {
    entry: SystemLogEntry;
    change: SystemLogChange;
    snap: Snapshot;
    onOpenDetail: (target: DetailTarget) => void;
}) {
    const linkDomain = linkDomainOf(change.key);
    const chipClass = `rounded-md px-1.5 py-0.5 text-12 font-semibold ${chipToneOf(entry.action)}`;
    if (!linkDomain || !change.after || !hasLiveEntity(linkDomain, change.after, snap)) {
        return <span className={chipClass}>{change.after ?? "—"}</span>;
    }
    return (
        <button
            type="button"
            onClick={() => onOpenDetail({ kind: linkDomain, code: change.after! })}
            className={`cursor-pointer transition hover:underline ${chipClass}`}
        >
            {change.after}
        </button>
    );
}

/** 明细行值 */
function LinkedChangeValue({
    change,
    snap,
    onOpenDetail,
}: {
    change: SystemLogChange;
    snap: Snapshot;
    onOpenDetail: (target: DetailTarget) => void;
}) {
    const linkDomain = linkDomainOf(change.key);
    if (!linkDomain || !change.after || !hasLiveEntity(linkDomain, change.after, snap)) {
        return <>{change.after ?? "—"}</>;
    }
    return (
        <button
            type="button"
            onClick={() => onOpenDetail({ kind: linkDomain, code: change.after! })}
            className="cursor-pointer transition hover:underline"
        >
            {change.after}
        </button>
    );
}

/* 动作 → 三档色类（圆点 / 文字 / 新值 chip），全部走语义令牌 */
function dotToneOf(action: SystemLogAction): string {
    const map: Record<SystemLogAction, string> = {
        create: "bg-success",
        edit: "bg-primary",
        transfer: "bg-teal",
        archive: "bg-violet",
        delete: "bg-danger",
        void: "bg-warning",
        ship: "bg-teal",
        adjust: "bg-primary",
    };
    return map[action];
}

function textToneOf(action: SystemLogAction): string {
    const map: Record<SystemLogAction, string> = {
        create: "text-success",
        edit: "text-primary-strong",
        transfer: "text-teal",
        archive: "text-violet",
        delete: "text-danger",
        void: "text-warning",
        ship: "text-teal",
        adjust: "text-primary-strong",
    };
    return map[action];
}

function chipToneOf(action: SystemLogAction): string {
    const map: Record<SystemLogAction, string> = {
        create: "bg-success-soft text-success",
        edit: "bg-primary-soft text-primary-strong",
        transfer: "bg-teal-soft text-teal",
        archive: "bg-violet-soft text-violet",
        delete: "bg-danger-soft text-danger",
        void: "bg-warning-soft text-warning",
        ship: "bg-teal-soft text-teal",
        adjust: "bg-primary-soft text-primary-strong",
    };
    return map[action];
}

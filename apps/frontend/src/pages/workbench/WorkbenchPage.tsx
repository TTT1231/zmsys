import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router";
import { useApp } from "@/context/AppContext";
import { EMPTY_SNAPSHOT, dailyTrend, readyToShip, stockGapList } from "@/data/views";
import { useWbSnapshot } from "@/data/queries";
import { LoadingOverlay, useDelayedFlag } from "@/components/ui/LoadingOverlay";
import { num } from "@/lib/format";
import { todayIso } from "@/lib/date";
import { Icon } from "@/lib/icons";
import { Button } from "@/components/ui/Badge";
import { OrderTaskCard, ListState, RecordCard } from "@/components/ui/MobileList";
const EChart = lazy(() =>
    import("@/components/charts/EChart").then(module => ({
        default: module.EChart,
    })),
);
import { buildDailyTrendOption } from "@/components/charts/options";
import { InboundModal } from "@/pages/inbound/InboundPage";
import { OutboundModal } from "@/pages/outbound/OutboundPage";
import { OrderDetailModal } from "@/pages/orders/OrdersPage";
import { LedgerDialog } from "./dialogs";

type TaskFilter = "priority" | "ready" | "gap" | "all";

export function WorkbenchPage() {
    const navigate = useNavigate();
    const { role, can } = useApp();
    const { data, isLoading, isFetching } = useWbSnapshot();
    // 顶栏全局刷新时此处同步出现保留式遮罩(200ms 内完成不闪现)
    const overlay = useDelayedFlag(isFetching && !isLoading);
    const snap = data ?? EMPTY_SNAPSHOT;
    const [filter, setFilter] = useState<TaskFilter>(() => (role === "warehouse" ? "ready" : "priority"));
    const [limit, setLimit] = useState(5);
    const [ship, setShip] = useState<string | null>(null);
    const [inbound, setInbound] = useState<string | null>(null);
    const [detailNo, setDetailNo] = useState<string | null>(null);
    const [ledger, setLedger] = useState<"inbound" | "outbound" | null>(null);
    const [days, setDays] = useState(7);
    const [showTrend, setShowTrend] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
    // 工作台按钮按登录角色的授权判断
    const canRegister = can("outbound:ship");
    const canInbound = can("inbound:register");
    const canCreateOrder = can("orders:create");
    const orders = snap.orders;
    const rows = readyToShip(snap);
    const ready = rows.filter(row => row.maxShip > 0);
    const priority = rows.filter(row => row.overdue || row.maxShip < row.remaining);
    const gaps = stockGapList(snap);
    const tasks = filter === "ready" ? ready : filter === "priority" ? priority : rows;
    const recentIn = [...snap.inboundLedger].sort((a, b) => b.no.localeCompare(a.no));
    const recentOut = [...snap.outboundLedger].sort((a, b) => b.no.localeCompare(a.no));
    const anchor = todayIso();
    const todayIn = recentIn.filter(row => row.date === anchor);
    const todayOut = recentOut.filter(row => row.date === anchor);
    const pickFilter = (next: TaskFilter) => {
        setFilter(next);
        setLimit(5);
    };
    return (
        <div className="relative flex flex-col gap-4 lg:gap-6">
            {overlay && <LoadingOverlay />}
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="hidden text-13 text-muted lg:block">{anchor} · 今日工作</p>
                    <h1 className="text-24 font-bold tracking-tight lg:text-30">
                        {role === "warehouse" ? "收发工作台" : role === "sales" ? "销售工作台" : "今日工作台"}
                    </h1>
                </div>
                <div className="flex gap-2">
                    {role === "warehouse" ? (
                        <>
                            {canRegister && (
                                <Button variant="secondary" icon="truck" onClick={() => setShip("")}>
                                    发货
                                </Button>
                            )}
                            {canInbound && (
                                <Button icon="inbound" onClick={() => setInbound("")}>
                                    入库
                                </Button>
                            )}
                        </>
                    ) : (
                        canCreateOrder && (
                            <Button icon="plus" onClick={() => navigate("/orders?new=order")}>
                                新建订单
                            </Button>
                        )
                    )}
                </div>
            </div>
            <button
                type="button"
                onClick={() => navigate("/search")}
                className="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-white px-4 text-left text-15 text-muted lg:hidden"
            >
                <Icon name="search" size={19} />
                搜索订单、客户、产品
            </button>
            <div className="grid grid-cols-3 overflow-hidden rounded-card border border-line bg-white divide-x divide-line">
                {[
                    { label: "需关注", value: priority.length, target: "priority" },
                    { label: "可发货", value: ready.length, target: "ready" },
                    { label: "缺货产品", value: gaps.length, target: "gap" },
                ].map(item => (
                    <button
                        type="button"
                        key={item.target}
                        aria-pressed={filter === item.target}
                        onClick={() => pickFilter(item.target as TaskFilter)}
                        className={`px-2 py-3 text-center lg:py-5 ${filter === item.target ? "bg-primary-soft/60" : ""}`}
                    >
                        <span className="block text-12 text-muted lg:text-14">{item.label}</span>
                        <strong
                            className={`tnum mt-1 block text-24 font-semibold lg:text-30 ${filter === item.target ? "text-primary" : "text-ink"}`}
                        >
                            {item.value}
                        </strong>
                    </button>
                ))}
            </div>
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                <section className="min-w-0">
                    <div className="mb-3 flex items-center justify-between gap-2">
                        <h2 className="text-17 font-semibold">
                            {filter === "gap"
                                ? "需要补充的库存"
                                : filter === "ready"
                                  ? "现在可以发货"
                                  : filter === "all"
                                    ? "待交付订单"
                                    : "优先处理"}
                        </h2>
                        <button
                            type="button"
                            className="px-2 text-13 text-primary"
                            onClick={() => {
                                pickFilter(filter === "all" ? "priority" : "all");
                            }}
                        >
                            {" "}
                            {filter === "all" ? "只看需关注" : `全部待交 ${rows.length}`}
                        </button>
                    </div>
                    {filter === "gap" ? (
                        <div className="grid gap-3">
                            <ListState loading={isLoading} empty={!gaps.length}>
                                {gaps.slice(0, limit).map(gap => (
                                    <RecordCard
                                        key={gap.bomCode}
                                        title={snap.boms.find(bom => bom.code === gap.bomCode)?.name || gap.bomCode}
                                        subtitle={gap.bomCode}
                                        badge={
                                            <span className="text-13 font-semibold text-warning">
                                                缺 {num(gap.gapQty)} 件
                                            </span>
                                        }
                                        actions={
                                            <>
                                                <Button
                                                    variant="secondary"
                                                    onClick={() =>
                                                        navigate(`/orders?q=${encodeURIComponent(gap.bomCode)}`)
                                                    }
                                                >
                                                    相关订单
                                                </Button>
                                                {canInbound && (
                                                    <Button onClick={() => setInbound(gap.bomCode)}>登记入库</Button>
                                                )}
                                            </>
                                        }
                                    >
                                        <p>{snap.boms.find(bom => bom.code === gap.bomCode)?.spec}</p>
                                        <p className="mt-2 text-13 text-muted">
                                            影响 {gap.orderCount} 张订单 · 最早交期 {gap.earliestDate}
                                        </p>
                                        <p className="mt-1 text-13">
                                            需求 {num(gap.demandQty)} · 库存 {num(gap.stockQty)} 件
                                        </p>
                                    </RecordCard>
                                ))}
                            </ListState>
                        </div>
                    ) : (
                        <div className="grid gap-3">
                            <ListState loading={isLoading} empty={!tasks.length}>
                                {tasks.slice(0, limit).map(row => {
                                    const order = orders.find(item => item.orderNo === row.orderNo);
                                    return (
                                        order && (
                                            <OrderTaskCard
                                                key={row.orderNo}
                                                order={order}
                                                snap={snap}
                                                onDetail={() => setDetailNo(row.orderNo)}
                                                onShip={canRegister ? () => setShip(row.orderNo) : undefined}
                                            />
                                        )
                                    );
                                })}
                            </ListState>
                        </div>
                    )}
                    {(filter === "gap" ? gaps.length : tasks.length) > limit && (
                        <Button
                            variant="secondary"
                            className="mt-3 w-full"
                            onClick={() => setLimit(value => value + 10)}
                        >
                            加载更多（还有 {(filter === "gap" ? gaps.length : tasks.length) - limit} 条）
                        </Button>
                    )}
                </section>
                <div className="flex min-w-0 flex-col gap-5">
                    <section className="rounded-panel border border-line bg-white p-4 lg:p-5">
                        <h2 className="text-16 font-semibold">今日收发</h2>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                            {[
                                { kind: "inbound", label: "入库", rows: todayIn },
                                { kind: "outbound", label: "出库", rows: todayOut },
                            ].map(item => (
                                <button
                                    type="button"
                                    key={item.kind}
                                    onClick={() => setLedger(item.kind as "inbound" | "outbound")}
                                    className="rounded-xl bg-canvas p-3 text-left"
                                >
                                    <span className="text-13 text-muted">
                                        {item.label} {item.rows.length} 笔
                                    </span>
                                    <strong className="mt-1 block text-22 font-semibold">
                                        {num(item.rows.reduce((sum, row) => sum + row.qty, 0))}
                                        <span className="ml-1 text-12 font-normal text-muted">件</span>
                                    </strong>
                                </button>
                            ))}
                        </div>
                    </section>
                    <section className="rounded-panel border border-line bg-white p-4 lg:p-5">
                        <div className="flex items-center justify-between">
                            <h2 className="text-16 font-semibold">最近登记</h2>
                            <button
                                type="button"
                                onClick={() => navigate("/outbound")}
                                className="text-13 text-primary"
                            >
                                查看台账
                            </button>
                        </div>
                        <div className="mt-2 divide-y divide-line">
                            {[
                                ...recentIn.map(row => ({ ...row, kind: "入库" })),
                                ...recentOut.map(row => ({ ...row, kind: "出库" })),
                            ]
                                .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
                                .slice(0, 4)
                                .map(row => (
                                    <div key={row.no} className="flex items-center justify-between gap-3 py-3">
                                        <div className="min-w-0">
                                            <p className="text-14 font-medium">
                                                {row.kind} · {row.bomCode}
                                            </p>
                                            <p className="mt-1 text-12 text-muted">
                                                {row.date} {row.time} · {row.no}
                                            </p>
                                        </div>
                                        <strong className="shrink-0 text-14">{num(row.qty)} 件</strong>
                                    </div>
                                ))}
                        </div>
                    </section>
                    <section className="order-first rounded-panel border border-line bg-white p-4 lg:p-5 lg:order-first">
                        <button
                            type="button"
                            aria-expanded={showTrend}
                            onClick={() => setShowTrend(value => !value)}
                            className="flex w-full items-center justify-between text-16 font-semibold"
                        >
                            收发趋势{" "}
                            <span className="text-12 font-normal text-muted">{showTrend ? "收起" : "展开分析"}</span>
                        </button>
                        {showTrend && (
                            <>
                                <div className="mt-3 flex justify-end">
                                    <select
                                        aria-label="趋势日期范围"
                                        value={days}
                                        onChange={event => setDays(Number(event.target.value))}
                                        className="rounded-btn border border-line p-2"
                                    >
                                        {[7, 14, 30].map(value => (
                                            <option key={value} value={value}>
                                                最近 {value} 天
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <Suspense fallback={<p className="py-16 text-center text-muted">正在加载趋势…</p>}>
                                    <EChart option={buildDailyTrendOption(dailyTrend(snap, days))} height={260} />
                                </Suspense>
                            </>
                        )}
                    </section>
                </div>
            </div>
            {ship !== null && <OutboundModal open initialOrderNo={ship} onClose={() => setShip(null)} />}
            {inbound !== null && <InboundModal open initialBomCode={inbound} onClose={() => setInbound(null)} />}
            <OrderDetailModal
                order={orders.find(order => order.orderNo === detailNo) ?? null}
                snap={snap}
                onClose={() => setDetailNo(null)}
                onShip={
                    canRegister
                        ? () => {
                              setShip(detailNo);
                              setDetailNo(null);
                          }
                        : undefined
                }
            />
            <LedgerDialog
                open={ledger !== null}
                kind={ledger ?? "inbound"}
                snap={snap}
                onClose={() => setLedger(null)}
            />
        </div>
    );
}

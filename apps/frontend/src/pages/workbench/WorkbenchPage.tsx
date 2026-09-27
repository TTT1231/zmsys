/* 超级管理员经营总览：图表看全貌，明细弹窗查看产品、客户订单和交期风险。 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "@/context/useApp";
import { PageHeading } from "@/components/ui/PageHeading";
import { Modal } from "@/components/ui/Modal";
import { EmptyRow } from "@/components/ui/EmptyRow";
import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { PageLoading } from "@/components/ui/PageLoading";
import { useDelayedFlag } from "@/components/ui/useDelayedFlag";
import { Icon } from "@/lib/icons";
import { num } from "@/lib/format";
import { addDays } from "@/lib/date";
import {
    customerRanking,
    demandQty,
    openQty,
    summarizeWorkbench,
    workbenchRisks,
    type RankingMetric,
    type WorkbenchOrder,
} from "@/data/workbench";
import { useWorkbenchData } from "./useWorkbenchData";
import { WorkbenchTrend, workbenchSelectClass } from "./WorkbenchTrend";
import { CustomerRankingChart, ProductProgressChart } from "./WorkbenchCharts";

type Detail =
    | { kind: "products"; category?: string }
    | { kind: "customers" }
    | {
          kind: "orders";
          title: string;
          orders: WorkbenchOrder[];
          back: { kind: "products"; category?: string } | { kind: "customers" };
      }
    | { kind: "risk"; risk: "overdue" | "upcoming" };
const percent = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);
/* 明细弹窗表：data-table 基线（见 index.css @layer components）给出 th/td 内距、行线与悬停 */
const tableClass = "data-table w-full min-w-150 text-left text-14 tnum";

function Metric({
    title,
    value,
    unit,
    icon,
    children,
    featured = false,
}: {
    title: string;
    value: number;
    unit: string;
    icon: string;
    children: ReactNode;
    featured?: boolean;
}) {
    return (
        <section
            className={`rounded-panel border p-4 shadow-card sm:p-5 ${featured ? "border-primary-border bg-linear-to-br from-primary-soft via-surface to-surface" : "border-line bg-surface"}`}
        >
            <div className="flex items-center justify-between">
                <h2 className="text-14 font-medium text-td-strong">{title}</h2>
                {/* 图标芯片统一主色族：featured 实底、其余浅底，避免「一张实底 + 三张灰线性」的风格漂移 */}
                <span
                    className={`hidden h-9 w-9 items-center justify-center rounded-xl sm:flex ${featured ? "bg-primary text-white" : "bg-primary-soft text-primary-strong"}`}
                >
                    <Icon name={icon} size={18} />
                </span>
            </div>
            <p className="mt-3 flex items-baseline gap-2">
                <span className="text-22 leading-tight font-semibold tracking-tight tabular-nums text-ink sm:text-30">
                    {num(value)}
                </span>
                <span className="text-14 text-muted">{unit}</span>
            </p>
            <div className="mt-4 border-t border-line/70 pt-3 text-14 text-muted">{children}</div>
        </section>
    );
}

function OwnerWorkbench() {
    const { data, isLoading, isFetching } = useWorkbenchData();
    const [period, setPeriod] = useState("all");
    const [customStart, setCustomStart] = useState(addDays(data.asOf, -29));
    const [customEnd, setCustomEnd] = useState(data.asOf);
    const [metric, setMetric] = useState<RankingMetric>("qty");
    const [detail, setDetail] = useState<Detail | null>(null);
    useEffect(() => {
        // 内容钻取会移除刚点击的按钮，保持焦点在弹窗内。
        if (detail) document.querySelector<HTMLElement>('[role="dialog"]')?.focus();
    }, [detail]);
    const start =
        period === "all"
            ? "0000-01-01"
            : period === "year"
              ? `${data.asOf.slice(0, 4)}-01-01`
              : period === "month"
                ? `${data.asOf.slice(0, 7)}-01`
                : customStart;
    const end = period === "custom" ? customEnd : data.asOf;
    const validRange = !!start && !!end && start <= end && end <= data.asOf;
    const summary = useMemo(
        () => summarizeWorkbench(data, validRange ? { start, end } : { start: "9999-01-01", end: "0000-01-01" }),
        [data, start, end, validRange],
    );
    const risks = useMemo(() => workbenchRisks(data), [data]);
    // 首载出替换式占位,后台刷新出保留式遮罩(200ms 内完成不闪现)
    const overlay = useDelayedFlag(isFetching && !isLoading);
    if (isLoading) return <PageLoading className="min-h-96" />;
    const overdue = risks.filter(order => order.kind === "overdue");
    const upcoming = risks.filter(order => order.kind === "upcoming");
    const ranking = customerRanking(summary.orders, metric);
    const periodLabel =
        period === "all" ? "累计" : period === "year" ? "今年" : period === "month" ? "本月" : "所选期间";
    const productName = (code: string) => {
        const product = data.products.find(item => item.code === code);
        return product ? `${product.category} / ${product.model}` : code;
    };
    const showCustomer = (code: string) => {
        const orders = summary.orders.filter(order => order.customerCode === code);
        setDetail({
            kind: "orders",
            title: `${orders[0]?.customer ?? "客户"} · 订单明细`,
            orders,
            back: { kind: "customers" },
        });
    };
    const detailTitle = !detail
        ? "明细"
        : detail.kind === "products"
          ? `${detail.category ?? "全部品类"} · 型号与规格`
          : detail.kind === "customers"
            ? "客户 TOP 20 · 排行明细"
            : detail.kind === "orders"
              ? detail.title
              : detail.risk === "overdue"
                ? "已逾期未发完的订单"
                : "未来 7 天到期且缺货的订单";

    return (
        <div className="relative flex flex-col gap-5 pb-4">
            {overlay && <LoadingOverlay />}
            <PageHeading
                eyebrow="BUSINESS OVERVIEW"
                title="经营总览"
                actions={
                    <span className="flex items-center gap-1.5 text-14 text-muted">
                        <Icon name="calendar" size={15} />
                        截至 {data.asOf}
                    </span>
                }
            />
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-14 font-medium text-td">订单统计周期</span>
                <div
                    className="inline-flex rounded-btn border border-line bg-surface p-1"
                    role="group"
                    aria-label="订单统计周期"
                >
                    {[
                        ["all", "累计"],
                        ["year", "今年"],
                        ["month", "本月"],
                        ["custom", "自定义"],
                    ].map(([value, label]) => (
                        <button
                            key={value}
                            aria-pressed={period === value}
                            onClick={() => setPeriod(value)}
                            className={`min-h-9 rounded-md px-4 text-14 font-medium transition ${period === value ? "bg-primary-soft text-primary-strong" : "text-muted hover:bg-soft hover:text-ink"}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            {period === "custom" && (
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        aria-label="订单开始日期"
                        type="date"
                        className={workbenchSelectClass}
                        value={customStart}
                        max={customEnd}
                        onChange={event => setCustomStart(event.target.value)}
                    />
                    <span className="text-muted">至</span>
                    <input
                        aria-label="订单结束日期"
                        type="date"
                        className={workbenchSelectClass}
                        value={customEnd}
                        min={customStart}
                        max={data.asOf}
                        onChange={event => setCustomEnd(event.target.value)}
                    />
                    {!validRange && (
                        <span role="alert" className="text-14 text-danger">
                            请选择不晚于今天的有效日期范围
                        </span>
                    )}
                </div>
            )}
            <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 xl:grid-cols-4">
                <Metric title="订单需求总量" value={summary.qty} unit={data.unit} icon="order" featured>
                    <span className="font-medium text-primary-strong">{num(summary.activeCount)} 笔有效订单</span>
                    <span className="mx-2 text-line-strong">/</span>含已完成与未完成
                </Metric>
                <Metric title="已发数量" value={summary.shipped} unit={data.unit} icon="check">
                    <span className="font-medium text-success">交付率 {percent(summary.shipped, summary.qty)}%</span>
                    <span className="mx-2 text-line-strong">/</span>
                    {summary.completed} 笔已完成
                </Metric>
                <Metric title="未发数量" value={summary.remaining} unit={data.unit} icon="cube">
                    {periodLabel}订单尚待交付的产品数量
                </Metric>
                <Metric title="逾期未完成订单" value={overdue.length} unit="笔" icon="alert">
                    <span className={overdue.length ? "font-medium text-danger" : "text-success"}>
                        {num(overdue.reduce((sum, order) => sum + order.remaining, 0))} {data.unit}待交付
                    </span>
                    <span className="ml-2">截至今日</span>
                </Metric>
            </div>
            <section
                className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-warning/40 bg-warning-soft px-5 py-3"
                aria-label="交付风险提醒"
            >
                <div className="flex items-center gap-2 text-warning">
                    <Icon name="alert" size={18} />
                    <h2 className="text-14 font-semibold">交付风险</h2>
                </div>
                <button
                    onClick={() => setDetail({ kind: "risk", risk: "overdue" })}
                    className="flex min-h-10 items-center gap-2 text-14 text-td hover:text-danger"
                >
                    已逾期未发完
                    <span className="rounded-md bg-surface px-2 py-0.5 font-semibold tabular-nums text-danger">
                        {overdue.length}
                    </span>
                    笔<Icon name="chevron-right" size={14} />
                </button>
                <span className="hidden h-5 w-px bg-warning/30 sm:block" />
                <button
                    onClick={() => setDetail({ kind: "risk", risk: "upcoming" })}
                    className="flex min-h-10 items-center gap-2 text-14 text-td hover:text-warning"
                >
                    未来 7 天到期且缺货
                    <span className="rounded-md bg-surface px-2 py-0.5 font-semibold tabular-nums text-warning">
                        {upcoming.length}
                    </span>
                    笔<Icon name="chevron-right" size={14} />
                </button>
            </section>
            <ProductProgressChart
                categories={summary.categories}
                periodLabel={periodLabel}
                onDetails={category => setDetail({ kind: "products", category })}
            />
            <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
                <WorkbenchTrend data={data} />
                <CustomerRankingChart
                    customers={ranking}
                    metric={metric}
                    onMetric={setMetric}
                    periodLabel={periodLabel}
                    onCustomer={showCustomer}
                    onDetails={() => setDetail({ kind: "customers" })}
                />
            </div>

            <Modal
                open={detail !== null}
                onClose={() => setDetail(null)}
                title={detailTitle}
                footer={
                    detail?.kind === "orders" ? (
                        <button
                            className="flex min-h-10 items-center gap-1.5 text-14 font-medium text-primary-strong hover:underline"
                            onClick={() => setDetail(detail.back)}
                        >
                            <Icon name="chevron-left" size={16} />
                            {detail.back.kind === "products" ? "返回产品明细" : "返回客户排行"}
                        </button>
                    ) : undefined
                }
                subtitle={
                    detail?.kind === "risk"
                        ? `截至 ${data.asOf} · 全部有效订单，按交期排序`
                        : `${periodLabel}下单 · 交付与库存截至 ${data.asOf} · 数量单位：${data.unit}`
                }
                width={980}
            >
                {detail?.kind === "products" && (
                    <>
                        <div className="overflow-x-auto">
                            <table className={tableClass}>
                                <caption className="sr-only">型号与BOM规格交付明细</caption>
                                <thead>
                                    <tr className="text-13 text-muted">
                                        {[
                                            "品类 / 型号 / 规格",
                                            "需求总量",
                                            "已发",
                                            "未发",
                                            "交付率",
                                            "当前库存",
                                            "当前缺口",
                                        ].map(label => (
                                            <th scope="col" key={label}>
                                                {label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {summary.categories
                                        .filter(category => !detail.category || category.name === detail.category)
                                        .flatMap(category =>
                                            category.children.map(product => (
                                                <tr key={product.code}>
                                                    <td>
                                                        <button
                                                            className="min-h-9 text-left font-medium text-primary-strong hover:underline"
                                                            onClick={() =>
                                                                setDetail({
                                                                    kind: "orders",
                                                                    back: {
                                                                        kind: "products",
                                                                        category: detail.category,
                                                                    },
                                                                    title: `${product.model} · 订单明细`,
                                                                    orders: summary.orders.filter(
                                                                        order => order.bomCode === product.code,
                                                                    ),
                                                                })
                                                            }
                                                        >
                                                            {product.category} / {product.model}
                                                        </button>
                                                        <p className="text-13 text-muted">{product.code}</p>
                                                        <p className="mt-1 text-13 text-muted">{product.spec}</p>
                                                    </td>
                                                    <td>{num(product.qty)}</td>
                                                    <td>{num(product.shipped)}</td>
                                                    <td>{num(product.remaining)}</td>
                                                    <td>
                                                        {product.qty
                                                            ? `${percent(product.shipped, product.qty)}%`
                                                            : "—"}
                                                    </td>
                                                    <td>{num(product.stock)}</td>
                                                    <td className={product.gap ? "text-warning" : "text-success"}>
                                                        {product.gap ? num(product.gap) : "充足"}
                                                    </td>
                                                </tr>
                                            )),
                                        )}
                                </tbody>
                            </table>
                        </div>
                        <p className="mt-4 text-14 text-muted">
                            点击型号查看订单。当前库存与缺口始终统计全部有效订单，不同 BOM 的库存不可互抵。
                        </p>
                    </>
                )}
                {detail?.kind === "customers" && (
                    <div className="overflow-x-auto">
                        <table className={tableClass}>
                            <caption className="sr-only">客户排行明细</caption>
                            <thead>
                                <tr>
                                    {["排名", "客户", "下单笔数", "订购数量", "已发", "未发"].map(label => (
                                        <th scope="col" key={label}>
                                            {label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {ranking.map((customer, index) => (
                                    <tr key={customer.code}>
                                        <td>{index + 1}</td>
                                        <td>
                                            <button
                                                onClick={() => showCustomer(customer.code)}
                                                className="min-h-9 text-left text-primary-strong hover:underline"
                                            >
                                                {customer.name}
                                            </button>
                                        </td>
                                        <td>{num(customer.count)}</td>
                                        <td>{num(customer.qty)}</td>
                                        <td>{num(customer.shipped)}</td>
                                        <td>{num(customer.remaining)}</td>
                                    </tr>
                                ))}
                                {!ranking.length && (
                                    <EmptyRow colSpan={6} description="所选期间暂无客户订单" imageSize={120} />
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
                {detail?.kind === "orders" && (
                    <div className="overflow-x-auto">
                        <table className={tableClass}>
                            <caption className="sr-only">订单交付明细</caption>
                            <thead>
                                <tr>
                                    {["订单 / 客户", "产品 / 交期", "需求数量", "已发", "未发"].map(label => (
                                        <th scope="col" key={label}>
                                            {label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {detail.orders.map(order => (
                                    <tr key={order.no}>
                                        <td>
                                            <span className="font-medium text-ink">{order.no}</span>
                                            {order.archived && <span className="ml-2 text-subtle">已归档</span>}
                                            <p className="mt-1 text-13 text-muted">{order.customer}</p>
                                        </td>
                                        <td>
                                            {productName(order.bomCode)}
                                            <p className="mt-1 text-13 text-muted">{order.due}</p>
                                        </td>
                                        <td>{num(demandQty(order))}</td>
                                        <td>{num(order.shipped)}</td>
                                        <td>{num(openQty(order))}</td>
                                    </tr>
                                ))}
                                {!detail.orders.length && (
                                    <EmptyRow colSpan={5} description="所选期间暂无订单" imageSize={120} />
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
                {detail?.kind === "risk" && (
                    <>
                        <div className="overflow-x-auto">
                            <table className={tableClass}>
                                <caption className="sr-only">交付风险订单明细</caption>
                                <thead>
                                    <tr className="text-13 text-muted">
                                        {["订单 / 客户", "产品", "交期", "未发数量", "备货缺口"].map(label => (
                                            <th scope="col" key={label}>
                                                {label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {risks
                                        .filter(order => order.kind === detail.risk)
                                        .map(order => (
                                            <tr key={order.no}>
                                                <td>
                                                    <span className="font-medium text-ink">{order.no}</span>
                                                    <p className="mt-1 text-13 text-muted">{order.customer}</p>
                                                </td>
                                                <td>{productName(order.bomCode)}</td>
                                                <td
                                                    className={`whitespace-nowrap ${order.kind === "overdue" ? "text-danger" : "text-warning"}`}
                                                >
                                                    {order.due}
                                                </td>
                                                <td>{num(order.remaining)}</td>
                                                <td className="text-warning">{num(order.gap)}</td>
                                            </tr>
                                        ))}
                                    {!risks.some(order => order.kind === detail.risk) && (
                                        <EmptyRow colSpan={5} description="当前没有此类交付风险" imageSize={120} />
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <p className="mt-4 text-14 text-muted">
                            共享库存按交期依次分配，缺口不重复使用库存；逾期订单即使库存充足，仍保留提醒。
                        </p>
                    </>
                )}
            </Modal>
        </div>
    );
}

export function WorkbenchPage() {
    const { role } = useApp();
    if (role === "super") return <OwnerWorkbench />;
    return (
        <section className="rounded-panel border border-dashed border-line-strong bg-surface px-6 py-16 text-center shadow-card">
            <h2 className="text-17 font-semibold text-ink">工作台建设中</h2>
            <p className="mx-auto mt-2 max-w-105 text-14 leading-relaxed text-muted">
                按角色定制的待办、收发与趋势概览将在此统一提供。期间可从左侧菜单进入销售订单、成品出入库等页面处理业务。
            </p>
        </section>
    );
}

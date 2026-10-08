import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkbenchRelations } from "@/api/workbench";
import { Button } from "@/components/ui/Button";
import { PageLoading } from "@/components/ui/PageLoading";
import { addDays, monthStartOf, todayIso } from "@/lib/date";
import { RELATION_TYPES, type RelationsData, type RelationStatus, type RelationType } from "@/data/relations";
import { useRelationChart } from "./useRelationChart";
import "./business-relations.css";

const EMPTY: RelationsData = {
    schemaVersion: 1,
    asOf: "",
    generatedAt: "",
    filters: { status: "open", start: null, end: null, types: [], orderNo: null, bomCode: null, customerCode: null },
    nodes: [],
    edges: [],
    counts: { open: 0, completed: 0, archived: 0, all: 0 },
    typeCounts: { bom: 0, customer: 0, order: 0, inbound: 0, outbound: 0, person: 0 },
    summary: { orderCount: 0, overdueOrderIds: [], quantitiesByUnit: [] },
};
const STATUSES: { key: RelationStatus; label: string; title: string }[] = [
    { key: "open", label: "进行中", title: "未完成且未归档的销售订单" },
    { key: "completed", label: "已完成", title: "累计有效出库已达到订单数量，包含已交满的归档订单" },
    { key: "archived", label: "已归档", title: "已归档销售订单，归档不等于已交满" },
    { key: "all", label: "全部", title: "全部销售订单及仅有入库的 BOM" },
];
const colorStyle = (type: RelationType): CSSProperties => ({ backgroundColor: `var(--relation-${type})` });

export function BusinessRelations() {
    const [status, setStatus] = useState<RelationStatus>("open");
    const [range, setRange] = useState(() => ({ start: addDays(todayIso(), -29), end: todayIso() }));
    const [draftRange, setDraftRange] = useState(range);
    const validRange = !draftRange.start || !draftRange.end || draftRange.start <= draftRange.end;
    const [enabled, setEnabled] = useState(() => new Set(RELATION_TYPES.map(t => t.key)));
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const types = useMemo(() => RELATION_TYPES.filter(t => enabled.has(t.key)).map(t => t.key), [enabled]);
    const query = useQuery({
        queryKey: ["workbench", "relations", status, range, types],
        queryFn: () => fetchWorkbenchRelations(status, range, types),
    });
    const data = query.data ?? EMPTY;
    const nodeMap = useMemo(() => new Map(data.nodes.map(n => [n.id, n])), [data]);
    const selected = data.nodes.find(n => n.id === selectedId);
    const chart = useRelationChart(containerRef, data.nodes, data.edges, selected?.id ?? null, setSelectedId);
    const related = selected ? data.edges.filter(e => e.source === selected.id || e.target === selected.id) : [];
    const applyRange = (next: { start: string; end: string }) => {
        setDraftRange(next);
        setRange(next);
        setSelectedId(null);
    };

    return (
        <section
            className="relation-board rounded-panel border border-line bg-surface"
            aria-labelledby="relations-title"
            onKeyDown={e => {
                if (e.key === "Escape") setSelectedId(null);
            }}
        >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                <h1 id="relations-title" className="text-17 font-semibold text-ink">
                    业务关系图
                </h1>
                <div className="flex flex-wrap items-center gap-2">
                    <div
                        className="flex max-w-full flex-wrap rounded-btn bg-soft p-1"
                        role="group"
                        aria-label="订单状态范围"
                    >
                        {STATUSES.map(item => (
                            <Button
                                key={item.key}
                                variant="ghost"
                                size="sm"
                                aria-pressed={status === item.key}
                                title={item.title}
                                className={`gap-1 px-1.5 text-12 whitespace-nowrap sm:px-2.5 ${status === item.key ? "bg-surface text-primary-strong shadow-sm" : ""}`}
                                onClick={() => {
                                    setSelectedId(null);
                                    setStatus(item.key);
                                }}
                            >
                                {item.label}
                                <span className="rounded-md bg-primary-soft px-1.5 text-11 text-primary-strong tnum">
                                    {data.counts[item.key]}
                                </span>
                            </Button>
                        ))}
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon="refresh"
                        onClick={chart.reset}
                        disabled={query.isLoading || !data.nodes.length}
                    >
                        重新布局
                    </Button>
                </div>
            </header>
            <form
                className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3"
                onSubmit={e => {
                    e.preventDefault();
                    if (validRange) applyRange(draftRange);
                }}
            >
                <span className="text-12 text-muted">业务日期</span>
                <div className="flex flex-wrap items-center gap-1">
                    {[
                        { label: "全部时间", start: "", end: "" },
                        { label: "近30天", start: addDays(todayIso(), -29), end: todayIso() },
                        { label: "本月", start: monthStartOf(todayIso()), end: todayIso() },
                    ].map(item => (
                        <Button
                            key={item.label}
                            variant="ghost"
                            size="sm"
                            className={`px-2 text-12 ${range.start === item.start && range.end === item.end ? "bg-primary-soft text-primary-strong" : ""}`}
                            aria-pressed={range.start === item.start && range.end === item.end}
                            onClick={() => applyRange({ start: item.start, end: item.end })}
                        >
                            {item.label}
                        </Button>
                    ))}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-12 text-muted">
                        从
                        <input
                            type="date"
                            aria-label="业务开始日期"
                            className="relation-date rounded-input border border-line bg-surface px-2 text-12 text-ink"
                            value={draftRange.start}
                            onChange={e => setDraftRange(current => ({ ...current, start: e.target.value }))}
                        />
                    </label>
                    <label className="flex items-center gap-2 text-12 text-muted">
                        至
                        <input
                            type="date"
                            aria-label="业务结束日期"
                            className="relation-date rounded-input border border-line bg-surface px-2 text-12 text-ink"
                            value={draftRange.end}
                            onChange={e => setDraftRange(current => ({ ...current, end: e.target.value }))}
                        />
                    </label>
                    <Button type="submit" variant="secondary" size="sm" className="px-3 text-12" disabled={!validRange}>
                        筛选
                    </Button>
                </div>
                {!validRange && (
                    <p className="text-12 text-danger" role="alert">
                        开始日期不能晚于结束日期
                    </p>
                )}
                <p className="w-full text-11 text-muted">按业务日期筛选订单和出入库；保留期间出库引用的历史订单。</p>
            </form>
            <div className="relation-stage">
                <div
                    ref={containerRef}
                    className="relation-canvas"
                    tabIndex={0}
                    role="img"
                    aria-label="订单、客户、BOM、入库、出库和人员关系图。点击节点查看详情，拖动节点或画布，滚轮缩放。可用下方选择器选中节点，在画布使用方向键移动节点、加减键缩放、Home 适应画布、Escape 关闭详情。"
                />
                {query.isLoading ? (
                    <div className="relation-message">
                        <PageLoading className="min-h-80" />
                    </div>
                ) : query.isError ? (
                    <div className="relation-message" role="alert">
                        <p className="text-14 text-muted">暂时无法加载关系图</p>
                        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
                            重试
                        </Button>
                    </div>
                ) : data.nodes.length === 0 ? (
                    <div className="relation-message">
                        <p className="text-14 text-muted">
                            {enabled.size === 0 ? "请选择节点类型" : "当前日期和状态下暂无业务关系"}
                        </p>
                        {enabled.size === 0 ? (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setEnabled(new Set(RELATION_TYPES.map(t => t.key)))}
                            >
                                显示全部类型
                            </Button>
                        ) : status !== "all" && data.counts.all > 0 ? (
                            <Button variant="secondary" size="sm" onClick={() => setStatus("all")}>
                                查看全部订单
                            </Button>
                        ) : null}
                    </div>
                ) : (
                    <>
                        <p className="relation-hint text-11 text-muted">拖动节点或画布 · 滚轮缩放 · 点击查看关联</p>
                        <div
                            className="relation-tools rounded-btn border border-line bg-surface shadow-card"
                            aria-label="画布控制"
                        >
                            <Button
                                iconOnly
                                icon="plus"
                                aria-label="放大关系图"
                                title="放大"
                                onClick={() => chart.zoomBy(1.2)}
                            />
                            <span className="text-center text-11 text-muted tnum">{Math.round(chart.zoom * 100)}%</span>
                            <Button iconOnly aria-label="缩小关系图" title="缩小" onClick={() => chart.zoomBy(1 / 1.2)}>
                                <span aria-hidden="true" className="text-20">
                                    −
                                </span>
                            </Button>
                            <Button
                                iconOnly
                                icon="maximize"
                                aria-label="适应画布"
                                title="适应画布"
                                onClick={chart.fit}
                            />
                        </div>
                    </>
                )}
                {selected && (
                    <aside
                        className="relation-details rounded-card border border-line bg-surface shadow-card"
                        aria-label="节点信息"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 text-12 text-muted">
                                <i className="relation-dot" style={colorStyle(selected.type)} />
                                {RELATION_TYPES.find(t => t.key === selected.type)?.name}
                            </span>
                            <Button
                                iconOnly
                                icon="close"
                                className="size-8"
                                aria-label="关闭节点信息"
                                onClick={() => setSelectedId(null)}
                            />
                        </div>
                        <h2 className="mt-1 mb-4 text-17 font-semibold wrap-anywhere text-ink">{selected.name}</h2>
                        <dl className="flex flex-col gap-3">
                            {Object.entries(selected.properties).map(([label, value]) => (
                                <div key={label} className="flex justify-between gap-4 text-12">
                                    <dt className="shrink-0 text-muted">{label}</dt>
                                    <dd className="text-right wrap-anywhere text-td-strong">{value}</dd>
                                </div>
                            ))}
                        </dl>
                        {related.length > 0 && (
                            <div className="mt-4 flex flex-col gap-1 border-t border-line pt-2">
                                {related.map((edge, i) => {
                                    const other = nodeMap.get(edge.source === selected.id ? edge.target : edge.source)!;
                                    return (
                                        <Button
                                            key={`${other.id}:${i}`}
                                            variant="ghost"
                                            size="sm"
                                            className="justify-between gap-3 px-1 text-left text-12"
                                            onClick={() => setSelectedId(other.id)}
                                        >
                                            <span className="min-w-0 truncate">{other.name}</span>
                                            <span className="shrink-0 text-11 text-muted">
                                                {edge.relation} {edge.source === selected.id ? "→" : "←"}
                                            </span>
                                        </Button>
                                    );
                                })}
                            </div>
                        )}
                    </aside>
                )}
            </div>
            <footer className="relation-footer border-t border-line px-5 py-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1" role="group" aria-label="节点类型">
                    {RELATION_TYPES.map(type => (
                        <button
                            key={type.key}
                            type="button"
                            className="relation-legend"
                            aria-pressed={enabled.has(type.key)}
                            onClick={() => {
                                setEnabled(current => {
                                    const next = new Set(current);
                                    if (next.has(type.key)) next.delete(type.key);
                                    else next.add(type.key);
                                    return next;
                                });
                                setSelectedId(null);
                            }}
                        >
                            <i className="relation-dot" style={colorStyle(type.key)} />
                            <span>{type.name}</span>
                            <span className="text-11 text-muted tnum">{data.typeCounts[type.key]}</span>
                        </button>
                    ))}
                </div>
                <label className="flex min-w-0 items-center gap-2 text-12 text-muted">
                    选择节点
                    <select
                        className="relation-select rounded-input border border-line bg-surface px-2 text-12 text-ink"
                        value={selected?.id ?? ""}
                        onChange={e => setSelectedId(e.target.value || null)}
                        disabled={!data.nodes.length || query.isLoading}
                    >
                        <option value="">查看节点详情</option>
                        {RELATION_TYPES.map(t => (
                            <optgroup key={t.key} label={t.name}>
                                {data.nodes
                                    .filter(n => n.type === t.key)
                                    .map(n => (
                                        <option key={n.id} value={n.id}>
                                            {n.name}
                                        </option>
                                    ))}
                            </optgroup>
                        ))}
                    </select>
                </label>
                <span className="sr-only" role="status">
                    {STATUSES.find(item => item.key === status)?.label}订单 {data.counts[status]} 笔，
                    {data.nodes.length} 个节点，{data.edges.length} 条关系。{selected ? `已选择 ${selected.name}` : ""}
                </span>
            </footer>
        </section>
    );
}

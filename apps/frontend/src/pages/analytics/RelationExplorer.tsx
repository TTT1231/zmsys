import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { RELATION_TYPES, type RelationNode, type RelationsData, type RelationType } from "@/data/relations";
import {
    buildRelationFamilies,
    RELATION_CARD,
    RELATION_PAGE,
    relationEdgePath,
    relationNodeSummary,
    relationOwner,
    type RelationFamily,
} from "./relationLayout";
import { useRelationChart } from "./useRelationChart";
import { RelationGlobalGraph } from "./RelationGlobalGraph";

const names = Object.fromEntries(RELATION_TYPES.map(type => [type.key, type.name]));
const tone = (type: RelationType): CSSProperties => ({ "--node-color": `var(--relation-${type})` }) as CSSProperties;
const pageItems = (nodes: RelationNode[], page: number, size: number) => nodes.slice(page * size, (page + 1) * size);
const shortLabel = (value: string, budget: number) => {
    let used = 0,
        result = "";
    for (const char of value) {
        used += (char.codePointAt(0) ?? 0) > 127 ? 2 : 1;
        if (used > budget) return `${result}…`;
        result += char;
    }
    return result;
};

function Pager({
    label,
    total,
    size,
    page,
    onPage,
}: {
    label: string;
    total: number;
    size: number;
    page: number;
    onPage: (page: number) => void;
}) {
    if (total <= size) return null;
    return (
        <div className="relation-pager" role="group" aria-label={`${label}分页`}>
            <span>
                {label} {page * size + 1}–{Math.min(total, (page + 1) * size)} / {total}
            </span>
            <Button
                iconOnly
                icon="chevron-left"
                className="size-8"
                aria-label={`上一页${label}`}
                disabled={page === 0}
                onClick={() => onPage(page - 1)}
            />
            <Button
                iconOnly
                icon="chevron-right"
                className="size-8"
                aria-label={`下一页${label}`}
                disabled={(page + 1) * size >= total}
                onClick={() => onPage(page + 1)}
            />
        </div>
    );
}

function RelationTree({
    family,
    data,
    enabled,
    selectedId,
    onSelect,
}: {
    family: RelationFamily;
    data: RelationsData;
    enabled: Set<RelationType>;
    selectedId: string | null;
    onSelect: (id: string | null) => void;
}) {
    const [pages, setPages] = useState({ inbound: 0, order: 0, outbound: 0 });
    const [full, setFull] = useState(false);
    const [expanded, setExpanded] = useState<string | null | undefined>(undefined);
    const containerRef = useRef<HTMLDivElement>(null);
    const byId = useMemo(() => new Map(data.nodes.map(node => [node.id, node])), [data.nodes]);
    const receipts = useMemo(() => (enabled.has("inbound") ? family.inbounds : []), [enabled, family]);
    const orders = useMemo(() => (enabled.has("order") ? family.orders : []), [enabled, family]);
    const activeOrder = expanded === undefined ? (orders.length === 1 ? orders[0].id : null) : expanded;
    const shipments = useMemo(
        () =>
            enabled.has("outbound")
                ? family.outbounds.filter(
                      node =>
                          !enabled.has("order") ||
                          (node.facts.type === "outbound" && node.facts.orderId === activeOrder),
                  )
                : [],
        [enabled, family, activeOrder],
    );
    const shipmentCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const node of family.outbounds)
            if (node.facts.type === "outbound")
                counts.set(node.facts.orderId, (counts.get(node.facts.orderId) ?? 0) + 1);
        return counts;
    }, [family]);
    useEffect(() => {
        const node = byId.get(selectedId ?? "");
        if (!node || relationOwner(node) !== family.id) return;
        if (node.type === "inbound" && !full)
            setPages(current => ({
                ...current,
                inbound: Math.floor(receipts.findIndex(item => item.id === node.id) / RELATION_PAGE.inbound),
            }));
        const orderId =
            node.facts.type === "order" ? node.id : node.facts.type === "outbound" ? node.facts.orderId : null;
        if (orderId && !full) {
            setExpanded(orderId);
            const siblings = family.outbounds.filter(
                item => item.facts.type === "outbound" && (!enabled.has("order") || item.facts.orderId === orderId),
            );
            setPages(current => ({
                ...current,
                order: Math.max(0, Math.floor(orders.findIndex(item => item.id === orderId) / RELATION_PAGE.order)),
                outbound:
                    node.type === "outbound"
                        ? Math.max(
                              0,
                              Math.floor(siblings.findIndex(item => item.id === node.id) / RELATION_PAGE.outbound),
                          )
                        : 0,
            }));
        }
    }, [selectedId, family, byId, receipts, orders, enabled, full]);
    const inboundPage = Math.max(0, Math.min(pages.inbound, Math.ceil(receipts.length / RELATION_PAGE.inbound) - 1));
    const orderPage = Math.max(0, Math.min(pages.order, Math.ceil(orders.length / RELATION_PAGE.order) - 1));
    const outboundPage = Math.max(
        0,
        Math.min(pages.outbound, Math.ceil(shipments.length / RELATION_PAGE.outbound) - 1),
    );
    const visibleOrders = useMemo(() => pageItems(orders, orderPage, RELATION_PAGE.order), [orders, orderPage]);
    const activeVisible = !enabled.has("order") || visibleOrders.some(node => node.id === activeOrder);
    const nodes = useMemo(
        () => [
            ...(family.bom && enabled.has("bom") ? [family.bom] : []),
            ...(full ? receipts : pageItems(receipts, inboundPage, RELATION_PAGE.inbound)),
            ...(full ? orders : visibleOrders),
            ...(full
                ? enabled.has("outbound")
                    ? family.outbounds
                    : []
                : activeVisible
                  ? pageItems(shipments, outboundPage, RELATION_PAGE.outbound)
                  : []),
            ...(enabled.has("customer") ? family.customers : []),
            ...(enabled.has("person") ? family.people : []),
        ],
        [family, enabled, receipts, inboundPage, visibleOrders, activeVisible, shipments, outboundPage, orders, full],
    );
    const edges = useMemo(() => {
        const ids = new Set(nodes.map(node => node.id));
        return data.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
    }, [data.edges, nodes]);
    const selectTreeNode = (id: string | null) => {
        if (!full && id && byId.get(id)?.type === "order") setExpanded(id);
        onSelect(id);
    };
    const relationLabels = useMemo(() => {
        const labels = new Map<string, Set<string>>();
        if (selectedId)
            for (const edge of edges) {
                const other =
                    edge.source === selectedId ? edge.target : edge.target === selectedId ? edge.source : null;
                if (!other) continue;
                const roles = labels.get(other) ?? new Set<string>();
                roles.add(edge.relation);
                labels.set(other, roles);
            }
        return labels;
    }, [selectedId, edges]);
    const chart = useRelationChart(containerRef, nodes, edges, selectedId, selectTreeNode, undefined, full ? 0.1 : 0.7);

    return (
        <>
            <div className="relation-tree-mode">
                <span className="text-12 text-muted">
                    {full
                        ? `完整依赖：${nodes.length} 个节点 · ${edges.length} 条关系`
                        : `清晰分支：${nodes.length} / ${family.nodes.filter(node => enabled.has(node.type)).length} 个节点，单据可分页查看`}
                </span>
                <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-8 px-3 text-12"
                    aria-pressed={full}
                    onClick={() => setFull(value => !value)}
                >
                    {full ? "返回清晰分支" : "查看全部依赖"}
                </Button>
            </div>
            <div className="relation-flow" aria-label="业务树阅读顺序">
                <span style={tone("inbound")}>
                    入库 <b>{receipts.length}</b>
                </span>
                <span aria-hidden="true">→</span>
                <span style={tone("bom")}>BOM</span>
                <span aria-hidden="true">→</span>
                <span style={tone("order")}>
                    销售订单 <b>{orders.length}</b>
                </span>
                <span aria-hidden="true">→</span>
                <span style={tone("outbound")}>
                    出库 <b>{enabled.has("outbound") ? family.outbounds.length : 0}</b>
                </span>
            </div>
            <div
                ref={containerRef}
                className="relation-canvas"
                tabIndex={0}
                role="group"
                aria-label="业务树画布"
                onKeyDown={chart.keyDown}
            >
                <svg
                    className="relation-tree-svg"
                    aria-label="单型号业务关系树。点击查看详情，拖动BOM移动整组，拖动订单移动对应出库。方向键移动所选分支，加减键缩放，Home适应画布。"
                    onPointerDown={event => {
                        const target = event.target as Element;
                        chart.pointerDown(
                            event,
                            target.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null,
                        );
                    }}
                    onPointerMove={chart.pointerMove}
                    onPointerUp={chart.pointerUp}
                    onPointerCancel={chart.cancelPointer}
                    onLostPointerCapture={chart.cancelPointer}
                    onClick={event => {
                        if (!(event.target as Element).closest("[data-node-id]")) chart.clickNode(null);
                    }}
                >
                    <g transform={`translate(${chart.view.x} ${chart.view.y}) scale(${chart.view.scale})`}>
                        <g aria-hidden="true" className="relation-tree-links">
                            {edges.map((edge, i) => (
                                <path
                                    key={`${edge.source}:${edge.target}:${i}`}
                                    d={relationEdgePath(
                                        chart.positions.get(edge.source)!,
                                        chart.positions.get(edge.target)!,
                                        edge.kind,
                                        full && chart.zoom < 0.7,
                                    )}
                                    className={
                                        (edge.kind === "person" ? "is-person " : "") +
                                        (edge.source === selectedId || edge.target === selectedId ? "is-selected" : "")
                                    }
                                />
                            ))}
                        </g>
                        {nodes.map(node => {
                            const [x, y] = chart.positions.get(node.id) ?? [0, 0];
                            const shipmentCount =
                                node.type === "order" && enabled.has("outbound")
                                    ? (shipmentCounts.get(node.id) ?? 0)
                                    : 0;
                            const subtitle =
                                node.type === "order" && shipmentCount
                                    ? `${relationNodeSummary(node, enabled.has("customer") ? byId : undefined)} · 出库 ${shipmentCount} 笔`
                                    : relationNodeSummary(node, enabled.has("customer") ? byId : undefined);
                            return (
                                <g
                                    key={node.id}
                                    data-node-id={node.id}
                                    transform={`translate(${x} ${y})`}
                                    style={tone(node.type)}
                                    className={`relation-tree-node${selectedId === node.id ? " is-selected" : ""}${node.voided ? " is-voided" : ""}`}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`${names[node.type]} ${node.name}，${subtitle}${shipmentCount ? "，点击展开出库" : ""}`}
                                    aria-pressed={selectedId === node.id}
                                    onClick={() => chart.clickNode(node.id)}
                                    onKeyDown={event => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            selectTreeNode(node.id);
                                        }
                                    }}
                                >
                                    <title>{`${names[node.type]} ${node.name}\n${subtitle}`}</title>
                                    {full && chart.zoom < 0.7 ? (
                                        <>
                                            <circle
                                                className="relation-node-accent"
                                                cx={90}
                                                cy={34}
                                                r={node.type === "bom" ? 22 : 17}
                                            />
                                            {(nodes.length <= 80 ||
                                                node.type === "bom" ||
                                                node.type === "customer" ||
                                                node.type === "person" ||
                                                node.id === selectedId) && (
                                                <text
                                                    className="relation-node-name"
                                                    textAnchor="middle"
                                                    x={90}
                                                    y={-6}
                                                    style={{ fontSize: 12 / chart.zoom }}
                                                >
                                                    {shortLabel(node.name, 19)}
                                                </text>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <rect
                                                className="relation-node-card"
                                                width={RELATION_CARD.width}
                                                height={RELATION_CARD.height}
                                                rx={10}
                                            />
                                            <rect
                                                className="relation-node-accent"
                                                x={0}
                                                y={12}
                                                width={3}
                                                height={44}
                                                rx={1.5}
                                            />
                                            <text className="relation-node-type" x={14} y={17}>
                                                {names[node.type]}
                                                {node.voided ? " · 作废" : ""}
                                            </text>
                                            <text className="relation-node-name" x={14} y={36}>
                                                {shortLabel(node.name, 19)}
                                            </text>
                                            <text className="relation-node-subtitle" x={14} y={55}>
                                                {shortLabel(subtitle, 24)}
                                            </text>
                                            {relationLabels.has(node.id) && (
                                                <text className="relation-edge-label" x={14} y={-7}>
                                                    {shortLabel([...relationLabels.get(node.id)!].join("、"), 22)}
                                                </text>
                                            )}
                                        </>
                                    )}
                                </g>
                            );
                        })}
                    </g>
                </svg>
                {!nodes.length && (
                    <p className="relation-tree-empty text-13 text-muted">
                        当前类型仅显示客户或人员，可点击上方或下方姓名查看关联。
                    </p>
                )}
                <p className="relation-hint text-12 text-muted">
                    <span className="relation-desktop-tip">拖动BOM移动整组 · 点击订单展开出库</span>
                    <span className="relation-mobile-tip">左右拖动画布查看 · 点击单据查看详情</span>
                </p>
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
                    <Button iconOnly icon="maximize" aria-label="适应画布" title="适应画布" onClick={chart.fit} />
                    <Button iconOnly icon="refresh" aria-label="重新布局" title="重新布局" onClick={chart.reset} />
                </div>
            </div>
            {!full && (
                <div className="relation-branch-pagers">
                    {enabled.has("order") && activeOrder && activeVisible && shipments.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-8 px-2 text-12"
                            onClick={() => setExpanded(null)}
                        >
                            收起出库
                        </Button>
                    )}
                    <Pager
                        label="入库"
                        total={receipts.length}
                        size={RELATION_PAGE.inbound}
                        page={inboundPage}
                        onPage={page => setPages(current => ({ ...current, inbound: page }))}
                    />
                    <Pager
                        label="订单"
                        total={orders.length}
                        size={RELATION_PAGE.order}
                        page={orderPage}
                        onPage={page => {
                            setExpanded(null);
                            setPages(current => ({ ...current, order: page, outbound: 0 }));
                        }}
                    />
                    {activeVisible && (
                        <Pager
                            label="出库"
                            total={shipments.length}
                            size={RELATION_PAGE.outbound}
                            page={outboundPage}
                            onPage={page => setPages(current => ({ ...current, outbound: page }))}
                        />
                    )}
                    {enabled.has("outbound") && orders.length > 1 && !activeOrder && (
                        <p className="text-12 text-muted">选择一笔订单，展开对应出库单据</p>
                    )}
                </div>
            )}
        </>
    );
}

export function RelationExplorer({
    source,
    enabled,
    selectedId,
    onSelect,
}: {
    source: RelationsData;
    enabled: Set<RelationType>;
    selectedId: string | null;
    onSelect: (id: string | null) => void;
}) {
    const index = useMemo(() => buildRelationFamilies(source.nodes, source.edges), [source.nodes, source.edges]);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const [overview, setOverview] = useState(false);
    const selected = index.byId.get(selectedId ?? "");
    const owner = selected ? relationOwner(selected) : null;
    const families = useMemo(
        () => index.families.filter(family => family.nodes.some(node => enabled.has(node.type))),
        [index, enabled],
    );
    const family = !overview
        ? (families.find(item => item.id === focusedId) ?? (families.length === 1 ? families[0] : undefined))
        : undefined;
    useEffect(() => {
        if (owner) {
            setFocusedId(owner);
            setOverview(false);
        } else if (selectedId && !family?.nodes.some(node => node.id === selectedId)) setOverview(true);
    }, [selectedId, owner, family]);
    return (
        <div className="relation-explorer">
            <div className="relation-explorer-header">
                <div className="flex min-w-0 items-center gap-2 text-13">
                    {family ? (
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                icon="chevron-left"
                                className="px-2 text-13"
                                onClick={() => {
                                    setOverview(true);
                                    onSelect(null);
                                }}
                            >
                                全局关系
                            </Button>
                            <span className="text-muted" aria-hidden="true">
                                /
                            </span>
                            <h2 className="truncate font-semibold text-ink">{family.bom?.name ?? "型号业务树"}</h2>
                        </>
                    ) : (
                        <h2 className="font-semibold text-ink">全局依赖关系</h2>
                    )}
                </div>
                <span className="text-12 text-muted">
                    {family ? "入库与销售分支，按单据追溯" : `${families.length} 个型号 · 点击型号展开单据`}
                </span>
                {selected && !owner && family && (
                    <Button variant="ghost" size="sm" className="text-12" onClick={() => setOverview(true)}>
                        查看全局关联
                    </Button>
                )}
            </div>
            {family ? (
                <RelationTree
                    key={family.id}
                    family={family}
                    data={source}
                    enabled={enabled}
                    selectedId={selectedId}
                    onSelect={onSelect}
                />
            ) : (
                <RelationGlobalGraph
                    source={source}
                    enabled={enabled}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onOpen={id => {
                        setFocusedId(id);
                        setOverview(false);
                        onSelect(null);
                    }}
                />
            )}
        </div>
    );
}

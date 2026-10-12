import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import type { RelationType, RelationsData } from "@/data/relations";
import { buildGlobalRelationGraph, RELATION_CARD } from "./relationLayout";
import { useRelationChart } from "./useRelationChart";

/** Connected overview: shared entities remain single nodes, document dependencies are folded into a named BOM branch. */
export function RelationGlobalGraph({
    source,
    enabled,
    selectedId,
    onSelect,
    onOpen,
}: {
    source: RelationsData;
    enabled: Set<RelationType>;
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onOpen: (id: string) => void;
}) {
    const graph = useMemo(
        () => buildGlobalRelationGraph(source.nodes, source.edges, enabled),
        [source.nodes, source.edges, enabled],
    );
    const containerRef = useRef<HTMLDivElement>(null);
    const [hovered, setHovered] = useState<string | null>(null);
    const active = hovered ?? selectedId;
    const choose = (id: string | null) => {
        const family = id ? graph.familyIds.get(id) : null;
        if (family) onOpen(family);
        else onSelect(id);
    };
    const chart = useRelationChart(containerRef, graph.nodes, graph.edges, selectedId, choose, graph.points, 0.1);
    const compact = chart.zoom < 0.55;
    const bounds = useMemo(() => {
        const ys = [...chart.positions.values()].map(point => point[1]);
        return { top: Math.min(...ys) - 28, bottom: Math.max(...ys) + RELATION_CARD.height + 28 };
    }, [chart.positions]);
    const neighbors = useMemo(() => {
        const result = new Set<string>();
        if (active)
            for (const edge of graph.edges) {
                if (edge.source === active) result.add(edge.target);
                if (edge.target === active) result.add(edge.source);
            }
        return result;
    }, [active, graph.edges]);
    return (
        <>
            <div className="relation-graph-note text-12 text-muted">
                实线：业务关联 · 虚线：人员参与 · 型号内的单据已折叠，点击型号展开完整业务树
            </div>
            <div
                ref={containerRef}
                className="relation-canvas relation-global-canvas"
                tabIndex={0}
                role="group"
                aria-label="全局依赖关系画布"
                onKeyDown={chart.keyDown}
            >
                <svg
                    className={`relation-tree-svg${active ? " has-selection" : ""}`}
                    aria-label="全局业务依赖关系图。客户、人员和型号通过真实关系相连；点击型号展开单据，点击人员或客户查看详情。"
                    onPointerDown={event =>
                        chart.pointerDown(
                            event,
                            (event.target as Element).closest("[data-node-id]")?.getAttribute("data-node-id") ?? null,
                        )
                    }
                    onPointerMove={chart.pointerMove}
                    onPointerUp={chart.pointerUp}
                    onPointerCancel={chart.cancelPointer}
                    onLostPointerCapture={chart.cancelPointer}
                    onClick={event => {
                        if (!(event.target as Element).closest("[data-node-id]")) chart.clickNode(null);
                    }}
                >
                    <g transform={`translate(${chart.view.x} ${chart.view.y}) scale(${chart.view.scale})`}>
                        <g className="relation-tree-links" aria-hidden="true">
                            {graph.edges.map((edge, i) => {
                                const source = chart.positions.get(edge.source)!,
                                    target = chart.positions.get(edge.target)!;
                                const x1 = source[0] + (compact ? 107 : RELATION_CARD.width),
                                    y1 = source[1] + RELATION_CARD.height / 2,
                                    x2 = target[0] + (compact ? 73 : 0),
                                    y2 = target[1] + RELATION_CARD.height / 2;
                                const middle = (x1 + x2) / 2;
                                const highlighted = edge.source === active || edge.target === active;
                                const path = graph.familyIds.has(edge.target)
                                    ? edge.kind === "person"
                                        ? `M ${source[0] + 90} ${source[1] + (compact ? 51 : 68)} V ${bounds.bottom} H ${x2 - 26} V ${y2} H ${x2}`
                                        : `M ${x1} ${y1} H ${x1 + 16} V ${bounds.top} H ${x2 - 14} V ${y2} H ${x2}`
                                    : `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`;
                                return (
                                    <g key={`${edge.source}:${edge.target}:${i}`}>
                                        <path
                                            d={path}
                                            className={`${edge.kind === "person" ? "is-person" : ""}${highlighted ? " is-selected" : ""}`}
                                        >
                                            <title>{edge.relation}</title>
                                        </path>
                                        {highlighted && !compact && (
                                            <text className="relation-edge-label" x={target[0] + 10} y={target[1] - 8}>
                                                {edge.relation.length > 13
                                                    ? `${edge.relation.slice(0, 12)}…`
                                                    : edge.relation}
                                            </text>
                                        )}
                                    </g>
                                );
                            })}
                        </g>
                        {graph.nodes.map(node => {
                            const [x, y] = chart.positions.get(node.id) ?? [0, 0],
                                family = graph.familyIds.get(node.id);
                            const label = family
                                ? `展开 ${node.name} 业务树`
                                : `${node.type === "person" ? "人员" : "客户"} ${node.name}`;
                            const name = node.name.length > 16 ? `${node.name.slice(0, 15)}…` : node.name;
                            return (
                                <g
                                    key={node.id}
                                    data-node-id={node.id}
                                    data-family-id={family}
                                    transform={`translate(${x} ${y})`}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={label}
                                    aria-pressed={node.id === selectedId}
                                    className={`relation-tree-node${node.id === active || neighbors.has(node.id) ? " is-selected" : ""}`}
                                    style={{ "--node-color": `var(--relation-${node.type})` } as CSSProperties}
                                    onMouseEnter={() => setHovered(node.id)}
                                    onMouseLeave={() => setHovered(null)}
                                    onClick={() => chart.clickNode(node.id)}
                                    onKeyDown={event => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            choose(node.id);
                                        }
                                    }}
                                >
                                    <title>{`${node.name}\n${graph.summaries.get(node.id)}${family ? "\n点击展开单据和所有参与人员的依赖关系" : ""}`}</title>
                                    {compact ? (
                                        <>
                                            <circle
                                                cx={90}
                                                cy={34}
                                                r={node.type === "bom" ? 18 : 22}
                                                className="relation-node-accent"
                                            />
                                            {(graph.nodes.length <= 70 ||
                                                node.type !== "bom" ||
                                                node.id === active) && (
                                                <text
                                                    className="relation-node-name"
                                                    x={90}
                                                    y={34 - 30}
                                                    textAnchor="middle"
                                                    style={{ fontSize: 12 / chart.zoom }}
                                                >
                                                    {name}
                                                </text>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <rect className="relation-node-card" width={180} height={68} rx={10} />
                                            <rect
                                                className="relation-node-accent"
                                                x={0}
                                                y={12}
                                                width={3}
                                                height={44}
                                                rx={1.5}
                                            />
                                            <text className="relation-node-type" x={14} y={17}>
                                                {family
                                                    ? "型号 · 单据已收拢"
                                                    : node.type === "person"
                                                      ? "人员"
                                                      : "客户"}
                                            </text>
                                            <text className="relation-node-name" x={14} y={36}>
                                                {name}
                                            </text>
                                            <text className="relation-node-subtitle" x={14} y={55}>
                                                {graph.summaries.get(node.id)?.slice(0, 24)}
                                            </text>
                                        </>
                                    )}
                                </g>
                            );
                        })}
                    </g>
                </svg>
                <p className="relation-hint text-12 text-muted">悬停突出依赖 · 点击型号展开 · 拖动画布 / 滚轮缩放</p>
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
                        <span className="text-20" aria-hidden="true">
                            −
                        </span>
                    </Button>
                    <Button iconOnly icon="maximize" aria-label="适应画布" title="适应画布" onClick={chart.fit} />
                    <Button iconOnly icon="refresh" aria-label="重新布局" title="重新布局" onClick={chart.reset} />
                </div>
            </div>
        </>
    );
}

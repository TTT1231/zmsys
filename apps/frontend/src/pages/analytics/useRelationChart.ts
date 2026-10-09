import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as echarts from "echarts/core";
import { GraphChart } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";
import { LabelLayout } from "echarts/features";
import type { EChartsOption, GraphSeriesOption } from "echarts";
import { chartPalette } from "@/lib/chartTheme";
import { usePreferences } from "@/context/usePreferences";
import { RELATION_TYPES, type RelationNode, type RelationEdge } from "@/data/relations";
import {
    buildRelationLayout,
    relationLabelIds,
    relationNodeVisual,
    relationSymbolScale,
    type RelationPoint,
} from "./relationLayout";

echarts.use([GraphChart, CanvasRenderer, LabelLayout]);

/** Layout coordinates are read from ECharts to retain pointer/keyboard edits when labels or colors change. */
interface GraphModel {
    getData(): {
        count(): number;
        getId(index: number): string;
        getItemLayout(index: number): RelationPoint;
        setItemLayout(index: number, point: RelationPoint): void;
    };
    coordinateSystem: { dataToPoint(point: RelationPoint): RelationPoint };
    getGraph(): {
        eachEdge(
            callback: (edge: {
                node1: { getLayout(): RelationPoint };
                node2: { getLayout(): RelationPoint };
                setLayout(points: RelationPoint[]): void;
            }) => void,
        ): void;
    };
}
interface GraphRuntime {
    getModel(): { getSeriesByIndex(index: number): GraphModel | undefined } | undefined;
    getViewOfSeriesModel(model: GraphModel): { updateLayout(model: GraphModel): void };
}
const seriesOf = (chart: echarts.ECharts) => (chart as unknown as GraphRuntime).getModel()?.getSeriesByIndex(0);
const optionOf = (chart: echarts.ECharts) =>
    (chart.getOption() as EChartsOption).series as GraphSeriesOption[] | undefined;
type ChartNode = Extract<NonNullable<GraphSeriesOption["data"]>[number], { label?: unknown }> & {
    id: string;
    x: number;
    y: number;
};

const capture = (chart: echarts.ECharts, positions: Map<string, RelationPoint>) => {
    const data = seriesOf(chart)?.getData();
    if (!data) return;
    for (let i = 0; i < data.count(); i++) {
        const point = data.getItemLayout(i);
        if (point?.every(Number.isFinite) && positions.has(data.getId(i))) positions.set(data.getId(i), [...point]);
    }
};

export function useRelationChart(
    containerRef: RefObject<HTMLDivElement | null>,
    nodes: RelationNode[],
    edges: RelationEdge[],
    selected: string | null,
    onSelect: (id: string | null) => void,
) {
    const { isDark, preferences } = usePreferences();
    const chartRef = useRef<echarts.ECharts | null>(null);
    const positions = useRef(new Map<string, RelationPoint>());
    const baseline = useRef<{ key: string; points: Map<string, RelationPoint> } | null>(null);
    const rendered = useRef<{ key: string; revision: number } | null>(null);
    const chartNodes = useRef<ChartNode[]>([]);
    const symbolSizes = useRef(new Map<string, { size: number; voided: boolean }>());
    const symbolScale = useRef(1);
    const dataRef = useRef({ nodes, edges });
    const selectRef = useRef(onSelect);
    const selectedRef = useRef(selected);
    const [zoom, setZoom] = useState(1);
    const [revision, setRevision] = useState(0);
    const fitRef = useRef<() => void>(() => {});
    const geometryKey = useMemo(
        () =>
            JSON.stringify([
                nodes
                    .map(node => [
                        node.id,
                        node.type,
                        "bomId" in node.facts ? node.facts.bomId : "",
                        "orderId" in node.facts ? node.facts.orderId : "",
                    ])
                    .sort(),
                edges.map(edge => [edge.source, edge.target, edge.kind]).sort(),
            ]),
        [nodes, edges],
    );
    useEffect(() => {
        selectRef.current = onSelect;
        selectedRef.current = selected;
    }, [onSelect, selected]);
    useEffect(() => {
        dataRef.current = { nodes, edges };
    }, [nodes, edges]);

    const fit = () => {
        const chart = chartRef.current;
        if (!chart) return;
        const model = seriesOf(chart);
        const data = model?.getData();
        if (!model || !data?.count()) return;
        capture(chart, positions.current);
        const points = Array.from(positions.current.values());
        if (!points.length) return;
        const pixels = points.map(point => model.coordinateSystem.dataToPoint(point));
        const range = (values: RelationPoint[], axis: number) =>
            values.reduce(
                (bounds, point) => [Math.min(bounds[0], point[axis]), Math.max(bounds[1], point[axis])],
                [Infinity, -Infinity],
            );
        const [minX, maxX] = range(points, 0),
            [minY, maxY] = range(points, 1);
        const [left, right] = range(pixels, 0),
            [top, bottom] = range(pixels, 1);
        const current = optionOf(chart)?.[0]?.zoom ?? 1;
        const target = Math.max(
            0.1,
            Math.min(
                1.7,
                current *
                    Math.min(
                        Math.max(100, chart.getWidth() - 140) / Math.max(60, right - left),
                        Math.max(100, chart.getHeight() - 130) / Math.max(60, bottom - top),
                    ),
            ),
        );
        chart.setOption({
            series: [{ id: "relations", zoom: target, center: [(minX + maxX) / 2, (minY + maxY) / 2] }],
        });
        setZoom(target);
    };
    useEffect(() => {
        fitRef.current = fit;
    });

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const chart = echarts.init(container, undefined, { renderer: "canvas" });
        chartRef.current = chart;
        rendered.current = null;
        let pointer: RelationPoint | null = null,
            dragged = false;
        chart.on("click", (params: unknown) => {
            const event = params as { dataType?: string; data?: { id?: string } };
            if (event.dataType === "node" && event.data?.id && !dragged) {
                selectRef.current(event.data.id);
                container.focus({ preventScroll: true });
            }
        });
        chart.on("graphRoam", () => setZoom(optionOf(chart)?.[0]?.zoom ?? 1));
        const zr = chart.getZr();
        zr.on("mousedown", event => {
            pointer = [event.offsetX, event.offsetY];
            dragged = false;
        });
        zr.on("mousemove", event => {
            if (pointer && Math.hypot(event.offsetX - pointer[0], event.offsetY - pointer[1]) > 5) dragged = true;
        });
        zr.on("mouseup", () => {
            capture(chart, positions.current);
            pointer = null;
        });
        zr.on("click", event => {
            if (!event.target && !dragged) selectRef.current(null);
        });
        const keydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                selectRef.current(null);
                return;
            }
            if (event.key === "+" || event.key === "=" || event.key === "-") {
                event.preventDefault();
                const current = optionOf(chart)?.[0]?.zoom ?? 1;
                const target = Math.max(0.1, Math.min(3, current * (event.key === "-" ? 1 / 1.2 : 1.2)));
                chart.dispatchAction({
                    type: "graphRoam",
                    seriesId: "relations",
                    zoom: target / current,
                    originX: chart.getWidth() / 2,
                    originY: chart.getHeight() / 2,
                });
                setZoom(target);
                return;
            }
            if (event.key === "Home") {
                event.preventDefault();
                fitRef.current();
                return;
            }
            if (!selectedRef.current || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key))
                return;
            event.preventDefault();
            const model = seriesOf(chart),
                data = model?.getData();
            if (!model || !data) return;
            const index = Array.from({ length: data.count() }, (_, i) => i).find(
                i => data.getId(i) === selectedRef.current,
            );
            if (index === undefined) return;
            const point: RelationPoint = [...data.getItemLayout(index)];
            const pixel = model.coordinateSystem.dataToPoint(point);
            const nextPixel = model.coordinateSystem.dataToPoint([point[0] + 1, point[1] + 1]);
            point[0] +=
                (event.key === "ArrowLeft" ? -18 : event.key === "ArrowRight" ? 18 : 0) /
                Math.max(0.01, Math.abs(nextPixel[0] - pixel[0]));
            point[1] +=
                (event.key === "ArrowUp" ? -18 : event.key === "ArrowDown" ? 18 : 0) /
                Math.max(0.01, Math.abs(nextPixel[1] - pixel[1]));
            data.setItemLayout(index, point);
            // GraphView's pointer drag does this edge pass too. Keyboard movement must update line endpoints.
            model.getGraph().eachEdge(edge => {
                const source: RelationPoint = [...edge.node1.getLayout()],
                    target: RelationPoint = [...edge.node2.getLayout()];
                edge.setLayout([
                    source,
                    target,
                    [
                        (source[0] + target[0]) / 2 - (source[1] - target[1]) * 0.03,
                        (source[1] + target[1]) / 2 - (target[0] - source[0]) * 0.03,
                    ],
                ]);
            });
            (chart as unknown as GraphRuntime).getViewOfSeriesModel(model).updateLayout(model);
            positions.current.set(selectedRef.current, point);
        };
        container.addEventListener("keydown", keydown);
        let resizeFrame = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(() => {
                if (chart.getWidth() === container.clientWidth && chart.getHeight() === container.clientHeight) return;
                capture(chart, positions.current);
                // Resize retains the user's current center/zoom. It never invokes fit or computes a new layout.
                chart.resize({ animation: { duration: 0 } });
                const nextScale = relationSymbolScale(
                    positions.current,
                    chart.getWidth(),
                    chart.getHeight(),
                    chartNodes.current.length,
                );
                const labels = relationLabelIds(dataRef.current.nodes, dataRef.current.edges, selectedRef.current, {
                    width: chart.getWidth(),
                    height: chart.getHeight(),
                });
                if (
                    nextScale !== symbolScale.current ||
                    chartNodes.current.some(node => node.label?.show !== labels.has(node.id))
                ) {
                    symbolScale.current = nextScale;
                    const data = chartNodes.current.map(node => {
                        const point = positions.current.get(node.id) ?? [node.x, node.y];
                        const base = symbolSizes.current.get(node.id) ?? { size: 20, voided: false };
                        const visual = relationNodeVisual(base.size, nextScale, base.voided);
                        return {
                            ...node,
                            x: point[0],
                            y: point[1],
                            symbolSize: visual.symbolSize,
                            itemStyle: { ...node.itemStyle, borderWidth: visual.borderWidth },
                            label: { ...node.label, show: labels.has(node.id) },
                            emphasis: {
                                ...node.emphasis,
                                label: { ...node.emphasis?.label, show: labels.has(node.id) },
                            },
                        };
                    });
                    chartNodes.current = data;
                    chart.setOption({ series: [{ id: "relations", data }] });
                }
            });
        });
        observer.observe(container);
        return () => {
            cancelAnimationFrame(resizeFrame);
            observer.disconnect();
            container.removeEventListener("keydown", keydown);
            chart.dispose();
            chartRef.current = null;
        };
    }, [containerRef]);

    useEffect(() => {
        const chart = chartRef.current,
            container = containerRef.current;
        if (!chart || !container) return;
        const changed = rendered.current?.key !== geometryKey || rendered.current.revision !== revision;
        if (baseline.current?.key !== geometryKey)
            baseline.current = {
                key: geometryKey,
                points: buildRelationLayout(
                    nodes,
                    edges,
                    Math.max(1, chart.getWidth() - 160) / Math.max(1, chart.getHeight() - 135),
                ),
            };
        if (changed) positions.current = new Map([...baseline.current.points].map(([id, point]) => [id, [...point]]));
        else capture(chart, positions.current);
        const palette = chartPalette();
        const style = getComputedStyle(container);
        const colors = new Map(
            RELATION_TYPES.map(type => [type.key, style.getPropertyValue(`--relation-${type.key}`).trim()]),
        );
        const degree = new Map<string, number>();
        for (const edge of edges) {
            degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
            degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
        }
        const labelIds = relationLabelIds(nodes, edges, selectedRef.current, {
            width: chart.getWidth(),
            height: chart.getHeight(),
        });
        const densityScale = relationSymbolScale(positions.current, chart.getWidth(), chart.getHeight(), nodes.length);
        symbolScale.current = densityScale;
        symbolSizes.current = new Map();
        const data: ChartNode[] = nodes.map(node => {
            const point = positions.current.get(node.id) ?? [0, 0],
                d = degree.get(node.id) ?? 0,
                color = colors.get(node.type);
            const size =
                node.type === "bom"
                    ? 36 + Math.min(15, d * 1.2)
                    : node.type === "customer"
                      ? 24 + Math.min(10, d)
                      : node.type === "person"
                        ? 21 + Math.min(10, d * 0.8)
                        : node.type === "order"
                          ? 20 + Math.min(7, d)
                          : 14 + Math.min(5, d);
            symbolSizes.current.set(node.id, { size, voided: node.voided ?? false });
            const visual = relationNodeVisual(size, densityScale, node.voided);
            return {
                id: node.id,
                name: node.name,
                x: point[0],
                y: point[1],
                value: d,
                category: RELATION_TYPES.findIndex(type => type.key === node.type),
                symbolSize: visual.symbolSize,
                cursor: "grab",
                itemStyle: {
                    color: node.voided ? palette.soft : color,
                    borderColor: node.voided ? color : style.getPropertyValue("--color-surface").trim(),
                    borderWidth: visual.borderWidth,
                },
                label: {
                    show: labelIds.has(node.id),
                    position: "right",
                    distance: 6,
                    fontSize: node.type === "bom" ? 12 : 11,
                    width: 120,
                    overflow: "truncate",
                    color: palette.tdStrong,
                    fontWeight: node.type === "bom" ? 600 : 400,
                },
                emphasis: { focus: "adjacency", label: { show: labelIds.has(node.id), color: palette.tdStrong } },
            };
        });
        chartNodes.current = data;
        const points = Array.from(positions.current.values());
        const center: RelationPoint = points.length
            ? [
                  (Math.min(...points.map(point => point[0])) + Math.max(...points.map(point => point[0]))) / 2,
                  (Math.min(...points.map(point => point[1])) + Math.max(...points.map(point => point[1]))) / 2,
              ]
            : [0, 0];
        chart.setOption({
            animation: false,
            animationDuration: 0,
            animationDurationUpdate: 0,
            series: [
                {
                    id: "relations",
                    type: "graph",
                    layout: "none",
                    animation: false,
                    roam: true,
                    draggable: true,
                    preserveAspect: "contain",
                    nodeScaleRatio: 1,
                    labelLayout: { hideOverlap: true },
                    ...(changed ? { zoom: 1, center } : {}),
                    left: 70,
                    right: 90,
                    top: 65,
                    bottom: 70,
                    scaleLimit: { min: 0.1, max: 3 },
                    categories: RELATION_TYPES.map(type => ({
                        name: type.name,
                        itemStyle: { color: colors.get(type.key) },
                    })),
                    data,
                    links: edges.map(edge => ({
                        ...edge,
                        lineStyle: {
                            color: palette.muted,
                            opacity: edge.kind === "person" ? 0.12 : 0.32,
                            width: edge.kind === "person" ? 0.7 : 1,
                            type: edge.kind === "person" ? "dashed" : "solid",
                            curveness: 0.03,
                        },
                    })),
                    emphasis: { lineStyle: { width: 2, opacity: 0.75 } },
                    blur: { itemStyle: { opacity: 0.2 }, lineStyle: { opacity: 0.04 }, label: { opacity: 0.2 } },
                },
            ],
        } satisfies EChartsOption);
        rendered.current = { key: geometryKey, revision };
        if (changed) setZoom(1);
        // ECharts renders these final coordinates immediately. There is no delayed fit or second camera move.
    }, [nodes, edges, geometryKey, revision, isDark, preferences.themePreset, containerRef]);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        capture(chart, positions.current);
        const labels = relationLabelIds(nodes, edges, selected, { width: chart.getWidth(), height: chart.getHeight() });
        const data = chartNodes.current.map(node => {
            const point = positions.current.get(node.id) ?? [node.x, node.y];
            return {
                ...node,
                x: point[0],
                y: point[1],
                label: { ...node.label, show: labels.has(node.id) },
                emphasis: { ...node.emphasis, label: { ...node.emphasis?.label, show: labels.has(node.id) } },
            };
        });
        if (data.some((node, index) => node.label?.show !== chartNodes.current[index]?.label?.show)) {
            chartNodes.current = data;
            chart.setOption({ series: [{ id: "relations", data }] });
        }
        chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
        const index = nodes.findIndex(node => node.id === selected);
        if (index >= 0) chart.dispatchAction({ type: "highlight", seriesIndex: 0, dataIndex: index });
    }, [selected, nodes, edges, isDark, preferences.themePreset, revision]);

    return {
        zoom,
        fit,
        reset: () => {
            selectRef.current(null);
            setRevision(value => value + 1);
        },
        zoomBy: (factor: number) => {
            const chart = chartRef.current;
            if (!chart) return;
            const current = optionOf(chart)?.[0]?.zoom ?? 1;
            const target = Math.max(0.1, Math.min(3, current * factor));
            chart.dispatchAction({
                type: "graphRoam",
                seriesId: "relations",
                zoom: target / current,
                originX: chart.getWidth() / 2,
                originY: chart.getHeight() / 2,
            });
            setZoom(target);
        },
    };
}

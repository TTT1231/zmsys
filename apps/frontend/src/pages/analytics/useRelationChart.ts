import { useEffect, useRef, useState, type RefObject } from "react";
import * as echarts from "echarts/core";
import { GraphChart } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";
import { LabelLayout } from "echarts/features";
import type { EChartsOption, GraphSeriesOption } from "echarts";
import { chartPalette } from "@/lib/chartTheme";
import { usePreferences } from "@/context/usePreferences";
import { RELATION_TYPES, type RelationNode, type RelationEdge } from "@/data/relations";

echarts.use([GraphChart, CanvasRenderer, LabelLayout]);

type Point = [number, number];
/** ECharts 的力布局位置不在 getOption 中，集中读取布局以保留用户拖动后的坐标。 */
interface GraphModel {
    getData(): {
        count(): number;
        getId(index: number): string;
        getItemLayout(index: number): Point;
        setItemLayout(index: number, point: Point): void;
    };
    coordinateSystem: { dataToPoint(point: Point): Point };
    forceLayout?: { setFixed(index: number): void };
}
interface GraphRuntime {
    getModel(): { getSeriesByIndex(index: number): GraphModel | undefined } | undefined;
    getViewOfSeriesModel(model: GraphModel): { updateLayout(model: GraphModel): void };
}
const seriesOf = (chart: echarts.ECharts) => (chart as unknown as GraphRuntime).getModel()?.getSeriesByIndex(0);
const optionOf = (chart: echarts.ECharts) =>
    (chart.getOption() as EChartsOption).series as GraphSeriesOption[] | undefined;

export function useRelationChart(
    containerRef: RefObject<HTMLDivElement | null>,
    nodes: RelationNode[],
    edges: RelationEdge[],
    selected: string | null,
    onSelect: (id: string | null) => void,
) {
    const { isDark, preferences } = usePreferences();
    const chartRef = useRef<echarts.ECharts | null>(null);
    const positions = useRef(new Map<string, Point>());
    const resetPending = useRef(false);
    const selectRef = useRef(onSelect);
    const selectedRef = useRef(selected);
    const [zoom, setZoom] = useState(1);
    const [revision, setRevision] = useState(0);
    const [reducedMotion, setReducedMotion] = useState(false);
    const fitRef = useRef<() => void>(() => {});
    useEffect(() => {
        selectRef.current = onSelect;
        selectedRef.current = selected;
    }, [onSelect, selected]);

    const capture = (chart: echarts.ECharts) => {
        const data = seriesOf(chart)?.getData();
        if (!data) return;
        for (let i = 0; i < data.count(); i++) {
            const point = data.getItemLayout(i);
            if (point?.every(Number.isFinite)) positions.current.set(data.getId(i), [...point]);
        }
    };

    const fit = () => {
        const chart = chartRef.current;
        if (!chart) return;
        const model = seriesOf(chart);
        const data = model?.getData();
        if (!model || !data?.count()) return;
        capture(chart);
        const points = Array.from({ length: data.count() }, (_, i) => data.getItemLayout(i)).filter(p =>
            p?.every(Number.isFinite),
        );
        if (!points.length) return;
        const pixels = points.map(p => model.coordinateSystem.dataToPoint(p));
        const range = (ps: Point[], axis: number) =>
            ps.reduce((r, p) => [Math.min(r[0], p[axis]), Math.max(r[1], p[axis])], [Infinity, -Infinity]);
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
                        Math.max(100, chart.getWidth() - (chart.getWidth() < 650 ? 115 : 250)) /
                            Math.max(60, right - left),
                        Math.max(100, chart.getHeight() - 160) / Math.max(60, bottom - top),
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
        const chart = echarts.init(container);
        chartRef.current = chart;
        const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
        setReducedMotion(motion.matches);
        const motionChanged = () => setReducedMotion(motion.matches);
        motion.addEventListener("change", motionChanged);
        let pointer: Point | null = null,
            dragged = false;
        chart.on("click", (params: unknown) => {
            const p = params as { dataType?: string; data?: { id?: string } };
            if (p.dataType === "node" && p.data?.id && !dragged) {
                selectRef.current(p.data.id);
                container.focus({ preventScroll: true });
            }
        });
        chart.on("graphRoam", () => setZoom(optionOf(chart)?.[0]?.zoom ?? 1));
        const zr = chart.getZr();
        zr.on("mousedown", e => {
            pointer = [e.offsetX, e.offsetY];
            dragged = false;
        });
        zr.on("mousemove", e => {
            if (pointer && Math.hypot(e.offsetX - pointer[0], e.offsetY - pointer[1]) > 5) dragged = true;
        });
        zr.on("mouseup", () => {
            capture(chart);
            pointer = null;
        });
        zr.on("click", e => {
            if (!e.target && !dragged) selectRef.current(null);
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
            const point: Point = [...data.getItemLayout(index)];
            point[0] += event.key === "ArrowLeft" ? -18 : event.key === "ArrowRight" ? 18 : 0;
            point[1] += event.key === "ArrowUp" ? -18 : event.key === "ArrowDown" ? 18 : 0;
            model.forceLayout?.setFixed(index);
            data.setItemLayout(index, point);
            (chart as unknown as GraphRuntime).getViewOfSeriesModel(model).updateLayout(model);
            positions.current.set(selectedRef.current, point);
        };
        container.addEventListener("keydown", keydown);
        let timer: ReturnType<typeof setTimeout>;
        const observer = new ResizeObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                capture(chart);
                chart.resize();
                fitRef.current();
            }, 120);
        });
        observer.observe(container);
        return () => {
            clearTimeout(timer);
            observer.disconnect();
            motion.removeEventListener("change", motionChanged);
            container.removeEventListener("keydown", keydown);
            chart.dispose();
            chartRef.current = null;
        };
    }, [containerRef]);

    useEffect(() => {
        const chart = chartRef.current,
            container = containerRef.current;
        if (!chart || !container) return;
        if (resetPending.current) resetPending.current = false;
        else capture(chart);
        const palette = chartPalette();
        const style = getComputedStyle(container);
        const colors = new Map(RELATION_TYPES.map(t => [t.key, style.getPropertyValue(`--relation-${t.key}`).trim()]));
        const degree = new Map<string, number>();
        edges.forEach(e => {
            degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
            degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
        });
        const bomNodes = nodes.filter(n => n.type === "bom");
        const anchors = new Map(
            bomNodes.map((n, i) => {
                const angle = (i / Math.max(1, bomNodes.length)) * Math.PI * 2 - Math.PI / 2;
                return [
                    n.id,
                    [
                        chart.getWidth() * (0.5 + Math.cos(angle) * 0.24),
                        chart.getHeight() * (0.5 + Math.sin(angle) * 0.24),
                    ] as Point,
                ];
            }),
        );
        const anchorByNode = new Map(anchors);
        for (let pass = 0; pass < 2; pass++)
            for (const e of edges) {
                if (e.kind !== "business") continue;
                const source = anchorByNode.get(e.source),
                    target = anchorByNode.get(e.target);
                if (source && !target) anchorByNode.set(e.target, source);
                if (target && !source) anchorByNode.set(e.source, target);
            }
        const seed = (node: RelationNode): Point => {
            const anchor = anchorByNode.get(node.id) ?? [chart.getWidth() / 2, chart.getHeight() / 2];
            const hash = [...node.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
            const angle = hash / 1000,
                distance = node.type === "bom" ? 0 : 45 + (hash % 100);
            return [anchor[0] + Math.cos(angle) * distance, anchor[1] + Math.sin(angle) * distance];
        };
        chart.setOption(
            {
                animation: !reducedMotion,
                series: [
                    {
                        id: "relations",
                        type: "graph",
                        layout: reducedMotion ? "none" : "force",
                        roam: true,
                        draggable: true,
                        preserveAspect: "contain",
                        nodeScaleRatio: 0.7,
                        labelLayout: { hideOverlap: true },
                        zoom: 1,
                        left: chart.getWidth() < 650 ? 35 : 65,
                        right: chart.getWidth() < 650 ? 55 : 100,
                        top: 55,
                        bottom: 70,
                        scaleLimit: { min: 0.1, max: 3 },
                        force: {
                            repulsion: chart.getWidth() < 650 ? [240, 650] : [420, 1300],
                            gravity: 0.055,
                            edgeLength: chart.getWidth() < 650 ? [65, 135] : [105, 195],
                            friction: 0.48,
                            layoutAnimation: !reducedMotion,
                        },
                        categories: RELATION_TYPES.map(t => ({
                            name: t.name,
                            itemStyle: { color: colors.get(t.key) },
                        })),
                        data: nodes.map(node => {
                            const p = positions.current.get(node.id) ?? seed(node),
                                d = degree.get(node.id) ?? 0;
                            const color = colors.get(node.type);
                            const size =
                                node.type === "bom"
                                    ? 36 + Math.min(19, d * 1.45)
                                    : node.type === "customer"
                                      ? 24 + Math.min(13, d * 1.2)
                                      : node.type === "person"
                                        ? 21 + Math.min(15, d * 0.9)
                                        : node.type === "order"
                                          ? 18 + Math.min(9, d)
                                          : 13 + Math.min(6, d * 1.3);
                            return {
                                id: node.id,
                                name: node.name,
                                x: p[0],
                                y: p[1],
                                value: d,
                                category: RELATION_TYPES.findIndex(t => t.key === node.type),
                                symbolSize: size,
                                cursor: "grab",
                                itemStyle: {
                                    color: node.voided ? palette.soft : color,
                                    borderColor: node.voided ? color : style.getPropertyValue("--color-surface").trim(),
                                    borderWidth: node.voided ? 2 : 1.8,
                                },
                                label: {
                                    show: true,
                                    position: "right",
                                    distance: 7,
                                    fontSize: node.type === "bom" ? 13 : 11,
                                    color: palette.tdStrong,
                                    fontWeight: node.type === "bom" ? 600 : 400,
                                },
                                emphasis: { focus: "adjacency", label: { color: palette.tdStrong } },
                            };
                        }),
                        links: edges.map(e => ({
                            ...e,
                            lineStyle: {
                                color: palette.muted,
                                opacity: e.kind === "person" ? 0.16 : 0.3,
                                width: e.kind === "person" ? 0.7 : 1,
                                type: e.kind === "person" ? "dashed" : "solid",
                                curveness: 0.08,
                            },
                        })),
                        emphasis: { lineStyle: { width: 2, opacity: 0.75 } },
                        blur: { itemStyle: { opacity: 0.18 }, lineStyle: { opacity: 0.04 }, label: { opacity: 0.2 } },
                    },
                ],
            } satisfies EChartsOption,
            true,
        );
        setZoom(1);
        const timer = setTimeout(() => fitRef.current(), reducedMotion ? 0 : 700);
        return () => clearTimeout(timer);
    }, [nodes, edges, revision, reducedMotion, isDark, preferences.themePreset, containerRef]);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
        const index = nodes.findIndex(n => n.id === selected);
        if (index >= 0) chart.dispatchAction({ type: "highlight", seriesIndex: 0, dataIndex: index });
    }, [selected, nodes]);

    return {
        zoom,
        fit,
        reset: () => {
            positions.current.clear();
            resetPending.current = true;
            selectRef.current(null);
            setRevision(r => r + 1);
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

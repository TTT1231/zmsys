// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RelationEdge, RelationNode } from "@/data/relations";
import { useRelationChart } from "@/pages/analytics/useRelationChart";

const mocks = vi.hoisted(() => ({
    init: vi.fn(),
    layout: vi.fn(),
    preference: { isDark: false, preferences: { themePreset: "default" } },
}));
vi.mock("echarts/core", () => ({ use: vi.fn(), init: mocks.init }));
vi.mock("@/context/usePreferences", () => ({ usePreferences: () => mocks.preference }));
vi.mock("@/lib/chartTheme", () => ({ chartPalette: () => ({ soft: "soft", muted: "muted", tdStrong: "ink" }) }));
vi.mock("@/pages/analytics/relationLayout", async importOriginal => {
    const actual = await importOriginal<typeof import("@/pages/analytics/relationLayout")>();
    return {
        ...actual,
        buildRelationLayout: (...args: Parameters<typeof actual.buildRelationLayout>) => {
            mocks.layout(...args);
            return actual.buildRelationLayout(...args);
        },
    };
});

type TestNode = { id: string; x: number; y: number; symbolSize: number; label: { show: boolean } };
type TestSeries = { data: TestNode[]; zoom: number; center: number[]; links: RelationEdge[] };
type Option = {
    animation?: boolean;
    animationDurationUpdate?: number;
    series: (Partial<TestSeries> & { layout?: string; animation?: boolean })[];
};
const bom: RelationNode = {
    id: "bom:1",
    type: "bom",
    name: "KW001",
    properties: {},
    facts: { type: "bom", code: "KW001", unit: "个", stock: 0, createdById: "person:1" },
};
const inbounds: RelationNode[] = Array.from({ length: 40 }, (_, i) => ({
    id: `inbound:${i}`,
    type: "inbound",
    name: `RK${i}`,
    properties: {},
    facts: {
        type: "inbound",
        no: `RK${i}`,
        date: "2026-10-01",
        qty: 1,
        voided: false,
        unit: "个",
        bomId: bom.id,
        operatorId: "person:1",
    },
}));
const nodes = [bom, ...inbounds];
const edges: RelationEdge[] = inbounds.map(node => ({
    source: node.id,
    target: bom.id,
    kind: "business",
    relation: "入库",
}));

let container: HTMLDivElement, width: number, height: number;
let resizeCallback: () => void, frameCallback: FrameRequestCallback | undefined;
let series: TestSeries, layouts: Map<string, [number, number]>;
let chart: ReturnType<typeof createChart>;
const edgeLayout = vi.fn();
function createChart() {
    let chartWidth = width,
        chartHeight = height;
    const callbacks = new Map<string, () => void>();
    const getData = () => ({
        count: () => series.data.length,
        getId: (i: number) => series.data[i].id,
        getItemLayout: (i: number) => layouts.get(series.data[i].id),
        setItemLayout: (i: number, point: [number, number]) => layouts.set(series.data[i].id, point),
    });
    const model = {
        getData,
        coordinateSystem: { dataToPoint: (point: [number, number]) => point },
        getGraph: () => ({
            eachEdge: (callback: (edge: unknown) => void) =>
                series.links.forEach(edge =>
                    callback({
                        node1: { getLayout: () => layouts.get(edge.source) },
                        node2: { getLayout: () => layouts.get(edge.target) },
                        setLayout: edgeLayout,
                    }),
                ),
        }),
    };
    return {
        setOption: vi.fn((option: Option) => {
            series = { ...series, ...option.series[0] };
            if (option.series[0].data) layouts = new Map(series.data.map(node => [node.id, [node.x, node.y]]));
        }),
        getOption: () => ({ series: [series] }),
        getModel: () => ({ getSeriesByIndex: () => model }),
        getViewOfSeriesModel: () => ({ updateLayout: vi.fn() }),
        getWidth: () => chartWidth,
        getHeight: () => chartHeight,
        getZr: () => ({ on: vi.fn() }),
        on: (name: string, callback: () => void) => callbacks.set(name, callback),
        dispatchAction: vi.fn((action: { type: string; zoom?: number }) => {
            if (action.type === "graphRoam") {
                series.zoom *= action.zoom ?? 1;
                callbacks.get("graphRoam")?.();
            }
        }),
        resize: vi.fn(() => {
            chartWidth = width;
            chartHeight = height;
        }),
        dispose: vi.fn(),
    };
}
// The real component passes the same RefObject on each render.
const mountStable = (selected: string | null = null) => {
    const ref = { current: container };
    return renderHook(props => useRelationChart(ref, props.nodes, props.edges, props.selected, vi.fn()), {
        initialProps: { nodes, edges, selected },
    });
};
beforeEach(() => {
    vi.clearAllMocks();
    mocks.preference.isDark = false;
    width = 1300;
    height = 480;
    container = document.createElement("div");
    document.body.append(container);
    Object.defineProperties(container, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
    series = { data: [], zoom: 1, center: [0, 0], links: [] };
    layouts = new Map();
    chart = createChart();
    mocks.init.mockReturnValue(chart);
    vi.stubGlobal(
        "ResizeObserver",
        class {
            constructor(callback: () => void) {
                resizeCallback = callback;
            }
            observe() {}
            disconnect() {}
        },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frameCallback = callback;
        return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
    cleanup();
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

it("使用 Canvas 静态布局，重布局恢复基线且状态切换无延迟动画或二次 fit", () => {
    vi.useFakeTimers();
    const hook = mountStable();
    expect(mocks.init).toHaveBeenCalledWith(container, undefined, { renderer: "canvas" });
    expect(chart.setOption.mock.calls[0][0]).toMatchObject({
        animation: false,
        animationDurationUpdate: 0,
        series: [{ layout: "none", animation: false, zoom: 1 }],
    });
    const baseline = series.data.map(node => [node.id, node.x, node.y]);
    layouts.set(bom.id, [99999, 99999]);
    act(() => hook.result.current.reset());
    expect(series.data.map(node => [node.id, node.x, node.y])).toEqual(baseline);
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    const next = { ...bom, id: "bom:new" };
    hook.rerender({ nodes: [next], edges: [], selected: null });
    expect(series.data.map(node => node.id)).toEqual(["bom:new"]);
    expect(mocks.layout).toHaveBeenCalledTimes(2);
    expect(series.center).toEqual([series.data[0].x, series.data[0].y]);
    const count = chart.setOption.mock.calls.length;
    act(() => vi.advanceTimersByTime(5000));
    expect(chart.setOption).toHaveBeenCalledTimes(count);
    vi.useRealTimers();
});

it("选择、主题和 Resize 保留坐标与视角，只对屏幕节点大小及标签降级", () => {
    const hook = mountStable();
    act(() => hook.result.current.zoomBy(1.2));
    const center = [...series.center];
    hook.rerender({ nodes, edges, selected: bom.id });
    mocks.preference.isDark = true;
    hook.rerender({ nodes, edges, selected: bom.id });
    expect(hook.result.current.zoom).toBe(1.2);
    expect(series.zoom).toBe(1.2);
    expect(series.center).toEqual(center);
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    const baseline = series.data.map(node => [node.id, node.x, node.y]);
    const desktopSize = series.data[0].symbolSize;
    const calls = chart.setOption.mock.calls.length;
    width = 375;
    act(() => {
        resizeCallback();
        frameCallback?.(0);
    });
    expect(chart.resize).toHaveBeenCalledWith({ animation: { duration: 0 } });
    expect(series.data[0].symbolSize).toBeLessThan(desktopSize);
    expect(series.data.map(node => [node.id, node.x, node.y])).toEqual(baseline);
    expect(series.zoom).toBe(1.2);
    expect(series.center).toEqual(center);
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    for (const [option] of chart.setOption.mock.calls.slice(calls)) {
        expect(option.series[0]).not.toHaveProperty("zoom");
        expect(option.series[0]).not.toHaveProperty("center");
    }
});

it("方向键移动当前节点时同步连线，主题更新保留手动位置", () => {
    const hook = mountStable(bom.id);
    const before = layouts.get(bom.id)!;
    fireEvent.keyDown(container, { key: "ArrowRight" });
    expect(layouts.get(bom.id)).toEqual([before[0] + 18, before[1]]);
    expect(edgeLayout).toHaveBeenCalledTimes(edges.length);
    mocks.preference.isDark = true;
    hook.rerender({ nodes, edges, selected: bom.id });
    expect(series.data.find(node => node.id === bom.id)?.x).toBe(before[0] + 18);
});

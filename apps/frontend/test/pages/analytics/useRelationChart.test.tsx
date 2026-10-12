// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { KeyboardEvent, PointerEvent } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRelationChart } from "@/pages/analytics/useRelationChart";
import { history } from "./relationFixtures";

const data = history(1, 1, 3, 2);
const nodes = data.nodes.filter(node => node.type !== "customer" && node.type !== "person");
let container: HTMLDivElement, svg: SVGSVGElement;
let resize: () => void;
beforeEach(() => {
    container = document.createElement("div");
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    container.append(svg);
    document.body.append(container);
    Object.defineProperties(container, { clientWidth: { value: 1200 }, clientHeight: { value: 560 } });
    vi.stubGlobal(
        "ResizeObserver",
        class {
            constructor(callback: () => void) {
                resize = callback;
            }
            observe() {}
            disconnect() {}
        },
    );
});
afterEach(() => {
    cleanup();
    container.remove();
    vi.unstubAllGlobals();
});
const pointer = (x: number, y: number) =>
    ({ button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: svg }) as PointerEvent<SVGSVGElement>;
const mount = () => {
    const ref = { current: container },
        select = vi.fn();
    const hook = renderHook(props => useRelationChart(ref, nodes, data.edges, props.selected, select), {
        initialProps: { selected: "bom:0" as string | null },
    });
    return { ...hook, select };
};
it("指针拖动BOM时所有子单据同步移动，拖动不会触发选择；重布局恢复原位", () => {
    const hook = mount();
    const before = hook.result.current.positions;
    act(() => hook.result.current.pointerDown(pointer(100, 100), "bom:0"));
    act(() => hook.result.current.pointerMove(pointer(150, 130)));
    act(() => hook.result.current.pointerUp(pointer(150, 130)));
    act(() => hook.result.current.clickNode(null));
    for (const node of nodes)
        expect(hook.result.current.positions.get(node.id)).toEqual([
            before.get(node.id)![0] + 50,
            before.get(node.id)![1] + 30,
        ]);
    expect(hook.select).not.toHaveBeenCalled();
    act(() => hook.result.current.reset());
    expect(hook.result.current.positions).toEqual(before);
});
it("订单拖动仅带动自己的出库，方向键与指针使用相同的归属规则", () => {
    const hook = mount(),
        before = hook.result.current.positions;
    hook.rerender({ selected: "order:0:0" });
    act(() =>
        hook.result.current.keyDown({
            key: "ArrowRight",
            target: container,
            currentTarget: container,
            preventDefault: vi.fn(),
        } as unknown as KeyboardEvent<HTMLDivElement>),
    );
    expect(hook.result.current.positions.get("bom:0")).toEqual(before.get("bom:0"));
    expect(hook.result.current.positions.get("order:0:0")).toEqual([
        before.get("order:0:0")![0] + 18,
        before.get("order:0:0")![1],
    ]);
    expect(hook.result.current.positions.get("outbound:0:0:0")).toEqual([
        before.get("outbound:0:0:0")![0] + 18,
        before.get("outbound:0:0:0")![1],
    ]);
});
it("点击没有拖动的节点只选择一次；缩放、选择和resize保留手动位置", () => {
    const hook = mount();
    act(() => hook.result.current.pointerDown(pointer(100, 100), "bom:0"));
    act(() => hook.result.current.pointerUp(pointer(100, 100)));
    act(() => hook.result.current.cancelPointer());
    act(() => hook.result.current.clickNode(null));
    expect(hook.select).toHaveBeenCalledExactlyOnceWith("bom:0");
    act(() => hook.result.current.zoomBy(1.2));
    const view = hook.result.current.view,
        positions = hook.result.current.positions;
    hook.rerender({ selected: "inbound:0:1" });
    act(() => resize());
    expect(hook.result.current.view).toEqual(view);
    expect(hook.result.current.positions).toEqual(positions);
});

it("查找画布外的节点时移到视口中央，保留节点手动坐标", () => {
    const hook = mount();
    act(() => hook.result.current.pointerDown(pointer(100, 100), "bom:0"));
    act(() => hook.result.current.pointerMove(pointer(10000, 10000)));
    act(() => hook.result.current.pointerUp(pointer(10000, 10000)));
    const positions = hook.result.current.positions;
    hook.rerender({ selected: "order:0:0" });
    const point = hook.result.current.positions.get("order:0:0")!,
        camera = hook.result.current.view;
    expect(camera.x + (point[0] + 90) * camera.scale).toBe(600);
    expect(camera.y + (point[1] + 34) * camera.scale).toBe(280);
    expect(hook.result.current.positions).toEqual(positions);
});

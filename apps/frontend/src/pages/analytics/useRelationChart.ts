import {
    useCallback,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent,
    type KeyboardEvent,
    type RefObject,
} from "react";
import type { RelationEdge, RelationNode } from "@/data/relations";
import { buildRelationLayout, RELATION_CARD, relationDragIds, type RelationPoint } from "./relationLayout";

type View = { x: number; y: number; scale: number };
const clampZoom = (scale: number, minScale = 0.7) => Math.max(minScale, Math.min(2, scale));

export function fitRelationView(
    points: Map<string, RelationPoint>,
    width: number,
    height: number,
    minScale = 0.7,
): View {
    if (!points.size) return { x: 0, y: 0, scale: 1 };
    const values = [...points.values()];
    const minX = Math.min(...values.map(point => point[0])),
        maxX = Math.max(...values.map(point => point[0])) + RELATION_CARD.width;
    const minY = Math.min(...values.map(point => point[1])),
        maxY = Math.max(...values.map(point => point[1])) + RELATION_CARD.height;
    const scale = Math.min(
        1,
        clampZoom(
            Math.min(Math.max(1, width - 64) / (maxX - minX), Math.max(1, height - 96) / (maxY - minY)),
            minScale,
        ),
    );
    return {
        x: Math.max(24, (width - (maxX - minX) * scale) / 2) - minX * scale,
        y: (height - (maxY - minY) * scale) / 2 - minY * scale,
        scale,
    };
}

/** Bounded SVG tree interaction: no simulation, render loop, or private chart runtime. */
export function useRelationChart(
    containerRef: RefObject<HTMLDivElement | null>,
    nodes: RelationNode[],
    edges: RelationEdge[],
    selected: string | null,
    onSelect: (id: string | null) => void,
    layout?: Map<string, RelationPoint>,
    minScale = 0.7,
) {
    const baseline = useMemo(() => layout ?? buildRelationLayout(nodes, edges), [nodes, edges, layout]);
    const [geometry, setGeometry] = useState({ baseline, positions: baseline });
    // A new page must render its own points immediately, before layout effects run.
    const positions = geometry.baseline === baseline ? geometry.positions : baseline;
    const [view, setView] = useState<View>({ x: 24, y: 24, scale: 1 });
    const positionsRef = useRef(positions);
    const viewRef = useRef(view);
    const manualView = useRef(false);
    const drag = useRef<{
        pointerId: number;
        start: RelationPoint;
        id: string | null;
        positions: Map<string, RelationPoint>;
        view: View;
        moved: boolean;
        ids: Set<string>;
    } | null>(null);
    const suppressClick = useRef(false);
    useLayoutEffect(() => {
        positionsRef.current = positions;
        viewRef.current = view;
    }, [positions, view]);

    const fit = useCallback(() => {
        const container = containerRef.current;
        if (container)
            setView(
                fitRelationView(
                    positionsRef.current,
                    container.clientWidth || 1000,
                    container.clientHeight || 560,
                    minScale,
                ),
            );
    }, [containerRef, minScale]);
    useLayoutEffect(() => {
        positionsRef.current = baseline;
        setGeometry({ baseline, positions: baseline });
        manualView.current = false;
        fit();
    }, [baseline, fit]);
    useLayoutEffect(() => {
        const point = selected ? positionsRef.current.get(selected) : null;
        const container = containerRef.current;
        if (!point || !container) return;
        const width = container.clientWidth || 1000,
            height = container.clientHeight || 560,
            camera =
                geometry.baseline === baseline ? viewRef.current : fitRelationView(baseline, width, height, minScale);
        const x = camera.x + (point[0] + RELATION_CARD.width / 2) * camera.scale;
        const y = camera.y + (point[1] + RELATION_CARD.height / 2) * camera.scale;
        if (x < 24 || x > width - 24 || y < 32 || y > height - 32) {
            manualView.current = true;
            setView({
                ...camera,
                x: width / 2 - (point[0] + RELATION_CARD.width / 2) * camera.scale,
                y: height / 2 - (point[1] + RELATION_CARD.height / 2) * camera.scale,
            });
        }
    }, [selected, baseline, containerRef, geometry.baseline, minScale]);

    const zoomBy = useCallback(
        (factor: number, origin?: RelationPoint) => {
            const container = containerRef.current;
            if (!container) return;
            manualView.current = true;
            const [x, y] = origin ?? [container.clientWidth / 2, container.clientHeight / 2];
            setView(current => {
                const scale = clampZoom(current.scale * factor, minScale),
                    ratio = scale / current.scale;
                return { scale, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio };
            });
        },
        [containerRef, minScale],
    );
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = container.getBoundingClientRect();
            zoomBy(Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.002), [
                event.clientX - rect.left,
                event.clientY - rect.top,
            ]);
        };
        container.addEventListener("wheel", wheel, { passive: false });
        const observer = new ResizeObserver(() => {
            if (!manualView.current) fit();
        });
        observer.observe(container);
        return () => {
            container.removeEventListener("wheel", wheel);
            observer.disconnect();
        };
    }, [containerRef, zoomBy, fit]);

    const move = (initial: Map<string, RelationPoint>, ids: Set<string>, dx: number, dy: number) => {
        manualView.current = true;
        const next = new Map(initial);
        for (const id of ids) {
            const point = initial.get(id);
            if (point) next.set(id, [point[0] + dx, point[1] + dy]);
        }
        positionsRef.current = next;
        setGeometry({ baseline, positions: next });
    };
    return {
        positions,
        view,
        zoom: view.scale,
        fit,
        zoomBy,
        reset: () => {
            manualView.current = false;
            positionsRef.current = baseline;
            setGeometry({ baseline, positions: baseline });
            fit();
        },
        pointerDown: (event: PointerEvent<SVGSVGElement>, id: string | null) => {
            if (event.button !== 0 || drag.current) return;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            containerRef.current?.focus({ preventScroll: true });
            suppressClick.current = false;
            drag.current = {
                pointerId: event.pointerId,
                start: [event.clientX, event.clientY],
                id,
                positions: positionsRef.current,
                view: viewRef.current,
                moved: false,
                ids: id ? relationDragIds(nodes, id) : new Set(),
            };
        },
        pointerMove: (event: PointerEvent<SVGSVGElement>) => {
            const gesture = drag.current;
            if (!gesture || gesture.pointerId !== event.pointerId) return;
            const dx = event.clientX - gesture.start[0],
                dy = event.clientY - gesture.start[1];
            if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
            gesture.moved = true;
            if (gesture.id) move(gesture.positions, gesture.ids, dx / gesture.view.scale, dy / gesture.view.scale);
            else {
                manualView.current = true;
                setView({ ...gesture.view, x: gesture.view.x + dx, y: gesture.view.y + dy });
            }
        },
        pointerUp: (event: PointerEvent<SVGSVGElement>) => {
            if (drag.current?.pointerId !== event.pointerId) return;
            if (!drag.current.moved) onSelect(drag.current.id);
            suppressClick.current = true;
            drag.current = null;
            if (event.currentTarget.hasPointerCapture?.(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
        },
        cancelPointer: () => {
            if (drag.current) {
                drag.current = null;
                suppressClick.current = true;
            }
        },
        clickNode: (id: string | null) => {
            if (!suppressClick.current) onSelect(id);
            suppressClick.current = false;
        },
        keyDown: (event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Escape") {
                onSelect(null);
                return;
            }
            if (event.target !== event.currentTarget) return;
            if (["+", "=", "-"].includes(event.key)) {
                event.preventDefault();
                zoomBy(event.key === "-" ? 1 / 1.2 : 1.2);
            }
            if (event.key === "Home") {
                event.preventDefault();
                fit();
            }
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
                event.preventDefault();
                const dx = event.key === "ArrowLeft" ? -18 : event.key === "ArrowRight" ? 18 : 0;
                const dy = event.key === "ArrowUp" ? -18 : event.key === "ArrowDown" ? 18 : 0;
                if (selected && positionsRef.current.has(selected))
                    move(
                        positionsRef.current,
                        relationDragIds(nodes, selected),
                        dx / viewRef.current.scale,
                        dy / viewRef.current.scale,
                    );
                else {
                    manualView.current = true;
                    setView(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
                }
            }
        },
    };
}

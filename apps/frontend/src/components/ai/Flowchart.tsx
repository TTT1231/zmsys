import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/lib/icons";
import { Modal } from "@/components/ui/Modal";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;

function FlowchartPreview({ svg }: { svg: string }) {
    const stage = useRef<HTMLDivElement>(null);
    const diagram = useRef<HTMLDivElement>(null);
    const drag = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
    const [diagramSize, setDiagramSize] = useState({ width: 0, height: 0 });
    const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const svgHtml = useMemo(() => ({ __html: svg }), [svg]);

    useLayoutEffect(() => {
        const svgElement = diagram.current?.querySelector("svg");
        if (!svgElement) return;
        const viewBox = svgElement.viewBox.baseVal;
        const width = viewBox.width || Number.parseFloat(svgElement.getAttribute("width") ?? "");
        const height = viewBox.height || Number.parseFloat(svgElement.getAttribute("height") ?? "");
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

        // Mermaid's responsive width is useful in the chat bubble, but the preview needs the SVG's
        // original coordinate size so that fitting accounts for both its width and its height.
        svgElement.style.setProperty("width", `${width}px`, "important");
        svgElement.style.setProperty("height", `${height}px`, "important");
        svgElement.style.setProperty("max-width", "none", "important");
        svgElement.style.setProperty("max-height", "none", "important");
        setDiagramSize({ width, height });
    }, [svg]);

    useLayoutEffect(() => {
        const element = stage.current;
        if (!element) return;
        const measure = () => setStageSize({ width: element.clientWidth, height: element.clientHeight });
        measure();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
        observer?.observe(element);
        window.addEventListener("resize", measure);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, []);

    const fitScale =
        diagramSize.width > 0 && diagramSize.height > 0 && stageSize.width > 0 && stageSize.height > 0
            ? Math.min(stageSize.width / diagramSize.width, stageSize.height / diagramSize.height) * 0.94
            : 1;
    const scale = fitScale * zoom;

    const changeZoom = (next: number, point?: { x: number; y: number }) => {
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
        if (point && scale > 0) {
            const nextScale = fitScale * nextZoom;
            setPan(current => ({
                x: point.x - ((point.x - current.x) / scale) * nextScale,
                y: point.y - ((point.y - current.y) / scale) * nextScale,
            }));
        }
        setZoom(nextZoom);
    };

    const resetView = () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    };

    return (
        <div className="ai-flowchart-preview">
            <div className="ai-flowchart-preview-toolbar" role="toolbar" aria-label="流程图缩放工具">
                <span className="ai-flowchart-preview-hint">滚轮缩放，按住拖动画布</span>
                <div className="ai-flowchart-preview-controls">
                    <button
                        type="button"
                        className="ai-flowchart-control ai-flowchart-zoom-button"
                        aria-label="缩小流程图"
                        title="缩小"
                        disabled={zoom <= MIN_ZOOM}
                        onClick={() => changeZoom(zoom / 1.25)}
                    >
                        <Icon name="minus" size={16} />
                    </button>
                    <span className="ai-flowchart-zoom-level" aria-live="polite">
                        {Math.round(zoom * 100)}%
                    </span>
                    <button
                        type="button"
                        className="ai-flowchart-control ai-flowchart-zoom-button"
                        aria-label="放大流程图"
                        title="放大"
                        disabled={zoom >= MAX_ZOOM}
                        onClick={() => changeZoom(zoom * 1.25)}
                    >
                        <Icon name="plus" size={16} />
                    </button>
                    <button type="button" className="ai-flowchart-control ai-flowchart-fit-button" onClick={resetView}>
                        适应全图
                    </button>
                </div>
            </div>
            <div
                ref={stage}
                className={`ai-flowchart-preview-stage${dragging ? " is-dragging" : ""}`}
                role="region"
                aria-label="可缩放流程图画布"
                tabIndex={0}
                onPointerDown={event => {
                    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
                    drag.current = {
                        pointerId: event.pointerId,
                        x: event.clientX,
                        y: event.clientY,
                        panX: pan.x,
                        panY: pan.y,
                    };
                    setDragging(true);
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={event => {
                    const activeDrag = drag.current;
                    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
                    setPan({
                        x: activeDrag.panX + event.clientX - activeDrag.x,
                        y: activeDrag.panY + event.clientY - activeDrag.y,
                    });
                }}
                onPointerUp={event => {
                    if (drag.current?.pointerId !== event.pointerId) return;
                    drag.current = null;
                    setDragging(false);
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                    drag.current = null;
                    setDragging(false);
                }}
                onLostPointerCapture={() => {
                    drag.current = null;
                    setDragging(false);
                }}
                onWheel={event => {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    const factor = Math.exp(-event.deltaY * 0.0015);
                    changeZoom(zoom * factor, {
                        x: event.clientX - rect.left - rect.width / 2,
                        y: event.clientY - rect.top - rect.height / 2,
                    });
                }}
                onKeyDown={event => {
                    if (event.key === "+" || event.key === "=") {
                        event.preventDefault();
                        changeZoom(zoom * 1.25);
                    } else if (event.key === "-") {
                        event.preventDefault();
                        changeZoom(zoom / 1.25);
                    } else if (event.key === "Home") {
                        event.preventDefault();
                        resetView();
                    } else if (event.key.startsWith("Arrow")) {
                        event.preventDefault();
                        const distance = event.shiftKey ? 48 : 20;
                        const deltaX =
                            event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0;
                        const deltaY = event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0;
                        setPan(current => ({
                            x: current.x + deltaX,
                            y: current.y + deltaY,
                        }));
                    }
                }}
            >
                <div
                    ref={diagram}
                    className="ai-flowchart-preview-diagram"
                    style={
                        {
                            "--flowchart-scale": scale,
                            "--flowchart-pan-x": `${pan.x}px`,
                            "--flowchart-pan-y": `${pan.y}px`,
                        } as CSSProperties
                    }
                    dangerouslySetInnerHTML={svgHtml}
                />
            </div>
        </div>
    );
}

export function Flowchart({ code, pending }: { code: string; pending: boolean }) {
    const id = useId().replace(/[^a-zA-Z0-9]/g, "");
    const [error, setError] = useState(false);
    const [revision, setRevision] = useState(0);
    const [svg, setSvg] = useState("");
    const [zoom, setZoom] = useState(false);
    // React 19 按 prop 对象引用比较 dangerouslySetInnerHTML，稳定对象避免重渲染时重建已显示的图形。
    const svgHtml = useMemo(() => ({ __html: svg }), [svg]);
    useEffect(() => {
        const observer = new MutationObserver(() => setRevision(value => value + 1));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (pending) return;
        let cancelled = false;
        setError(false);
        // 图形只接受流程图，不允许模型覆盖渲染设置或引入链接/图片。
        if (
            code.length > 6000 ||
            !/^\s*(?:flowchart|graph)\s+(?:TD|TB|LR|RL|BT)\b/.test(code) ||
            /%%\{|\bclick\b|@\{|<|https?:/i.test(code)
        ) {
            setError(true);
            return;
        }
        void import("mermaid")
            .then(async ({ default: mermaid }) => {
                mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: "strict",
                    suppressErrorRendering: true,
                    theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral",
                    flowchart: { htmlLabels: false, useMaxWidth: true, curve: "linear" },
                    maxEdges: 40,
                });
                const rendered = await mermaid.render(`ai-flow-${id}-${revision}`, code);
                if (!cancelled) setSvg(rendered.svg);
            })
            .catch(() => {
                if (!cancelled) setError(true);
            });
        return () => {
            cancelled = true;
        };
    }, [code, id, pending, revision]);
    return (
        <figure className="ai-flowchart" aria-label="操作流程图">
            <figcaption>
                <span>操作流程</span>
                {!pending && !error && svg && (
                    <button
                        type="button"
                        className="ai-flowchart-view"
                        aria-label="放大查看流程图"
                        title="放大查看"
                        onClick={() => setZoom(true)}
                    >
                        <Icon name="maximize" size={14} />
                    </button>
                )}
            </figcaption>
            {pending ? (
                <p role="status">正在绘制流程图…</p>
            ) : error ? (
                <p>流程图暂时无法显示，请按文字步骤操作。</p>
            ) : null}
            <div
                className="ai-flowchart-canvas"
                role="img"
                aria-label="操作流程图"
                title="放大查看"
                hidden={pending || error || !svg}
                onClick={() => setZoom(true)}
                dangerouslySetInnerHTML={svgHtml}
            />
            {zoom && (
                <Modal open onClose={() => setZoom(false)} title="操作流程图" width={1440} layout="workspace">
                    <FlowchartPreview svg={svg} />
                </Modal>
            )}
        </figure>
    );
}

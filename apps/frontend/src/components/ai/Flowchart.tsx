import { useEffect, useId, useMemo, useState } from "react";
import { Icon } from "@/lib/icons";
import { Modal } from "@/components/ui/Modal";

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
                <Modal open onClose={() => setZoom(false)} title="操作流程图" width={900}>
                    <div className="ai-flowchart-zoom" dangerouslySetInnerHTML={svgHtml} />
                </Modal>
            )}
        </figure>
    );
}

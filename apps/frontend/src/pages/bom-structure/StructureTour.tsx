import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/* BOM 结构页的操作引导（BomTour 原型的 React 移植）：全屏遮罩用 SVG mask 按目标挖孔、
   目标套高亮圈，说明卡片按 右/下/左/上 评分贴边定位；
   受控渲染——父组件条件挂载即开始，跳过 / 完成 / Esc 一律回调 onClose 由父组件卸载。
   挂载时过滤掉目标不可见的步骤（全部不可见则直接关闭）；进行中目标消失时沿当前方向自动跳步，
   两端越界即关闭。挖孔 / 光圈 / 卡片坐标是逐帧命令式更新（rAF 节流），React 只渲染卡片内容。 */

export interface TourStep {
    title: string;
    text: string;
    note?: string;
    /** 每步的目标元素（可见者）；返回空数组/不可见 → 该步自动跳过 */
    targets: () => HTMLElement[];
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** 可见 = 仍在文档中、有布局盒子、未被 display / visibility 隐藏 */
function isVisible(element: HTMLElement | null | undefined): boolean {
    if (!element || !element.isConnected || !element.getClientRects().length) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
}

interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

/** 目标矩形外扩 7px 并夹进视口（留 3px 边距）；零尺寸盒子丢弃 */
function targetRects(elements: HTMLElement[]): Rect[] {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    return elements
        .map(element => {
            const box = element.getBoundingClientRect();
            const padding = 7;
            const left = Math.max(3, box.left - padding);
            const top = Math.max(3, box.top - padding);
            const right = Math.min(viewportWidth - 3, box.right + padding);
            const bottom = Math.min(viewportHeight - 3, box.bottom + padding);
            return { left, top, right, bottom, width: right - left, height: bottom - top };
        })
        .filter(box => box.width > 0 && box.height > 0);
}

function overlapArea(a: Rect, b: Rect): number {
    return (
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
    );
}

/** 聚光灯操作引导：遮罩挖孔 + 说明卡片；受控渲染（父组件条件挂载），关闭时回调 onClose */
export function StructureTour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }): ReactNode {
    /* 挂载时锁定"当前有可见目标"的步骤子集，进度与计数都基于它（同原型 start() 的过滤） */
    const [activeSteps] = useState(() => steps.filter(step => step.targets().some(isVisible)));
    const [index, setIndex] = useState(0);
    const rawId = useId();
    const layerRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLElement>(null);
    const holesRef = useRef<SVGGElement>(null);
    const ringsRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const nextButtonRef = useRef<HTMLButtonElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const observerRef = useRef<ResizeObserver | null>(null);
    const frameRef = useRef(0);
    const focusFrameRef = useRef(0);
    /* 命令式侧的当前步与方向：rAF / 原生监听里读写；React 状态只负责卡片内容渲染 */
    const cursorRef = useRef({ index: 0, direction: 1 as 1 | -1 });
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    /* 从 start 起沿 direction 找下一个有可见目标的步骤；两端越界 → 关闭 */
    const goTo = useCallback(
        (start: number, direction: 1 | -1) => {
            let next = start;
            while (next >= 0 && next < activeSteps.length) {
                if (activeSteps[next].targets().some(isVisible)) break;
                next += direction;
            }
            if (next < 0 || next >= activeSteps.length) {
                onCloseRef.current();
                return;
            }
            cursorRef.current = { index: next, direction };
            setIndex(next);
        },
        [activeSteps],
    );

    /* 卡片贴边定位：以首个目标为锚，候选位 右/下/左/上 各自夹进视口（12px 边距）后评分，
       评分 = 与各目标的遮挡面积 ×10 + 钳位偏移量 + 方向优先级，取最小；无目标时居中 */
    const positionCard = useCallback((boxes: Rect[]) => {
        const card = cardRef.current;
        if (!card) return;
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight;
        const size = card.getBoundingClientRect();
        const anchor = boxes[0];
        if (!anchor) {
            card.style.left = `${Math.max(12, (viewportWidth - size.width) / 2)}px`;
            card.style.top = `${Math.max(12, (viewportHeight - size.height) / 2)}px`;
            return;
        }
        const gap = 18;
        const best = [
            { x: anchor.right + gap, y: anchor.top, priority: viewportWidth > 680 ? 0 : 3 },
            { x: anchor.left, y: anchor.bottom + gap, priority: 1 },
            { x: anchor.left - size.width - gap, y: anchor.top, priority: 2 },
            { x: anchor.left, y: anchor.top - size.height - gap, priority: 3 },
        ]
            .map(candidate => {
                const x = Math.max(12, Math.min(candidate.x, viewportWidth - size.width - 12));
                const y = Math.max(12, Math.min(candidate.y, viewportHeight - size.height - 12));
                const rect = {
                    left: x,
                    top: y,
                    right: x + size.width,
                    bottom: y + size.height,
                    width: size.width,
                    height: size.height,
                };
                const score =
                    boxes.reduce((sum, box) => sum + overlapArea(rect, box), 0) * 10 +
                    Math.abs(x - candidate.x) +
                    Math.abs(y - candidate.y) +
                    candidate.priority;
                return { x, y, score };
            })
            .sort((a, b) => a.score - b.score)[0];
        card.style.left = `${best.x}px`;
        card.style.top = `${best.y}px`;
    }, []);

    /* 重画挖孔 / 高亮圈并给卡片定位；当前步目标全部消失 → 沿当前方向跳步 */
    const position = useCallback(() => {
        const step = activeSteps[cursorRef.current.index];
        if (!step) return;
        const targets = step.targets().filter(isVisible);
        if (!targets.length) {
            const { index: current, direction } = cursorRef.current;
            goTo(current + direction, direction);
            return;
        }
        const holes = holesRef.current;
        const rings = ringsRef.current;
        if (!holes || !rings) return;
        const boxes = targetRects(targets);
        /* mask 里的黑色矩形即挖孔（露出页面）；同位置再放一圈高亮框：表层光晕 + 主色描边 */
        holes.replaceChildren(
            ...boxes.map(box => {
                const hole = document.createElementNS(SVG_NS, "rect");
                hole.setAttribute("x", String(box.left));
                hole.setAttribute("y", String(box.top));
                hole.setAttribute("width", String(box.width));
                hole.setAttribute("height", String(box.height));
                hole.setAttribute("rx", "9");
                hole.setAttribute("fill", "black");
                return hole;
            }),
        );
        rings.replaceChildren(
            ...boxes.map(box => {
                const ring = document.createElement("div");
                ring.className =
                    "bom-tour-spotlight pointer-events-none absolute box-border rounded-[9px] border-2 border-primary shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-surface)_85%,transparent),0_0_0_6px_color-mix(in_srgb,var(--color-primary)_21%,transparent)]";
                ring.style.left = `${box.left}px`;
                ring.style.top = `${box.top}px`;
                ring.style.width = `${box.width}px`;
                ring.style.height = `${box.height}px`;
                return ring;
            }),
        );
        positionCard(boxes);
    }, [activeSteps, goTo, positionCard]);

    const positionRef = useRef(position);
    useEffect(() => {
        positionRef.current = position;
    }, [position]);

    /* rAF 节流：resize / scroll / ResizeObserver 的抖动合并到一帧重定位 */
    const schedule = useCallback(() => {
        if (frameRef.current) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = 0;
            positionRef.current();
        });
    }, []);

    /* 挂载即开引导：焦点陷阱 + 全局键盘 + 滚动屏蔽 + 定位订阅；卸载时还原焦点 */
    useLayoutEffect(() => {
        if (activeSteps.length === 0) {
            onCloseRef.current(); // 一个可见目标都没有：立即关闭（父组件随即卸载）
            return;
        }
        const layer = layerRef.current;
        const card = cardRef.current;
        if (!layer || !card) return;
        const activeElement = document.activeElement as HTMLElement | null;
        /* 只记录引导层外的焦点（开发环境 StrictMode 重挂载时焦点可能已在卡片标题上） */
        if (!activeElement || !layer.contains(activeElement)) previousFocusRef.current = activeElement;

        const focusableButtons = () =>
            Array.from(card.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")).filter(isVisible);
        const onKeyDown = (event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.key === "Escape") {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            /* Tab 只在卡片按钮间循环（shift 反向），页面其余部分不可达 */
            if (event.key === "Tab") {
                event.preventDefault();
                const buttons = focusableButtons();
                const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next = event.shiftKey
                    ? current <= 0
                        ? buttons.length - 1
                        : current - 1
                    : (current + 1) % buttons.length;
                buttons[next]?.focus({ preventScroll: true });
            }
            /* 吞掉会触发页面动作的快捷键（保存 / 撤销 / 重做 / 重命名） */
            if ((event.ctrlKey || event.metaKey) && ["s", "z", "y"].includes(event.key.toLowerCase())) {
                event.preventDefault();
            }
            if (event.key === "F2") event.preventDefault();
        };
        const onFocusIn = (event: FocusEvent) => {
            if (card.contains(event.target as Node)) return;
            /* 焦点被外部抢走 → 弹回"下一步"；rAF 合并连续 focusin */
            if (focusFrameRef.current) cancelAnimationFrame(focusFrameRef.current);
            focusFrameRef.current = requestAnimationFrame(() => {
                focusFrameRef.current = 0;
                nextButtonRef.current?.focus({ preventScroll: true });
            });
        };
        const onLayerClick = (event: MouseEvent) => {
            /* 点击只对 [data-tour-action] 按钮生效，其余一律阻断不给页面 */
            event.stopPropagation();
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tour-action]");
            if (!button || button.disabled) return;
            const current = cursorRef.current.index;
            const action = button.dataset.tourAction;
            if (action === "stop") onCloseRef.current();
            else if (action === "previous") goTo(current - 1, -1);
            else if (action === "next") {
                if (current === activeSteps.length - 1) onCloseRef.current();
                else goTo(current + 1, 1);
            }
        };
        const onPointerDown = (event: PointerEvent) => event.stopPropagation();
        const blockScroll = (event: Event) => {
            /* 卡片外禁止滚动穿透；必须 passive:false 才能 preventDefault */
            if (!card.contains(event.target as Node)) event.preventDefault();
            event.stopPropagation();
        };

        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("focusin", onFocusIn, true);
        window.addEventListener("resize", schedule);
        window.addEventListener("scroll", schedule, true);
        window.visualViewport?.addEventListener("resize", schedule);
        window.visualViewport?.addEventListener("scroll", schedule);
        layer.addEventListener("click", onLayerClick);
        layer.addEventListener("pointerdown", onPointerDown);
        layer.addEventListener("wheel", blockScroll, { passive: false });
        layer.addEventListener("touchmove", blockScroll, { passive: false });
        /* 卡片与各目标自身的尺寸变化（展开/收起、筛选）也要跟随重定位 */
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
        observerRef.current = observer;

        return () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
            if (focusFrameRef.current) cancelAnimationFrame(focusFrameRef.current);
            frameRef.current = 0;
            focusFrameRef.current = 0;
            observerRef.current = null;
            observer?.disconnect();
            document.removeEventListener("keydown", onKeyDown, true);
            document.removeEventListener("focusin", onFocusIn, true);
            window.removeEventListener("resize", schedule);
            window.removeEventListener("scroll", schedule, true);
            window.visualViewport?.removeEventListener("resize", schedule);
            window.visualViewport?.removeEventListener("scroll", schedule);
            /* 层元素随组件卸载一起移除，其上的监听无需解绑；焦点还给开启前的元素（仍可见且可用时） */
            requestAnimationFrame(() => {
                const previous = previousFocusRef.current;
                const disabled = (previous as (HTMLElement & { disabled?: boolean }) | null)?.disabled === true;
                if (previous && !disabled && isVisible(previous)) previous.focus({ preventScroll: true });
            });
        };
    }, [activeSteps, goTo, schedule]);

    /* 换步（index 变化）：内容已随渲染更新，这里做命令式部分——重挂观察器、
       目标滚进视口、立即定位、聚焦标题（tabIndex=-1） */
    useLayoutEffect(() => {
        const step = activeSteps[index];
        if (!step) return;
        cursorRef.current.index = index;
        const observer = observerRef.current;
        observer?.disconnect();
        if (cardRef.current) observer?.observe(cardRef.current);
        const targets = step.targets().filter(isVisible);
        if (!targets.length) {
            /* 换步间隙目标已卸载：沿当前方向继续跳（越界由 goTo 关闭） */
            const { direction } = cursorRef.current;
            goTo(index + direction, direction);
            return;
        }
        targets[0].scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        position();
        titleRef.current?.focus({ preventScroll: true });
        schedule();
    }, [index, activeSteps, goTo, position, schedule]);

    if (activeSteps.length === 0) return null;
    const step = activeSteps[index];
    const maskId = `bom-tour-mask-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

    /* Portal 到 body：引导要盖过弹窗（z-150）与全部页面浮层，z-[300] 独占顶层 */
    return createPortal(
        <div ref={layerRef} data-bom-tour="" className="bom-tour isolate fixed inset-0 z-[300] touch-pan-y">
            <svg
                className="bom-tour-backdrop pointer-events-none absolute inset-0 h-full w-full"
                aria-hidden="true"
                focusable="false"
            >
                <defs>
                    <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width="100%" height="100%">
                        <rect x={0} y={0} width="100%" height="100%" fill="white" />
                        <g ref={holesRef} />
                    </mask>
                </defs>
                <rect
                    x={0}
                    y={0}
                    width="100%"
                    height="100%"
                    mask={`url(#${maskId})`}
                    className="bom-tour-shade fill-scrim"
                />
            </svg>
            <div ref={ringsRef} className="bom-tour-rings pointer-events-none absolute inset-0" aria-hidden="true" />
            <section
                ref={cardRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="bom-tour-title"
                aria-describedby={step.note ? "bom-tour-description bom-tour-note" : "bom-tour-description"}
                className="bom-tour-card absolute max-h-[calc(100dvh-24px)] w-[min(370px,calc(100vw-24px))] touch-pan-y overflow-auto overscroll-contain rounded-card border border-line bg-surface pb-3 pt-5 px-6 shadow-modal animate-fade-in motion-reduce:animate-none"
            >
                <div className="flex items-center justify-between">
                    <span className="text-12 font-semibold text-primary-strong">操作引导</span>
                    <button
                        type="button"
                        data-tour-action="stop"
                        className="-mx-1.5 -my-1.5 ml-2.5 min-h-8 rounded-md px-2 text-12 text-muted transition hover:bg-primary-soft hover:text-primary-strong"
                    >
                        跳过
                    </button>
                </div>
                <div className="mb-4.5 mt-3.5 flex h-[3px] gap-[5px]" aria-hidden="true">
                    {activeSteps.map((_, item) => (
                        <span
                            key={item}
                            className={`flex-1 rounded-[2px] ${item <= index ? "bg-primary" : "bg-line"}`}
                        />
                    ))}
                </div>
                <h2
                    id="bom-tour-title"
                    ref={titleRef}
                    tabIndex={-1}
                    className="mb-3 text-[19px] font-semibold leading-[1.45] text-ink outline-none [overflow-wrap:anywhere] max-[480px]:text-[18px]"
                >
                    {step.title}
                </h2>
                <p
                    id="bom-tour-description"
                    className="text-14 leading-[1.8] text-ink [overflow-wrap:anywhere] max-[480px]:text-13"
                >
                    {step.text}
                </p>
                {step.note && (
                    <p
                        id="bom-tour-note"
                        className="mt-3 rounded-md bg-primary-soft px-3 py-2.5 text-12 leading-[1.75] text-muted [overflow-wrap:anywhere]"
                    >
                        {step.note}
                    </p>
                )}
                <div className="mt-4.5 flex items-center justify-between gap-3">
                    <span
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                        className="tnum flex-none text-12 text-muted"
                    >
                        {index + 1} / {activeSteps.length}
                    </span>
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            data-tour-action="previous"
                            disabled={index === 0}
                            className="inline-flex min-h-9 min-w-[70px] items-center justify-center rounded-btn border border-line-strong bg-surface px-3 text-12 font-medium text-ink transition hover:border-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:border-line disabled:bg-soft disabled:text-placeholder"
                        >
                            上一步
                        </button>
                        <button
                            type="button"
                            ref={nextButtonRef}
                            data-tour-action="next"
                            className="inline-flex min-h-9 min-w-[70px] items-center justify-center rounded-btn border border-primary bg-primary px-3 text-12 font-medium text-white transition hover:border-primary-hover hover:bg-primary-hover"
                        >
                            {index === activeSteps.length - 1 ? "完成" : "下一步"}
                        </button>
                    </div>
                </div>
                <p className="mt-2.5 text-right text-[10px] text-muted">Esc 退出引导</p>
            </section>
        </div>,
        document.body,
    );
}

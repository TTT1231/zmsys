import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/lib/icons";
import { addDays, shortDate } from "@/lib/date";
import { plainNum } from "@/lib/format";
import {
    calendarDays,
    deliveryProgress,
    deliveryTimeSegments,
    initialDeliveryViewport,
    zoomDeliveryViewport,
    type DeliveryOrder,
    type DeliveryViewport,
} from "@/data/delivery-progress";
import type { WorkbenchData } from "@/data/workbench";
import "./delivery-progress.css";

type DeliveryStyle = CSSProperties & {
    "--bom-color"?: string;
    "--today-position"?: string;
    "--grid-width"?: string;
    "--grid-offset"?: string;
};

function DueDate({ order }: { order: DeliveryOrder }) {
    const urgent = order.daysLeft < 0 ? "text-danger" : order.daysLeft <= 3 ? "text-warning" : "text-muted";
    const label =
        order.daysLeft < 0 ? `逾期 ${-order.daysLeft} 天` : order.daysLeft === 0 ? "今天" : `剩 ${order.daysLeft} 天`;
    return (
        <div className="delivery-due flex flex-col gap-1 tnum">
            <time dateTime={order.due} className="text-14 font-semibold text-ink" title={order.due}>
                {shortDate(order.due)}
            </time>
            <span className={`text-12 font-medium ${urgent}`}>{label}</span>
        </div>
    );
}

function QuantityProgress({ order, unit }: { order: DeliveryOrder; unit: string }) {
    return (
        <div className="delivery-quantity min-w-0 tnum">
            <div
                className="delivery-progress-track"
                role="img"
                aria-label={`待交货 ${plainNum(order.remaining)} ${unit}；备货 ${order.readyPercent}%，已发 ${order.shippedPercent}%；订单 ${plainNum(order.qty)} ${unit}，已发 ${plainNum(order.shipped)}，可发 ${plainNum(order.available)}，缺口 ${plainNum(order.gap)}`}
            >
                <span className="delivery-shipped" style={{ width: `${(order.shipped / order.qty) * 100}%` }} />
                <span className="delivery-available" style={{ width: `${(order.available / order.qty) * 100}%` }} />
                <strong className="delivery-progress-value">{plainNum(order.remaining)}</strong>
            </div>
        </div>
    );
}

function OrderTimeline({ order, asOf, view }: { order: DeliveryOrder; asOf: string; view: DeliveryViewport }) {
    const span = deliveryTimeSegments(order, asOf, view.days, view.offset);
    return (
        <div
            className="delivery-timeline-cell"
            role="img"
            aria-label={`BOM ${order.bomCode}；下单 ${order.date}，交期 ${order.due}；已发 ${plainNum(order.shipped)}，可发 ${plainNum(order.available)}，缺口 ${plainNum(order.gap)}`}
            title={`${order.bomCode} · 已发 ${plainNum(order.shipped)} · 可发 ${plainNum(order.available)} · 缺口 ${plainNum(order.gap)}`}
        >
            <span className="delivery-chart-bom" style={{ left: `clamp(0px, ${span.left}%, calc(100% - 60px))` }}>
                {order.bomCode}
            </span>
            {span.width > 0 && (
                <span className="delivery-time-bar" style={{ left: `${span.left}%`, width: `${span.width}%` }}>
                    <span className="delivery-shipped" style={{ width: `${span.shippedWidth}%` }} />
                    <span className="delivery-available" style={{ width: `${span.availableWidth}%` }} />
                </span>
            )}
            <span
                className={`delivery-due-marker ${span.outside ? `delivery-due-${span.outside}` : ""}`}
                style={{ left: `${span.duePosition}%` }}
                aria-hidden="true"
            />
            {span.outside ? (
                <time dateTime={order.due} className={`delivery-outside-label delivery-outside-${span.outside}`}>
                    {span.outside === "before" ? "← " : ""}
                    {shortDate(order.due)}
                    {span.outside === "after" ? " →" : ""}
                </time>
            ) : (
                <time
                    dateTime={order.due}
                    className="delivery-chart-date"
                    style={{ left: `clamp(24px, ${span.duePosition}%, calc(100% - 24px))` }}
                >
                    {shortDate(order.due)}
                </time>
            )}
        </div>
    );
}

export function DeliveryProgress({ data }: { data: WorkbenchData }) {
    const orders = useMemo(() => deliveryProgress(data), [data]);
    const initialView = useMemo(() => initialDeliveryViewport(orders, data.asOf), [orders, data.asOf]);
    const [view, setView] = useState<DeliveryViewport>(initialView);
    const [dragging, setDragging] = useState(false);
    const viewRef = useRef(view);
    const bodyRef = useRef<HTMLDivElement>(null);
    const axisRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{
        x: number;
        y: number;
        top: number;
        width: number;
        view: DeliveryViewport;
        moved: boolean;
    } | null>(null);
    const start = addDays(data.asOf, Math.floor(view.offset));
    const end = addDays(data.asOf, Math.ceil(view.offset + view.days) - 1);
    const todayPosition = ((0.5 - view.offset) / view.days) * 100;
    const todayVisible = todayPosition > 0 && todayPosition < 100;
    const tickStep = view.days > 45 ? 7 : view.days > 24 ? 3 : view.days > 17 ? 2 : 1;
    const ticks = Array.from({ length: Math.ceil(view.days) + 1 }, (_, index) => {
        const date = addDays(start, index);
        const position = ((calendarDays(data.asOf, date) - view.offset + 0.5) / view.days) * 100;
        return { date, position };
    }).filter(tick => tick.position > 0 && tick.position < 100 && calendarDays(data.asOf, tick.date) % tickStep === 0);
    const timelineStyle: DeliveryStyle = {
        "--today-position": todayVisible ? `${todayPosition}%` : undefined,
        "--grid-width": `${(tickStep / view.days) * 100}%`,
        "--grid-offset": `${ticks[0]?.position ?? 0}%`,
    };

    useEffect(() => {
        viewRef.current = view;
    }, [view]);
    const hasOrders = orders.length > 0;
    useEffect(() => {
        const body = bodyRef.current;
        if (!body) return;
        const wheel = (event: WheelEvent) => {
            if (
                !event.ctrlKey ||
                !axisRef.current?.offsetWidth ||
                !(event.target instanceof Element) ||
                !event.target.closest(".delivery-timeline")
            )
                return;
            event.preventDefault();
            const rect = axisRef.current.getBoundingClientRect();
            const anchor = (event.clientX - rect.left) / rect.width;
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.width : 1);
            setView(current =>
                zoomDeliveryViewport(current, Math.exp(Math.max(-0.5, Math.min(0.5, delta * 0.003))), anchor),
            );
        };
        body.addEventListener("wheel", wheel, { passive: false });
        return () => body.removeEventListener("wheel", wheel);
    }, [hasOrders]);

    const reset = () => {
        setView(initialView);
        if (bodyRef.current) bodyRef.current.scrollTop = 0;
    };
    const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (
            event.button !== 0 ||
            event.pointerType === "touch" ||
            !(event.target instanceof Element) ||
            !event.target.closest(".delivery-timeline")
        )
            return;
        const width = axisRef.current?.offsetWidth ?? 0;
        dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            top: event.currentTarget.scrollTop,
            width,
            view: viewRef.current,
            moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        const x = event.clientX - drag.x,
            y = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(x, y) < 5) return;
        drag.moved = true;
        setDragging(true);
        if (drag.width > 0) setView({ ...drag.view, offset: drag.view.offset - (x / drag.width) * drag.view.days });
        event.currentTarget.scrollTop = drag.top - y;
    };
    const endDrag = () => {
        dragRef.current = null;
        setDragging(false);
    };
    const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setView(current => ({
                ...current,
                offset: current.offset + ((event.key === "ArrowLeft" ? -1 : 1) * current.days) / 5,
            }));
        } else if (["+", "=", "-"].includes(event.key)) {
            event.preventDefault();
            setView(current => zoomDeliveryViewport(current, event.key === "-" ? 1.25 : 0.8, 0.5));
        } else if (event.key === "Home") {
            event.preventDefault();
            reset();
        }
    };

    return (
        <section
            className="delivery-board rounded-panel border border-line bg-surface"
            aria-labelledby="delivery-title"
        >
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h1 id="delivery-title" className="text-17 font-semibold text-ink">
                        交付进度
                    </h1>
                    <span className="text-13 text-muted">{orders.length} 笔待交</span>
                </div>
                <time className="text-12 text-muted" dateTime={data.asOf}>
                    {data.asOf}
                </time>
            </div>
            {orders.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
                    <Icon name="check" size={28} className="text-success" />
                    <h2 className="text-17 font-medium text-ink">暂无待交订单</h2>
                </div>
            ) : (
                <>
                    <div className="delivery-legend flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-5 py-3 text-12 text-muted">
                        <span className="flex items-center gap-2">
                            <i className="delivery-legend-swatch delivery-shipped" />
                            已发
                        </span>
                        <span className="flex items-center gap-2">
                            <i className="delivery-legend-swatch delivery-available" />
                            可发
                        </span>
                        <span className="flex items-center gap-2">
                            <i className="delivery-legend-swatch delivery-pending" />
                            缺口
                        </span>
                        <span
                            className="ml-auto"
                            title="同 BOM 同色；条长表示下单到交期，分段表示已发、可发和缺口的数量占比，并非实际完成日期；库存是 BOM 当前总库存。"
                        >
                            同 BOM 同色
                        </span>
                    </div>
                    <div className="delivery-table" role="table" aria-label="未完成订单交付进度" style={timelineStyle}>
                        <div role="rowgroup" className="delivery-table-head">
                            <div className="delivery-grid delivery-column-headings" role="row">
                                <div role="columnheader" className="delivery-order-cell">
                                    订单 / BOM
                                </div>
                                <div role="columnheader" className="delivery-progress-heading">
                                    待交货 <span className="font-normal text-12 text-muted">{data.unit}</span>
                                </div>
                                <div role="columnheader" aria-sort="ascending">
                                    交期
                                </div>
                                <div role="columnheader" className="delivery-timeline-heading">
                                    <span className="text-12 font-normal text-muted" title={`${start} — ${end}`}>
                                        {shortDate(start)} — {shortDate(end)}
                                    </span>
                                    <div className="flex items-center">
                                        <Button
                                            iconOnly
                                            icon="minus"
                                            aria-label="缩小时间线"
                                            onClick={() => setView(current => zoomDeliveryViewport(current, 1.25, 0.5))}
                                            className="size-9 rounded-md"
                                        />
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={reset}
                                            className="min-h-9 px-2 text-12"
                                        >
                                            复位
                                        </Button>
                                        <Button
                                            iconOnly
                                            icon="plus"
                                            aria-label="放大时间线"
                                            onClick={() => setView(current => zoomDeliveryViewport(current, 0.8, 0.5))}
                                            className="size-9 rounded-md"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="delivery-grid delivery-axis-row" role="row" aria-hidden="true">
                                <div className="delivery-axis-note delivery-order-cell">按交期排列</div>
                                <div />
                                <div />
                                <div className="delivery-date-axis" ref={axisRef}>
                                    {ticks.map(tick => (
                                        <span
                                            key={tick.date}
                                            style={{ left: `clamp(18px, ${tick.position}%, calc(100% - 18px))` }}
                                            className={tick.date === data.asOf ? "delivery-today-date" : ""}
                                        >
                                            {tickStep >= 3 ? shortDate(tick.date) : tick.date.slice(8)}
                                        </span>
                                    ))}
                                    {todayVisible && (
                                        <small className="delivery-today-label" style={{ left: `${todayPosition}%` }}>
                                            今天
                                        </small>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div
                            role="rowgroup"
                            className={`delivery-body ${dragging ? "delivery-dragging" : ""}`}
                            ref={bodyRef}
                            tabIndex={0}
                            aria-label="拖动平移，Ctrl 加滚轮缩放；方向键平移，加减键缩放，Home 复位"
                            onPointerDown={beginDrag}
                            onPointerMove={moveDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            onLostPointerCapture={endDrag}
                            onKeyDown={keyboard}
                        >
                            {orders.map(order => {
                                const style: DeliveryStyle = {
                                    "--bom-color": `oklch(calc(${order.color.lightness}% + var(--delivery-bom-lift)) ${order.color.chroma} ${order.color.hue})`,
                                };
                                return (
                                    <div
                                        key={order.no}
                                        role="row"
                                        className="delivery-grid delivery-order-row"
                                        style={style}
                                    >
                                        <div role="cell" className="delivery-order-cell min-w-0">
                                            <div className="flex items-center gap-2 text-13 font-semibold text-ink">
                                                <span className="delivery-bom-dot" aria-hidden="true" />
                                                <span className="wrap-anywhere">{order.no}</span>
                                            </div>
                                            <div className="mt-1 text-12 text-td-strong wrap-anywhere">
                                                {order.customer}
                                            </div>
                                            <div
                                                className="delivery-bom-label mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-12"
                                                title={order.product?.spec}
                                            >
                                                <span>{order.bomCode}</span>
                                                <span
                                                    className="inline-flex items-baseline gap-1 font-normal not-italic text-td-strong tnum"
                                                    title="BOM 当前总库存；可发量按交期分配"
                                                >
                                                    <span>库存</span>
                                                    <strong className="text-14 font-bold text-primary-strong">
                                                        {plainNum(Math.max(0, order.product?.stock ?? 0))}
                                                    </strong>
                                                </span>
                                            </div>
                                        </div>
                                        <div role="cell">
                                            <QuantityProgress order={order} unit={order.product?.unit || data.unit} />
                                        </div>
                                        <div role="cell" className="delivery-due-cell">
                                            <DueDate order={order} />
                                        </div>
                                        <div
                                            role="cell"
                                            className={`delivery-timeline ${todayVisible ? "delivery-has-today" : ""}`}
                                        >
                                            <OrderTimeline order={order} asOf={data.asOf} view={view} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className="delivery-help flex flex-wrap justify-between gap-2 border-t border-line px-5 py-3 text-11 text-muted">
                        <span>拖动平移 · Ctrl + 滚轮缩放</span>
                        <span>◆ 交期</span>
                    </div>
                </>
            )}
        </section>
    );
}

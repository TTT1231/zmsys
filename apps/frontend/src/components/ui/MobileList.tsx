import type { ReactNode } from "react";
import type { Order, Snapshot } from "@/api";
import { BomCell } from "@/components/bom/BomCell";
import { bomByCode, maxShipOf, orderStatusOf, remainingOf } from "@/data/views";
import { num } from "@/lib/format";
import { todayIso } from "@/lib/date";
import { Badge, Button, StatusBadge } from "./Badge";
import { EmptyState } from "./EmptyState";
import { Loader } from "./Loader";

export function ListState({ loading, empty, children }: { loading?: boolean; empty: boolean; children: ReactNode }) {
    if (loading)
        return (
            <p role="status" className="flex items-center justify-center gap-2.5 p-8 text-14 text-muted">
                <Loader size={16} /> 正在加载…
            </p>
        );
    if (empty)
        return (
            <div role="status" className="p-8">
                <EmptyState description="没有匹配的记录，请调整搜索或筛选。" />
            </div>
        );
    return <>{children}</>;
}

export function RecordCard({
    title,
    subtitle,
    badge,
    children,
    actions,
    voided,
}: {
    title: ReactNode;
    subtitle?: ReactNode;
    badge?: ReactNode;
    children?: ReactNode;
    actions?: ReactNode;
    /** 作废记录：左竖条 + 危险底色 + 标题删除线（样式见 .record-card-voided） */
    voided?: boolean;
}) {
    return (
        <article className={voided ? "record-card record-card-voided" : "record-card"}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-14 font-semibold text-ink wrap-anywhere">{title}</h3>
                    {subtitle && <div className="mt-1 text-13 text-muted wrap-break-word">{subtitle}</div>}
                </div>
                {badge && <div className="shrink-0">{badge}</div>}
            </div>
            {children && <div className="mt-3 text-14 text-td">{children}</div>}
            {actions && <div className="record-card-actions">{actions}</div>}
        </article>
    );
}

/* 卡片键值行：标签左灰、值右对齐（数字/日期 tabular-nums），只用于短值指标；长文本仍走文字流 */
export function CardField({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
    return (
        <div className={`flex min-w-0 items-baseline justify-between gap-3 ${strong ? "card-metric" : ""}`}>
            <span className="text-14 text-muted">{label}</span>
            <span
                className={`min-w-0 tnum text-right wrap-anywhere ${strong ? "text-22 font-semibold text-ink" : "text-14 font-medium text-td"}`}
            >
                {value}
            </span>
        </div>
    );
}

export function OrderTaskCard({
    order,
    snap,
    onDetail,
    onShip,
    onEdit,
}: {
    order: Order;
    snap: Snapshot;
    onDetail: () => void;
    onShip?: () => void;
    onEdit?: () => void;
}) {
    const bom = bomByCode(snap, order.bomCode);
    const remaining = remainingOf(order);
    const cancelled = order.lifecycleStatus === "cancelled";
    const archived = order.lifecycleStatus === "archived";
    const status = orderStatusOf(snap, order);
    const maxShip = maxShipOf(snap, order.orderNo);
    const daysLate = Math.max(0, Math.floor((Date.parse(todayIso()) - Date.parse(order.deliverDate)) / 86400000));
    return (
        <RecordCard
            title={order.orderNo}
            subtitle={order.customer}
            badge={
                remaining > 0 && daysLate > 0 ? (
                    <Badge tone="danger">逾期 {daysLate} 天</Badge>
                ) : (
                    <StatusBadge status={status.key} label={status.label} />
                )
            }
            actions={
                <>
                    {onEdit && (
                        <Button variant="secondary" onClick={onEdit}>
                            编辑
                        </Button>
                    )}
                    <Button variant="secondary" onClick={onDetail}>
                        查看详情
                    </Button>
                    {onShip && maxShip > 0 && (
                        <Button icon="truck" onClick={onShip}>
                            登记发货
                        </Button>
                    )}
                </>
            }
        >
            <BomCell categories={snap.bomCategories} bom={bom} bomCode={order.bomCode} />
            <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
                <CardField label="交货日期" value={order.deliverDate} />
                <CardField label="已发 / 订单" value={`${num(order.outbound)} / ${num(order.qty)} 个`} />
                {!cancelled && !archived && <CardField label="待交数量" value={`${num(remaining)} 个`} strong />}
                {archived && (
                    <CardField
                        label="归档时间"
                        value={order.archivedAt ? new Date(order.archivedAt).toLocaleString() : "—"}
                    />
                )}
                {archived && <CardField label="归档人" value={order.archivedBy || "—"} />}
                {archived && <CardField label="归档备注" value={order.archiveReason || "—"} />}
                <div className="flex flex-wrap justify-between gap-2">
                    {cancelled ? <span className="text-muted">已停止交付</span> : null}
                    {archived ? <span className="text-muted">已归档</span> : null}
                    {!cancelled &&
                        !archived &&
                        (remaining > 0 ? (
                            <span className={maxShip > 0 ? "text-success" : "text-warning"}>
                                {maxShip > 0 ? `本次可发 ${num(maxShip)} 个` : "等待备货"}
                            </span>
                        ) : (
                            <span className="text-success">已全部交付</span>
                        ))}
                </div>
            </div>
        </RecordCard>
    );
}

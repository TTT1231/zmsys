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
            <p role="status" className="flex items-center justify-center gap-2.5 p-8 text-13 text-muted">
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
}: {
    title: ReactNode;
    subtitle?: ReactNode;
    badge?: ReactNode;
    children?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <article className="record-card">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-16 font-semibold text-ink break-words">{title}</h3>
                    {subtitle && <div className="mt-1 text-12 text-muted break-words">{subtitle}</div>}
                </div>
                {badge && <div className="shrink-0">{badge}</div>}
            </div>
            {children && <div className="mt-3 text-14 text-td">{children}</div>}
            {actions && <div className="mt-3 flex flex-wrap items-center justify-end gap-2">{actions}</div>}
        </article>
    );
}

/* 卡片键值行：标签左灰、值右对齐（数字/日期 tabular-nums），只用于短值指标；长文本仍走文字流 */
export function CardField({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <span className="text-13 text-muted">{label}</span>
            <span className={`tnum text-right text-13 ${strong ? "font-semibold text-ink" : "font-medium text-td"}`}>
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
    const status = orderStatusOf(snap, order);
    const maxShip = maxShipOf(snap, order.orderNo);
    const daysLate = Math.max(0, Math.floor((Date.parse(todayIso()) - Date.parse(order.deliverDate)) / 86400000));
    return (
        <RecordCard
            title={order.customer}
            subtitle={order.orderNo}
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
                    <Button variant={onShip && maxShip > 0 ? "secondary" : "primary"} onClick={onDetail}>
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
            <BomCell bom={bom} bomCode={order.bomCode} />
            <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
                <CardField label="交货日期" value={order.deliverDate} />
                <CardField label="已发 / 订单" value={`${num(order.outbound)} / ${num(order.qty)} 件`} />
                <div className="flex flex-wrap justify-between gap-2">
                    {cancelled ? (
                        <span className="text-muted">已停止交付</span>
                    ) : (
                        <span>
                            待交 <strong className="tnum text-ink">{num(remaining)}</strong> 件
                        </span>
                    )}
                    {!cancelled &&
                        (remaining > 0 ? (
                            <span className={maxShip > 0 ? "text-success" : "text-warning"}>
                                {maxShip > 0 ? `本次可发 ${num(maxShip)} 件` : "等待备货"}
                            </span>
                        ) : (
                            <span className="text-success">已全部交付</span>
                        ))}
                </div>
            </div>
        </RecordCard>
    );
}

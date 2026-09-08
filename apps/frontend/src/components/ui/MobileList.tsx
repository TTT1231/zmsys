import type { ReactNode } from "react";
import type { Order } from "../../data/types";
import { ANCHOR, maxShipOf, store } from "../../data/store";
import { num } from "../../lib/format";
import { Badge, Button, StatusBadge } from "./Badge";

export function ListState({
  loading,
  empty,
  children,
}: {
  loading?: boolean;
  empty: boolean;
  children: ReactNode;
}) {
  if (loading)
    return (
      <p role="status" className="p-8 text-center text-muted">
        正在加载…
      </p>
    );
  if (empty)
    return (
      <p role="status" className="p-8 text-center text-muted">
        没有匹配的记录，请调整搜索或筛选。
      </p>
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
          <h3 className="text-[16px] font-semibold text-ink break-words">
            {title}
          </h3>
          {subtitle && (
            <div className="mt-1 text-[12px] text-muted break-words">
              {subtitle}
            </div>
          )}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
      {children && <div className="mt-3 text-[14px] text-td">{children}</div>}
      {actions && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      )}
    </article>
  );
}

export function OrderTaskCard({
  order,
  onDetail,
  onShip,
  onEdit,
}: {
  order: Order;
  onDetail: () => void;
  onShip?: () => void;
  onEdit?: () => void;
}) {
  const bom = store.bomByCode(order.bomCode);
  const remaining = store.remainingOf(order);
  const maxShip = maxShipOf(order.orderNo);
  const daysLate = Math.max(
    0,
    Math.floor((Date.parse(ANCHOR) - Date.parse(order.deliverDate)) / 86400000),
  );
  return (
    <RecordCard
      title={order.customer}
      subtitle={order.orderNo}
      badge={
        remaining > 0 && daysLate > 0 ? (
          <Badge tone="danger">逾期 {daysLate} 天</Badge>
        ) : (
          <StatusBadge status={store.orderStatusOf(order).key} />
        )
      }
      actions={
        <>
          {onEdit && (
            <Button variant="secondary" onClick={onEdit}>
              编辑
            </Button>
          )}
          <Button
            variant={onShip && maxShip > 0 ? "secondary" : "primary"}
            onClick={onDetail}
          >
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
      <p className="font-medium">
        {bom?.name}
        {bom?.modelCode ? ` · ${bom.modelCode}` : ""}
      </p>
      <p className="mt-1 text-[12px] text-muted break-words">
        {bom ? `${bom.code} · ${bom.spec}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-line pt-3">
        <span>
          待交 <strong className="tnum text-ink">{num(remaining)}</strong> 件
        </span>
        {remaining > 0 ? (
          <span className={maxShip > 0 ? "text-success" : "text-warning"}>
            {maxShip > 0 ? `本次可发 ${num(maxShip)} 件` : "等待备货"}
          </span>
        ) : (
          <span className="text-success">已全部交付</span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-muted">
        交期 {order.deliverDate} · 已发 {num(order.outbound)} / {num(order.qty)}{" "}
        件
      </p>
    </RecordCard>
  );
}

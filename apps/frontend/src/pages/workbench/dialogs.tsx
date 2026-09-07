import { useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { Badge } from "../../components/ui/Badge";
import { num } from "../../lib/format";
import { addDays, ANCHOR, stockGapList, store } from "../../data/store";
import type { InboundRow, OutboundRow } from "../../data/types";

function LedgerDaySection({ label, rows }: { label: string; rows: Array<{ no: string; qty: number; meta: string }> }) {
  const [open, setOpen] = useState(label.startsWith("今天"));
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const totalQty = rows.reduce((sum, row) => sum + row.qty, 0);

  return (
    <div className="rounded-[12px] border border-line">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-[12.5px] font-semibold text-ink"
      >
        <span>{label}</span>
        <span className="tnum font-normal text-muted">
          {rows.length} 笔 · {num(totalQty)} 件
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows,opacity] duration-200"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-1 px-2 pb-2">
            {rows.length === 0 && <div className="px-2 py-3 text-[12.5px] text-subtle">无登记记录</div>}
            {rows.map((row) => {
              const isChecked = checked.has(row.no);
              return (
                <button
                  key={row.no}
                  type="button"
                  onClick={() =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.no)) next.delete(row.no);
                      else next.add(row.no);
                      return next;
                    })
                  }
                  className={`flex items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left transition hover:bg-primary-soft/60 ${isChecked ? "opacity-55" : ""}`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border ${
                      isChecked ? "border-primary bg-primary text-white" : "border-line-strong bg-white"
                    }`}
                  >
                    {isChecked && (
                      <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2.5 6.2l2.4 2.4 4.6-5" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[12.5px] font-medium text-ink ${isChecked ? "line-through" : ""}`}>{row.no}</span>
                    <span className="block truncate text-[11px] text-muted">{row.meta}</span>
                  </span>
                  <span className="tnum text-[12.5px] font-semibold text-ink">
                    {num(row.qty)}
                    <i className="ml-0.5 text-[10.5px] font-normal text-subtle not-italic">件</i>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* KPI 台账弹窗：入库 / 出库（今天默认展开、昨天折叠，行可勾选划线） */
export function LedgerDialog({ open, kind, onClose }: { open: boolean; kind: "inbound" | "outbound"; onClose: () => void }) {
  const yesterday = addDays(ANCHOR, -1);
  const ledger = kind === "inbound" ? store.inboundLedger : store.outboundLedger;
  const rowsFor = (date: string) => ledger.filter((row) => row.date === date);

  const toRow = (row: (typeof ledger)[number]) => {
    const outbound = row as OutboundRow;
    return {
      no: row.no,
      qty: row.qty,
      meta:
        kind === "inbound"
          ? `${row.productCode} · 登记人 ${(row as InboundRow).inspector}`
          : `${outbound.orderNo} · ${outbound.customer} · ${outbound.operator}`,
    };
  };

  const dayLabel = (date: string) =>
    `${date === ANCHOR ? "今天" : "昨天"}（${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}）`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      label=""
      title={kind === "inbound" ? "入库记录 · 昨天与今天" : "出库记录 · 昨天与今天"}
      width={520}
      footer={
        <button type="button" onClick={onClose} className="min-h-10 rounded-btn bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-hover">
          关闭
        </button>
      }
    >
      <div className="flex flex-col gap-2.5">
        <LedgerDaySection label={dayLabel(ANCHOR)} rows={rowsFor(ANCHOR).map(toRow)} />
        <LedgerDaySection label={dayLabel(yesterday)} rows={rowsFor(yesterday).map(toRow)} />
      </div>
    </Modal>
  );
}

/* 库存缺口明细弹窗 */
export function GapDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const list = stockGapList();
  const totalGap = list.reduce((sum, row) => sum + row.gapQty, 0);
  return (
    <Modal
      open={open}
      onClose={onClose}
      label=""
      title="库存缺口明细"
      width={520}
      footer={
        <button type="button" onClick={onClose} className="min-h-10 rounded-btn bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-hover">
          关闭
        </button>
      }
    >
      <p className="mb-3 text-[12.5px] text-muted">共 {list.length} 款 BOM · 合计缺口 {num(totalGap)} 件，按最早交付日排序</p>
      <div className="flex flex-col gap-2">
        {list.length === 0 && <div className="py-4 text-center text-[12.5px] text-subtle">当前无库存缺口。</div>}
        {list.map((row) => (
          <div key={row.bomCode} className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-[12.5px]">
                <span className="font-semibold text-ink">{row.productCode}</span>
                <span className="text-muted">{row.earliestCustomer}</span>
                <span className="text-subtle">· {row.earliestDate.slice(5).replace("-", "/")} 交付</span>
                {row.earliestOverdue && <Badge tone="danger">已逾期</Badge>}
              </div>
              <div className="tnum mt-0.5 text-[11px] text-subtle">{row.earliestOrderNo}</div>
            </div>
            <span className="tnum text-[13px] font-semibold text-danger">缺 {num(row.gapQty)} 件</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* 订单明细弹窗（图表点击） */
export function OrderInfoDialog({ order, onClose }: { order: { id: string; customer: string; productCode: string; bomLabel: string; deliverDate: string; ordered: number; shipped: number; remaining: number; stock: number; maxShip: number; overdue: boolean } | null; onClose: () => void }) {
  return (
    <Modal open={!!order} onClose={onClose} label="订单明细" title={order?.id || ""} subtitle={order ? `${order.customer} · ${order.productCode}` : ""} width={480}
      footer={
        <button type="button" onClick={onClose} className="min-h-10 rounded-btn bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-hover">
          知道了
        </button>
      }
    >
      {order && (
        <div className="flex flex-col gap-2 text-[13px]">
          <p className="rounded-[10px] bg-primary-soft/70 px-3 py-2 text-[12.5px] text-primary-strong">{order.bomLabel}</p>
          {[
            ["交付日期", `${order.deliverDate}${order.overdue ? "（已逾期）" : ""}`],
            ["订单数量", `${num(order.ordered)} 件`],
            ["累计出库", `${num(order.shipped)} 件`],
            ["剩余待交付", `${num(order.remaining)} 件`],
            ["匹配成品库存", `${num(order.stock)} 件`],
            ["本次最多可发", `${num(order.maxShip)} 件`],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-line/70 pb-1.5">
              <span className="text-muted">{label}</span>
              <span className="tnum font-medium text-ink">{value}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* 通用原型说明弹窗 */
export function NoteDialog({ note, onClose }: { note: { title: string; description: string } | null; onClose: () => void }) {
  return (
    <Modal open={!!note} onClose={onClose} title={note?.title || ""} width={460}
      footer={
        <>
          <button type="button" onClick={onClose} className="min-h-10 rounded-btn border border-line-strong bg-white px-4 text-[13px] font-medium text-ink hover:border-primary-border">
            返回工作台
          </button>
          <button type="button" onClick={onClose} className="min-h-10 rounded-btn bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-hover">
            知道了
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-muted">{note?.description}</p>
    </Modal>
  );
}

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { num } from "@/lib/format";
import { addDays, todayIso } from "@/lib/date";
import type { InboundRow, OutboundRow, Snapshot } from "@/api";

function LedgerDaySection({ label, rows }: { label: string; rows: Array<{ no: string; qty: number; meta: string }> }) {
    const [open, setOpen] = useState(label.startsWith("今天"));
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const totalQty = rows.reduce((sum, row) => sum + row.qty, 0);

    return (
        <div className="rounded-[12px] border border-line">
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
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
                        {rows.map(row => {
                            const isChecked = checked.has(row.no);
                            return (
                                <button
                                    key={row.no}
                                    type="button"
                                    onClick={() =>
                                        setChecked(prev => {
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
                                            isChecked
                                                ? "border-primary bg-primary text-white"
                                                : "border-line-strong bg-white"
                                        }`}
                                    >
                                        {isChecked && (
                                            <svg
                                                viewBox="0 0 12 12"
                                                width="10"
                                                height="10"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                            >
                                                <path d="M2.5 6.2l2.4 2.4 4.6-5" />
                                            </svg>
                                        )}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span
                                            className={`block text-[12.5px] font-medium text-ink ${isChecked ? "line-through" : ""}`}
                                        >
                                            {row.no}
                                        </span>
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
export function LedgerDialog({
    open,
    kind,
    snap,
    onClose,
}: {
    open: boolean;
    kind: "inbound" | "outbound";
    snap: Snapshot;
    onClose: () => void;
}) {
    const anchor = todayIso();
    const yesterday = addDays(anchor, -1);
    const ledger = kind === "inbound" ? snap.inboundLedger : snap.outboundLedger;
    const rowsFor = (date: string) => ledger.filter(row => row.date === date);

    const toRow = (row: (typeof ledger)[number]) => {
        const outbound = row as OutboundRow;
        return {
            no: row.no,
            qty: row.qty,
            meta:
                kind === "inbound"
                    ? `${row.bomCode} · 登记人 ${(row as InboundRow).inspector}`
                    : `${outbound.orderNo} · ${outbound.customer} · ${outbound.operator}`,
        };
    };

    const dayLabel = (date: string) =>
        `${date === anchor ? "今天" : "昨天"}（${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}）`;

    return (
        <Modal
            open={open}
            onClose={onClose}
            label=""
            title={kind === "inbound" ? "入库记录 · 昨天与今天" : "出库记录 · 昨天与今天"}
            width={520}
            footer={
                <button
                    type="button"
                    onClick={onClose}
                    className="min-h-10 rounded-btn bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-hover"
                >
                    关闭
                </button>
            }
        >
            <div className="flex flex-col gap-2.5">
                <LedgerDaySection label={dayLabel(anchor)} rows={rowsFor(anchor).map(toRow)} />
                <LedgerDaySection label={dayLabel(yesterday)} rows={rowsFor(yesterday).map(toRow)} />
            </div>
        </Modal>
    );
}

import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, RecordCard } from "@/components/ui/MobileList";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { downloadCsv, num } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { CustomerCell, QtyCell } from "@/components/ui/cells";
import { DateField, TextArea, TextField } from "@/components/ui/Field";
import { useCreateOutbound, useWbSnapshot } from "@/data/queries";
import { EMPTY_SNAPSHOT, bomByCode, maxShipOf, remainingOf } from "@/data/views";
import { todayIso } from "@/lib/date";
import { useToast } from "@/components/ui/Toast";
import type { OutboundRow, Snapshot } from "@/api";

const escapeHtml = (value: string) =>
    value.replace(
        /[&<>"']/g,
        ch =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[ch] ?? ch,
    );

/* 新窗口渲染出库单据并调起打印；打印窗口保留，便于另存 PDF */
function printOutbound(row: OutboundRow, snap: Snapshot) {
    const bom = bomByCode(snap, row.bomCode);
    const win = window.open("", "_blank", "width=760,height=640");
    if (!win) return;
    win.document.title = `出库单 ${row.no}`;
    const items: Array<[string, string]> = [
        ["出库单号", escapeHtml(row.no)],
        ["关联订单", escapeHtml(row.orderNo)],
        ["客户", escapeHtml(`${row.customer}（${row.customerCode}）`)],
        ["BOM 编码", escapeHtml(row.bomCode)],
        ["规格", escapeHtml(bom?.spec || "—")],
        ["发货数量", escapeHtml(`${num(row.qty)} 件`)],
        ["出库日期", escapeHtml(row.date)],
        ["操作人", escapeHtml(row.operator)],
        ["备注", escapeHtml(row.remark || "—")],
    ];
    const html = `
    <div style="font-family: Inter, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 640px; margin: 32px auto; color: #101828;">
      <h1 style="margin: 0 0 4px; font-size: 20px;">出库单</h1>
      <p style="margin: 0 0 16px; font-size: 12px; color: #667085;">智造管理系统 · 打印时间 ${new Date().toLocaleString()}</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        ${items
            .map(
                ([label, value]) => `
              <tr>
                <td style="width: 96px; padding: 8px 10px; border: 1px solid #e4e7ec; background: #f8fafc; color: #667085;">${label}</td>
                <td style="padding: 8px 10px; border: 1px solid #e4e7ec;">${value}</td>
              </tr>`,
            )
            .join("")}
      </table>
    </div>`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    win.document.body.replaceChildren(...doc.body.childNodes);
    win.print();
}

export function OutboundModal({
    open,
    onClose,
    initialOrderNo = "",
}: {
    open: boolean;
    onClose: () => void;
    initialOrderNo?: string;
}) {
    const { data } = useWbSnapshot();
    const { user } = useApp();
    const snap = data ?? EMPTY_SNAPSHOT;
    const createOutbound = useCreateOutbound();
    const toast = useToast();
    const [orderKeyword, setOrderKeyword] = useState("");
    const [orderNo, setOrderNo] = useState(initialOrderNo);
    const [qty, setQty] = useState("");
    const [date, setDate] = useState(todayIso);
    const [operator, setOperator] = useState("");
    const [remark, setRemark] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});

    // 操作人 = 在职仓管；默认当前登录用户（仓管），否则首个可用
    const operators = snap.users.filter(item => item.role === "warehouse" && item.active).map(item => item.name);
    const effectiveOperator = operators.includes(operator)
        ? operator
        : operators.includes(user?.name ?? "")
          ? user!.name
          : (operators[0] ?? "");

    const stock = snap.stock;
    const orders = snap.orders;
    const orderOptions = orders
        .filter(order => maxShipOf(snap, order.orderNo) > 0)
        .filter(
            order =>
                !orderKeyword.trim() ||
                `${order.orderNo} ${order.customer}`.toLowerCase().includes(orderKeyword.trim().toLowerCase()),
        )
        .slice(0, 8);

    const selectedOrder = orders.find(order => order.orderNo === orderNo);
    const remaining = selectedOrder ? remainingOf(selectedOrder) : 0;
    const shipped = selectedOrder?.outbound ?? 0;
    const shareStock = selectedOrder ? stock[selectedOrder.bomCode] || 0 : 0;
    const maxShip = selectedOrder ? maxShipOf(snap, selectedOrder.orderNo) : 0;
    const inputQty = Number(qty) || 0;
    const over = selectedOrder ? inputQty > maxShip : false;

    const reset = () => {
        setOrderKeyword("");
        setOrderNo("");
        setQty("");
        setDate(todayIso());
        setOperator("");
        setRemark("");
        setErrors({});
    };

    const submit = () => {
        const nextErrors: Record<string, string> = {};
        if (createOutbound.isPending) return;
        if (!date) nextErrors.date = "请选择出库日期";
        if (!selectedOrder) nextErrors.orderNo = "请选择订单";
        if (!qty || Number(qty) <= 0) nextErrors.qty = "请填写发货数量";
        if (over) nextErrors.qty = "超过可发库存，已被拦截";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length)
            requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus(),
            );
        if (Object.keys(nextErrors).length > 0 || !selectedOrder) return;
        createOutbound.mutate(
            {
                orderNo: selectedOrder.orderNo,
                qty: Number(qty),
                date,
                operator: effectiveOperator,
                remark,
            },
            {
                onError: error => toast(error.message, true),
                onSuccess: row => {
                    toast(`出库单 ${row.no} 已登记`);
                    onClose();
                    reset();
                },
            },
        );
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="成品出库 · 发货"
            subtitle="按订单登记发货，超出可发库存会被拦截"
            width={600}
            footer={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        className="min-h-10 rounded-btn border border-line-strong bg-white px-4 text-13 font-medium text-ink hover:border-primary-border"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        disabled={createOutbound.isPending || over}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-13 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        {createOutbound.isPending ? "正在登记…" : "确认发货"}
                    </button>
                </>
            }
        >
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                    <span className="mb-1 block text-12.5 font-medium text-td">
                        选择订单<span className="ml-0.5 text-danger">*</span>
                    </span>
                    {!initialOrderNo && (
                        <>
                            <input
                                aria-label="搜索待发货订单"
                                value={orderKeyword}
                                onChange={event => setOrderKeyword(event.target.value)}
                                placeholder="输入订单号或客户名过滤"
                                className="w-full rounded-input border border-line-strong px-3 py-2 text-13 outline-none focus:border-primary"
                            />
                            <div className="mt-1.5 max-h-37.5 overflow-y-auto rounded-btn border border-line">
                                {orderOptions.length === 0 && (
                                    <p className="px-3 py-3 text-12.5 text-subtle">没有可发货的订单</p>
                                )}
                                {orderOptions.map(order => {
                                    const shipMax = maxShipOf(snap, order.orderNo);
                                    return (
                                        <button
                                            key={order.orderNo}
                                            type="button"
                                            onClick={() => setOrderNo(order.orderNo)}
                                            className={`flex w-full items-center justify-between gap-3 border-b border-line/60 px-3 py-2 text-left text-12.5 transition last:border-b-0 hover:bg-primary-soft/50 ${orderNo === order.orderNo ? "bg-primary-soft" : ""}`}
                                        >
                                            <span className="tnum font-medium text-ink">{order.orderNo}</span>
                                            <span className="min-w-0 flex-1 truncate text-muted">{order.customer}</span>
                                            <span
                                                className={`tnum font-medium ${shipMax > 0 ? "text-success" : "text-subtle"}`}
                                            >
                                                可发 {num(shipMax)} 件
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}
                    {initialOrderNo && selectedOrder && (
                        <div className="rounded-btn bg-primary-soft p-3">
                            <strong className="block text-16">{selectedOrder.customer}</strong>
                            <span className="text-13">
                                {selectedOrder.orderNo} · {selectedOrder.bomCode}
                            </span>
                            <p className="mt-1 text-13 text-muted">{bomByCode(snap, selectedOrder.bomCode)?.spec}</p>
                        </div>
                    )}
                    {errors.orderNo && <span className="mt-1 block text-12 text-danger">{errors.orderNo}</span>}
                </div>

                {selectedOrder && (
                    <div className="rounded-xl border border-line bg-panel px-3.5 py-3 text-12.5 sm:col-span-2">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                            {[
                                ["剩余待发", `${num(remaining)} 件`],
                                ["累计已发", `${num(shipped)} 件`],
                                ["账面库存", `${num(shareStock)} 件`],
                                ["本次最多可发", `${num(maxShip)} 件`],
                            ].map(([label, value], index) => (
                                <div key={label}>
                                    <span className="text-muted">{label}</span>
                                    <span
                                        className={`tnum ml-1.5 font-semibold ${index === 3 && maxShip === 0 ? "text-danger" : "text-ink"}`}
                                    >
                                        {value}
                                    </span>
                                </div>
                            ))}
                        </div>
                        {over && <p className="mt-1.5 font-medium text-danger">发货后超过可发数量，请调整发货数量。</p>}
                    </div>
                )}

                <p className="text-12 text-muted sm:col-span-2">
                    可发数量按交期分配库存；本次发货不会占用更早订单的预留数量。
                </p>
                {selectedOrder && maxShip > 0 && (
                    <button
                        type="button"
                        className="text-left text-primary sm:col-span-2"
                        onClick={() => setQty(String(maxShip))}
                    >
                        填入全部可发数量（{num(maxShip)} 件）
                    </button>
                )}
                <TextField
                    label="发货数量（件）"
                    required
                    inputMode="numeric"
                    placeholder="如 560"
                    error={errors.qty}
                    value={qty}
                    onChange={event => setQty(event.target.value.replace(/\D/g, ""))}
                />
                <DateField
                    label="出库日期"
                    required
                    error={errors.date}
                    value={date}
                    onChange={event => setDate(event.target.value)}
                />
                <div className="sm:col-span-2">
                    <span className="mb-1 block text-12.5 font-medium text-td">操作人</span>
                    <div className="flex gap-1.5">
                        {operators.map(item => (
                            <button
                                key={item}
                                type="button"
                                onClick={() => setOperator(item)}
                                className={`h-9 rounded-full border px-3.5 text-12.5 font-medium transition ${
                                    effectiveOperator === item
                                        ? "border-primary bg-primary-soft text-primary-strong"
                                        : "border-line bg-white text-muted hover:border-primary-border"
                                }`}
                            >
                                {item}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="sm:col-span-2">
                    <TextArea
                        label="备注"
                        placeholder="选填"
                        value={remark}
                        onChange={event => setRemark(event.target.value)}
                    />
                </div>
            </div>
        </Modal>
    );
}

function OutboundDetailModal({ row, snap, onClose }: { row: OutboundRow | null; snap: Snapshot; onClose: () => void }) {
    if (!row) return null;
    const bom = bomByCode(snap, row.bomCode);
    return (
        <Modal
            open={!!row}
            onClose={onClose}
            label="出库详情"
            title={row.no}
            subtitle={`${row.customer} · ${row.customerCode}`}
            width={480}
            footer={
                <button
                    type="button"
                    onClick={onClose}
                    className="min-h-10 rounded-btn bg-primary px-4 text-13 font-medium text-white hover:bg-primary-hover"
                >
                    关闭
                </button>
            }
        >
            <div className="flex flex-col gap-2 text-13">
                <p className="rounded-btn bg-primary-soft/70 px-3 py-2 text-12.5 text-primary-strong">{bom?.spec}</p>
                {[
                    ["关联订单", row.orderNo],
                    ["BOM 编码", row.bomCode],
                    ["发货数量", `${num(row.qty)} 件`],
                    ["出库日期", row.date],
                    ["操作人", row.operator],
                    ["备注", row.remark || "—"],
                ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 border-b border-line/70 pb-1.5">
                        <span className="text-muted">{label}</span>
                        <span className="tnum font-medium text-ink">{value}</span>
                    </div>
                ))}
            </div>
        </Modal>
    );
}

export function OutboundPage() {
    const { can } = useApp();
    const { data, isLoading } = useWbSnapshot();
    const snap = data ?? EMPTY_SNAPSHOT;
    const [searchParams, setSearchParams] = useSearchParams();
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("全部品类");
    const [page, setPage] = useState(1);
    const [pageSize] = useState(10);
    const [newOpen, setNewOpen] = useState(false);
    const [detail, setDetail] = useState<OutboundRow | null>(null);

    const rows = snap.outboundLedger;
    const boms = snap.boms;
    const bomCategory = new Map(boms.map(bom => [bom.code, bom.name]));
    const categories = [...new Set(boms.map(bom => bom.name))];

    const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return rows.filter(row => {
            if (category !== "全部品类" && bomCategory.get(row.bomCode) !== category) return false;
            return !kw || `${row.no} ${row.orderNo} ${row.customer} ${row.bomCode}`.toLowerCase().includes(kw);
        });
    }, [rows, keyword, category, bomCategory]);

    const sorted = useMemo(
        () =>
            [...filtered].sort((a, b) => (a.date === b.date ? b.no.localeCompare(a.no) : b.date.localeCompare(a.date))),
        [filtered],
    );
    const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
    const canRegister = can("outbound:ship");
    const canPrint = can("outbound:print");

    useEffect(() => {
        if (searchParams.get("new") === "outbound") {
            setNewOpen(true);
            setSearchParams({}, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    return (
        <div className="flex flex-col gap-5">
            <PageHeading
                title="成品出库"
                description="按订单登记发货。"
                actions={
                    canRegister ? (
                        <Button icon="truck" onClick={() => setNewOpen(true)}>
                            登记发货
                        </Button>
                    ) : undefined
                }
            />

            <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
                <div className="list-toolbar flex flex-wrap items-center gap-2.5 border-b border-line bg-gradient-to-b from-white to-panel px-5 py-4">
                    <label className="flex h-10 min-w-55 flex-1 items-center gap-2 rounded-btn border border-line-strong bg-white px-3 sm:max-w-75">
                        <Icon name="search" size={15} className="text-subtle" />
                        <input
                            value={keyword}
                            onChange={event => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                            placeholder="搜索单号、订单、客户或 BOM 编码"
                            className="w-full bg-transparent text-13 text-ink outline-none placeholder:text-subtle"
                        />
                    </label>
                    <select
                        value={category}
                        onChange={event => {
                            setCategory(event.target.value);
                            setPage(1);
                        }}
                        aria-label="按品类筛选"
                        className="h-10 rounded-btn border border-line-strong bg-white px-3 text-13 text-ink"
                    >
                        <option>全部品类</option>
                        {categories.map(item => (
                            <option key={item}>{item}</option>
                        ))}
                    </select>

                    <ToolbarMore>
                        <Button
                            variant="secondary"
                            icon="refresh"
                            data-low-priority="true"
                            onClick={() => {
                                setKeyword("");
                                setCategory("全部品类");
                                setPage(1);
                            }}
                        >
                            重置
                        </Button>
                        <Button
                            variant="secondary"
                            icon="download"
                            data-low-priority="true"
                            onClick={() =>
                                downloadCsv(
                                    "成品出库",
                                    ["出库单号", "订单", "客户", "BOM 编码", "发货数量", "出库日期", "操作人"],
                                    pageRows.map(row => [
                                        row.no,
                                        row.orderNo,
                                        row.customer,
                                        row.bomCode,
                                        String(row.qty),
                                        row.date,
                                        row.operator,
                                    ]),
                                )
                            }
                        >
                            导出
                        </Button>
                    </ToolbarMore>
                </div>

                <div className="mobile-records">
                    <ListState loading={isLoading} empty={!pageRows.length}>
                        {pageRows.map(row => (
                            <RecordCard
                                key={row.no}
                                title={row.customer}
                                subtitle={`${row.orderNo} · ${row.date}`}
                                badge={<strong className="text-primary">{num(row.qty)} 件</strong>}
                                actions={
                                    <Button variant="secondary" onClick={() => setDetail(row)}>
                                        查看凭证
                                    </Button>
                                }
                            >
                                <p>{row.bomCode}</p>
                                <p className="mt-2 text-13 text-muted">
                                    {row.no} · {row.operator}
                                </p>
                            </RecordCard>
                        ))}
                    </ListState>
                </div>
                <div className="hidden overflow-x-auto lg:block">
                    {isLoading ? (
                        <div className="py-16 text-center text-13 text-subtle">加载中…</div>
                    ) : (
                        <table className="w-full min-w-225 border-collapse">
                            <thead>
                                <tr className="bg-soft text-left text-12 text-muted">
                                    <th className="px-5 py-2.5 font-semibold">出库单号</th>
                                    <th className="px-3 py-2.5 font-semibold">订单 / 客户</th>
                                    <th className="px-3 py-2.5 font-semibold">BOM 编码</th>
                                    <th className="px-3 py-2.5 text-right font-semibold">发货数量</th>
                                    <th className="px-3 py-2.5 font-semibold">出库日期</th>
                                    <th className="px-3 py-2.5 font-semibold">操作人</th>
                                    <th className="px-5 py-2.5 text-right font-semibold">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-5 py-14 text-center text-13 text-subtle">
                                            没有找到匹配的出库记录
                                        </td>
                                    </tr>
                                )}
                                {pageRows.map(row => (
                                    <tr key={row.no} className="border-t border-line/70 transition hover:bg-row-hover">
                                        <td className="px-5 py-3 tnum text-13 font-semibold text-td-strong">
                                            {row.no}
                                        </td>
                                        <td className="px-3 py-3">
                                            <CustomerCell
                                                name={row.customer}
                                                sub={`${row.orderNo} · ${row.customerCode}`}
                                            />
                                        </td>
                                        <td className="px-3 py-3 tnum text-12.5 font-medium text-primary-strong">
                                            {row.bomCode}
                                        </td>
                                        <td className="px-3 py-3 text-right">
                                            <QtyCell value={row.qty} unit="件" />
                                        </td>
                                        <td className="px-3 py-3 tnum text-13 text-td">{row.date}</td>
                                        <td className="px-3 py-3 text-13 text-td">{row.operator}</td>
                                        <td className="px-5 py-3 text-right">
                                            <div className="flex items-center justify-end gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => setDetail(row)}
                                                    className="text-13 font-medium text-primary-strong underline-offset-2 hover:underline"
                                                >
                                                    查看详情
                                                </button>
                                                {canPrint && (
                                                    <button
                                                        type="button"
                                                        onClick={() => printOutbound(row, snap)}
                                                        className="text-13 font-medium text-primary-strong underline-offset-2 hover:underline"
                                                    >
                                                        打印
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="border-t border-line">
                    <Pagination
                        page={page}
                        pageSize={pageSize}
                        total={filtered.length}
                        unit="条出库记录"
                        onPageChange={setPage}
                    />
                </div>
            </section>

            {canRegister && <OutboundModal open={newOpen} onClose={() => setNewOpen(false)} />}
            <OutboundDetailModal row={detail} snap={snap} onClose={() => setDetail(null)} />
        </div>
    );
}

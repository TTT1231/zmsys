import type { ReactNode } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, RecordCard, CardField } from "@/components/ui/MobileList";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordFields, RecordProduct, RecordSummary } from "@/components/business/RecordDetails";
import { BomCell } from "@/components/bom/BomCell";
import { BomRemarkNote } from "@/components/bom/BomRemarkNote";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { downloadCsv, num } from "@/lib/format";
import { useApp } from "@/context/useApp";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { Badge, Button, ProgressTrack, StatusBadge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { SearchSelect } from "@/components/ui/SearchSelect";
import { CustomerCell, QtyCell } from "@/components/ui/cells";
import { SortTh } from "@/components/ui/SortTh";
import { MobileSortSelect } from "@/components/ui/MobileSortSelect";
import { nextSortState, type SortState } from "@/lib/tableSort";
import { DateField, TextArea, TextField } from "@/components/ui/Field";
import {
    useCreateOutbound,
    useEmergencyVoidOutbound,
    usePrintOutbound,
    useVoidOutbound,
    useWbRefresh,
    useWbSnapshot,
} from "@/data/queries";
import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useDelayedFlag } from "@/components/ui/useDelayedFlag";
import { PageLoading } from "@/components/ui/PageLoading";
import { EMPTY_SNAPSHOT, bomByCode, maxShipOf, orderStatusOf, remainingOf } from "@/data/views";
import { todayIso } from "@/lib/date";
import { useToast } from "@/components/ui/toastContexts";
import type { OutboundPrintDocument, OutboundRow, Snapshot } from "@/api";

/* 可排序列：出库单号 / BOM 编码 / 发货数量 / 出库日期；桌面表头与移动端排序下拉共用 */
type LedgerSortKey = "no" | "bomCode" | "qty" | "date";
const LEDGER_SORT_COLUMNS: Array<{ key: LedgerSortKey; label: string }> = [
    { key: "no", label: "出库单号" },
    { key: "bomCode", label: "BOM 编码" },
    { key: "qty", label: "发货数量" },
    { key: "date", label: "出库日期" },
];

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

const outboundStateLabel = (row: OutboundRow) =>
    row.state === "registered" ? "已登记" : row.state === "printed" ? "已打印" : "已作废";

/* 后端成功登记打印版本后，再向预先打开的窗口渲染单据并调起浏览器打印。 */
function renderOutboundDocument(document: OutboundPrintDocument, win: Window) {
    win.document.title = `出库单 ${document.no}`;
    const items: Array<[string, string]> = [
        ["出库单号", escapeHtml(document.no)],
        ["关联订单", escapeHtml(document.orderNo)],
        ["客户", escapeHtml(`${document.customer}（${document.customerCode}）`)],
        ["BOM 编码", escapeHtml(document.bomCode)],
        ["规格", escapeHtml(document.bomSpec || "—")],
        ["发货数量", escapeHtml(`${num(document.qty)} 个`)],
        ["出库日期", escapeHtml(document.date)],
        ["打印次数", escapeHtml(`第 ${document.printVersion} 次`)],
        ["登记人", escapeHtml(document.operator)],
        ["打印人", escapeHtml(document.printedBy)],
        ["备注", escapeHtml(document.remark || "—")],
    ];
    const html = `
    <div style="font-family: Inter, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 640px; margin: 32px auto; color: #101828;">
      <h1 style="margin: 0 0 4px; font-size: 20px;">出库单</h1>
      <p style="margin: 0 0 16px; font-size: 12px; color: #667085;">众茂生产系统 · 打印时间 ${new Date(document.printedAt).toLocaleString()}</p>
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

function ReprintModal({
    row,
    pending,
    onClose,
    onConfirm,
}: {
    row: OutboundRow;
    pending: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => void;
}) {
    const [reason, setReason] = useState("");
    const [error, setError] = useState("");
    const formId = `reprint-${row.no}`;
    const submit = (event: FormEvent) => {
        event.preventDefault();
        const value = reason.trim();
        if (value.length < 2) {
            setError("请填写重打原因（至少 2 个字）");
            return;
        }
        setError("");
        onConfirm(value);
    };
    const close = () => {
        if (!pending) onClose();
    };

    return (
        <Modal
            open
            onClose={close}
            title="重打出库单"
            subtitle={`${row.no} · 将重新打印（第 ${row.printVersion + 1} 次）`}
            label="重打出库单"
            width={440}
            footer={
                <>
                    <Button variant="secondary" type="button" disabled={pending} onClick={close}>
                        取消
                    </Button>
                    <Button type="submit" form={formId} disabled={pending}>
                        {pending ? "正在打印…" : "确认重打"}
                    </Button>
                </>
            }
        >
            <form id={formId} onSubmit={submit} aria-busy={pending}>
                <TextArea
                    label="重打原因"
                    required
                    value={reason}
                    error={error}
                    placeholder="例如：纸张破损、内容模糊"
                    onChange={event => setReason(event.target.value)}
                />
                <p className="mt-2 text-12 text-muted">重打会出一张新单，旧单自动作废，以最新一联为准。</p>
            </form>
        </Modal>
    );
}

function VoidOutboundModal({
    row,
    pending,
    onClose,
    onConfirm,
}: {
    row: OutboundRow;
    pending: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => void;
}) {
    const [reason, setReason] = useState("");
    const [error, setError] = useState("");
    const formId = `void-outbound-${row.no}`;
    const submit = (event: FormEvent) => {
        event.preventDefault();
        const value = reason.trim();
        if (value.length < 2) {
            setError("请填写作废原因（至少 2 个字）");
            return;
        }
        setError("");
        onConfirm(value);
    };
    const close = () => {
        if (!pending) onClose();
    };

    return (
        <Modal
            open
            onClose={close}
            title="作废出库单"
            subtitle={`${row.no} · 未打印`}
            label="作废出库单"
            width={440}
            footer={
                <>
                    <Button variant="secondary" type="button" disabled={pending} onClick={close}>
                        取消
                    </Button>
                    <Button type="submit" form={formId} disabled={pending}>
                        {pending ? "正在作废…" : "确认作废"}
                    </Button>
                </>
            }
        >
            <form id={formId} onSubmit={submit} aria-busy={pending}>
                <TextArea
                    label="作废原因"
                    required
                    value={reason}
                    error={error}
                    placeholder="例如：登记了错误数量 / 选错了产品型号"
                    onChange={event => setReason(event.target.value)}
                />
                <p className="mt-2 text-12 text-muted">
                    作废后这批货的数量会自动退回库存和订单；原单保留作凭证，重新登记一张正确的就行。
                </p>
            </form>
        </Modal>
    );
}

function EmergencyVoidModal({
    row,
    pending,
    onClose,
    onConfirm,
}: {
    row: OutboundRow;
    pending: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => void;
}) {
    const [reason, setReason] = useState("");
    const [goodsStayed, setGoodsStayed] = useState(false);
    const [paperVoided, setPaperVoided] = useState(false);
    const [error, setError] = useState("");
    const formId = `emergency-void-${row.no}`;
    const submit = (event: FormEvent) => {
        event.preventDefault();
        const value = reason.trim();
        if (value.length < 2) {
            setError("请填写紧急撤销原因（至少 2 个字）");
            return;
        }
        if (!goodsStayed || !paperVoided) {
            setError("必须同时确认货物尚未离开且纸质单据已作废");
            return;
        }
        setError("");
        onConfirm(value);
    };
    const close = () => {
        if (!pending) onClose();
    };

    return (
        <Modal
            open
            onClose={close}
            title="紧急撤销已打印出库单"
            subtitle={`${row.no} · 第 ${row.printVersion} 版`}
            label="紧急撤销出库单"
            width={440}
            footer={
                <>
                    <Button variant="secondary" type="button" disabled={pending} onClick={close}>
                        取消
                    </Button>
                    <Button type="submit" form={formId} disabled={pending}>
                        {pending ? "正在撤销…" : "确认紧急撤销"}
                    </Button>
                </>
            }
        >
            <form id={formId} onSubmit={submit} aria-busy={pending} className="flex flex-col gap-3">
                <TextArea
                    label="紧急撤销原因"
                    required
                    value={reason}
                    error={error}
                    placeholder="例如：打印后发现发错型号，货物仍在仓库"
                    onChange={event => setReason(event.target.value)}
                />
                <div className="flex flex-col gap-2 rounded-btn border border-line px-3 py-2.5">
                    <label className="flex items-start gap-2 text-13 text-ink">
                        <input
                            type="checkbox"
                            checked={goodsStayed}
                            onChange={event => setGoodsStayed(event.target.checked)}
                            className="mt-0.5"
                        />
                        已线下确认：货物尚未离开仓库
                    </label>
                    <label className="flex items-start gap-2 text-13 text-ink">
                        <input
                            type="checkbox"
                            checked={paperVoided}
                            onChange={event => setPaperVoided(event.target.checked)}
                            className="mt-0.5"
                        />
                        已线下确认：全部纸质单据均已作废
                    </label>
                </div>
                <p className="text-12 text-muted">
                    用于已打印、货还没发走时的纠错（仅超级管理员）；撤销后数量自动退回库存和订单。
                </p>
            </form>
        </Modal>
    );
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
    const snap = data ?? EMPTY_SNAPSHOT;
    const createOutbound = useCreateOutbound();
    const toast = useToast();
    // 操作人 = 当前登录用户（服务端落账，不经请求体）

    const stock = snap.stock;
    const orders = snap.orders;
    // 候选 = 还有待交数量的订单（已取消/已发完的不算，可发量可能为 0，等入库后可发）；
    // 客户选项也从这里派生，不走客户档案（仓管无客户档案权限，订单上的客户信息全员可见）
    const candidateOrders = orders.filter(order => remainingOf(order) > 0);
    const [customerCode, setCustomerCode] = useState(() => {
        const initial = orders.find(order => order.orderNo === initialOrderNo);
        return initial?.customerCode ?? "";
    });
    const [orderNo, setOrderNo] = useState(initialOrderNo);
    const [qty, setQty] = useState("");
    const [date, setDate] = useState(todayIso);
    const [remark, setRemark] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});

    const customerOrders = candidateOrders.filter(order => order.customerCode === customerCode);
    const customerOptions = candidateOrders
        .filter((order, index, list) => list.findIndex(item => item.customerCode === order.customerCode) === index)
        .map(order => ({ value: order.customerCode, label: `${order.customer}（${order.customerCode}）` }));
    const orderOptions = customerOrders.map(order => ({
        value: order.orderNo,
        label: `${order.orderNo} · ${order.bomCode} · 交期 ${order.deliverDate}`,
    }));

    const selectedOrder = orders.find(order => order.orderNo === orderNo);
    const selectedBom = selectedOrder ? bomByCode(snap, selectedOrder.bomCode) : undefined;
    const status = selectedOrder ? orderStatusOf(snap, selectedOrder) : undefined;
    const remaining = selectedOrder ? remainingOf(selectedOrder) : 0;
    const shipped = selectedOrder?.outbound ?? 0;
    const shareStock = selectedOrder ? stock[selectedOrder.bomCode] || 0 : 0;
    const maxShip = selectedOrder ? maxShipOf(snap, selectedOrder.orderNo) : 0;
    const inputQty = Number(qty) || 0;
    const over = selectedOrder ? inputQty > maxShip : false;
    const overdue = !!selectedOrder && remaining > 0 && selectedOrder.deliverDate < todayIso();

    /* 用户改动某字段即清除该字段的报错，避免补填后验证词残留 */
    const clearError = (key: string) => setErrors(current => ({ ...current, [key]: "" }));

    const reset = () => {
        setCustomerCode("");
        setOrderNo("");
        setQty("");
        setDate(todayIso());
        setRemark("");
        setErrors({});
    };

    const submit = () => {
        const nextErrors: Record<string, string> = {};
        if (createOutbound.isPending) return;
        if (!date) nextErrors.date = "请选择出库日期";
        if (!customerCode) nextErrors.customerCode = "请选择客户";
        if (!selectedOrder) nextErrors.orderNo = "请选择订单";
        if (!qty) nextErrors.qty = "请填写发货数量";
        else if (Number(qty) <= 0) nextErrors.qty = "发货数量必须大于 0";
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
            subtitle="先选客户再选订单，超出可发库存会被拦截"
            width={600}
            footer={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        className="min-h-10 rounded-btn border border-line-strong bg-surface px-4 text-13 font-medium text-ink hover:border-primary-border"
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
            <div className="flex flex-col gap-5">
                <fieldset className="rounded-panel border border-line p-4">
                    <legend className="px-1.5 text-12.5 font-semibold text-primary-strong">① 客户与订单</legend>
                    <div className="flex flex-col gap-3">
                        <SearchSelect
                            label="客户"
                            required
                            error={errors.customerCode}
                            value={customerCode}
                            onChange={code => {
                                setCustomerCode(code);
                                // 换客户后原订单多半不属于新客户，清掉避免带着旧单发货
                                setOrderNo("");
                                setErrors(current => ({ ...current, customerCode: "", orderNo: "" }));
                            }}
                            options={customerOptions}
                        />
                        {customerCode && (
                            <SearchSelect
                                label="销售订单"
                                required
                                error={errors.orderNo}
                                value={orderNo}
                                onChange={code => {
                                    setOrderNo(code);
                                    setErrors(current => ({ ...current, orderNo: "" }));
                                }}
                                options={orderOptions}
                            />
                        )}
                    </div>
                </fieldset>

                <fieldset className="rounded-panel border border-line p-4">
                    <legend className="px-1.5 text-12.5 font-semibold text-primary-strong">② 订单信息</legend>
                    {selectedOrder && status ? (
                        <div className="flex flex-col gap-3 rounded-xl border border-primary-border bg-primary-soft/40 px-3.5 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="tnum text-14 font-semibold text-primary-strong">
                                    {selectedOrder.orderNo}
                                </span>
                                <StatusBadge status={status.key} label={status.label} />
                            </div>
                            <div>
                                <p className="text-12.5 text-td">
                                    <span className="tnum font-medium">{selectedOrder.bomCode}</span>
                                    {selectedBom ? ` · ${selectedBom.name}` : ""}
                                </p>
                                {selectedBom?.spec && (
                                    <p className="mt-0.5 wrap-break-word text-11.5 text-muted">{selectedBom.spec}</p>
                                )}
                            </div>
                            {/* 工艺差异独立警示条：发货前要核对的差异，不能混在规格小字里 */}
                            <BomRemarkNote remark={selectedBom?.remark} />
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                                <div className="min-w-0">
                                    <dt className="text-11.5 text-muted">订单数量</dt>
                                    <dd className="tnum mt-0.5 text-13 font-semibold text-ink">
                                        {num(selectedOrder.qty)} 个
                                    </dd>
                                </div>
                                <div className="min-w-0">
                                    <dt className="text-11.5 text-muted">交货日期</dt>
                                    <dd className="tnum mt-0.5 text-13 font-semibold text-ink">
                                        {selectedOrder.deliverDate}
                                        {overdue && <span className="ml-1 font-normal text-warning">已逾期</span>}
                                    </dd>
                                </div>
                                <div className="min-w-0">
                                    <dt className="text-11.5 text-muted">交付情况</dt>
                                    <dd className="tnum mt-0.5 text-13 font-semibold text-ink">
                                        已发 {num(shipped)} 个
                                    </dd>
                                </div>
                                <div className="min-w-0">
                                    <dt className="text-11.5 text-muted">账面库存</dt>
                                    <dd className="tnum mt-0.5 text-13 font-semibold text-ink">{num(shareStock)} 个</dd>
                                </div>
                            </dl>
                            <div>
                                <ProgressTrack
                                    value={selectedOrder.qty === 0 ? 0 : selectedOrder.outbound / selectedOrder.qty}
                                    done={remaining === 0}
                                />
                                <p className="mt-1.5 text-12.5 text-muted">
                                    待交 <span className="tnum font-semibold text-ink">{num(remaining)}</span> 个 ·
                                    本次最多可发{" "}
                                    <span
                                        className={`tnum font-semibold ${maxShip > 0 ? "text-success" : "text-danger"}`}
                                    >
                                        {num(maxShip)}
                                    </span>{" "}
                                    个（按实际入库数量出库）
                                </p>
                                {over && (
                                    <p className="mt-1 font-medium text-danger">发货后超过可发数量，请调整发货数量。</p>
                                )}
                            </div>
                        </div>
                    ) : (
                        <p className="text-12.5 text-subtle">
                            选择订单后，这里会带出成品档案、订单数量、交货日期与交付情况。
                        </p>
                    )}
                </fieldset>

                <fieldset className="rounded-panel border border-line p-4">
                    <legend className="px-1.5 text-12.5 font-semibold text-primary-strong">③ 发货明细</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {selectedOrder && maxShip > 0 && (
                            <button
                                type="button"
                                className="text-left text-13 text-primary-strong sm:col-span-2"
                                onClick={() => {
                                    setQty(String(maxShip));
                                    clearError("qty");
                                }}
                            >
                                填入全部可发数量（{num(maxShip)} 个）
                            </button>
                        )}
                        <TextField
                            label="发货数量（个）"
                            required
                            inputMode="numeric"
                            placeholder="如 560"
                            error={errors.qty}
                            value={qty}
                            onChange={event => {
                                setQty(event.target.value.replace(/\D/g, ""));
                                clearError("qty");
                            }}
                        />
                        <DateField
                            label="出库日期"
                            required
                            error={errors.date}
                            value={date}
                            onChange={event => {
                                setDate(event.target.value);
                                clearError("date");
                            }}
                        />
                        <div className="sm:col-span-2">
                            <TextArea
                                label="备注"
                                placeholder="选填"
                                value={remark}
                                onChange={event => setRemark(event.target.value)}
                            />
                        </div>
                    </div>
                </fieldset>
            </div>
        </Modal>
    );
}

export function OutboundDetailModal({
    row,
    snap,
    onClose,
    actions,
}: {
    row: OutboundRow | null;
    snap: Snapshot;
    onClose: () => void;
    actions?: ReactNode;
}) {
    if (!row) return null;
    const bom = bomByCode(snap, row.bomCode);
    return (
        <Modal
            open={!!row}
            onClose={onClose}
            label="出库详情"
            title={row.no}
            subtitle={`${row.customer} · ${row.customerCode}`}
            width={560}
            layout="detail"
            footer={
                <>
                    {actions}
                    <Button variant="secondary" onClick={onClose}>
                        关闭
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <RecordSummary
                    metrics={[{ label: "发货数量", value: row.qty }]}
                    status={
                        <Badge tone={row.state === "voided" ? "danger" : "progress"}>{outboundStateLabel(row)}</Badge>
                    }
                    note={row.state === "voided" ? "此记录已作废，以上数量不再计入有效出库。" : undefined}
                />
                <RecordProduct categories={snap.bomCategories} bom={bom} bomCode={row.bomCode} />
                <RecordFields
                    title="出库信息"
                    items={[
                        { label: "关联订单", value: row.orderNo, fullWidth: true },
                        { label: "出库日期", value: row.date },
                        { label: "操作人", value: row.operator },
                        { label: "打印情况", value: row.printVersion ? `第 ${row.printVersion} 次打印` : "未打印" },
                        { label: "备注", value: row.remark || "—", fullWidth: true },
                        ...(row.state === "voided"
                            ? [{ label: "作废原因", value: row.voidReason || "—", fullWidth: true }]
                            : []),
                    ]}
                />
            </div>
        </Modal>
    );
}

export function OutboundPage() {
    const { can } = useApp();
    const { data, isLoading, isFetching } = useWbSnapshot();
    const { refresh } = useWbRefresh();
    const printRequest = usePrintOutbound();
    const voidRequest = useVoidOutbound();
    const emergencyVoidRequest = useEmergencyVoidOutbound();
    const toast = useToast();
    // 首载出替换式占位,后台刷新出保留式遮罩(200ms 内完成不闪现)
    const overlay = useDelayedFlag(isFetching && !isLoading);
    const snap = data ?? EMPTY_SNAPSHOT;
    const [searchParams, setSearchParams] = useSearchParams();
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("全部品类");
    const [statusFilter, setStatusFilter] = useState("全部状态");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    // 列排序默认升序：默认按出库日期（同日以单号稳定排序）
    const [sort, setSort] = useState<SortState<LedgerSortKey>>({ key: "date", dir: "asc" });
    const [newOpen, setNewOpen] = useState(false);
    const [detail, setDetail] = useState<OutboundRow | null>(null);
    const [reprintTarget, setReprintTarget] = useState<OutboundRow | null>(null);
    const [voidTarget, setVoidTarget] = useState<OutboundRow | null>(null);
    const [emergencyTarget, setEmergencyTarget] = useState<OutboundRow | null>(null);

    const rows = snap.outboundLedger;
    const currentDetail = detail ? (rows.find(row => row.no === detail.no) ?? null) : null;
    const boms = snap.boms;
    const bomCategory = new Map(boms.map(bom => [bom.code, bom.name]));
    const categories = [...new Set(boms.map(bom => bom.name))];

    const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return rows.filter(row => {
            if (statusFilter !== "全部状态" && outboundStateLabel(row) !== statusFilter) return false;
            if (category !== "全部品类" && bomCategory.get(row.bomCode) !== category) return false;
            return !kw || `${row.no} ${row.orderNo} ${row.customer} ${row.bomCode}`.toLowerCase().includes(kw);
        });
    }, [rows, keyword, category, statusFilter, bomCategory]);

    const sorted = useMemo(() => {
        const factor = sort.dir === "asc" ? 1 : -1;
        return [...filtered].sort((a, b) => {
            const byKey =
                sort.key === "no"
                    ? a.no.localeCompare(b.no)
                    : sort.key === "bomCode"
                      ? a.bomCode.localeCompare(b.bomCode)
                      : sort.key === "qty"
                        ? a.qty - b.qty
                        : a.date.localeCompare(b.date);
            return byKey * factor || a.no.localeCompare(b.no);
        });
    }, [filtered, sort]);
    const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
    const canRegister = can("outbound:ship");
    const canPrint = can("outbound:print");
    const canVoid = can("outbound:void");
    const canEmergencyVoid = can("outbound:emergency-void");
    const applySort = (key: LedgerSortKey) => setSort(current => nextSortState(current, key));
    // 排序或翻页后行序变化，滚动区回到顶部，避免误以为排错行
    const tableScrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
    }, [page, sort]);

    const requestPrint = (row: OutboundRow, reason = "") => {
        if (printRequest.isPending || row.state === "voided") return;
        const win = window.open("", "_blank", "width=760,height=640");
        if (!win) {
            toast("浏览器拦截了打印窗口，请允许本站打开新窗口后重试", true);
            return;
        }
        win.opener = null;
        win.document.title = `正在生成出库单 ${row.no}`;
        win.document.body.textContent = "正在生成出库单…";
        printRequest.mutate(
            { no: row.no, expectedVersion: row.version, reason },
            {
                onError: error => {
                    win.close();
                    toast(error.message, true);
                },
                onSuccess: result => {
                    setReprintTarget(null);
                    if (!win.closed) renderOutboundDocument(result.document, win);
                    toast(`${row.no} 已${result.printVersion > 1 ? "重新" : ""}打印`);
                },
            },
        );
    };

    useEffect(() => {
        if (searchParams.get("new") === "outbound") {
            setNewOpen(true);
            setSearchParams({}, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    // 清空条件只作用于筛选行（搜索/状态/品类）；分页由用户自行操作
    const clearFilters = () => {
        setKeyword("");
        setCategory("全部品类");
        setStatusFilter("全部状态");
        setPage(1);
    };
    const filtersActive = !!keyword.trim() || statusFilter !== "全部状态" || category !== "全部品类";

    return (
        <div className="flex flex-col gap-5">
            <h1 className="sr-only">成品出库</h1>

            <section className="relative overflow-hidden rounded-panel border border-line bg-surface/97 shadow-card">
                {overlay && <LoadingOverlay />}
                <div className="list-toolbar flex flex-wrap items-center border-b border-line bg-linear-to-b from-surface to-panel px-5 py-4 lg:gap-2.5">
                    <label className="flex h-10 items-center gap-2 rounded-btn border border-line-strong bg-surface px-3 lg:w-70">
                        <Icon name="search" size={15} className="text-subtle" />
                        <input
                            value={keyword}
                            onChange={event => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                            placeholder="单号 / 订单 / 客户 / BOM"
                            className="w-full bg-transparent text-13 text-ink outline-none placeholder:text-subtle"
                        />
                    </label>
                    <select
                        value={statusFilter}
                        onChange={event => {
                            setStatusFilter(event.target.value);
                            setPage(1);
                        }}
                        aria-label="按状态筛选"
                        className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-13 text-ink"
                    >
                        {["全部状态", "已登记", "已打印", "已作废"].map(option => (
                            <option key={option}>{option}</option>
                        ))}
                    </select>
                    <select
                        value={category}
                        onChange={event => {
                            setCategory(event.target.value);
                            setPage(1);
                        }}
                        aria-label="按品类筛选"
                        className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-13 text-ink"
                    >
                        <option>全部品类</option>
                        {categories.map(item => (
                            <option key={item}>{item}</option>
                        ))}
                    </select>
                    <MobileSortSelect columns={LEDGER_SORT_COLUMNS} value={sort} onChange={setSort} />
                    <button
                        type="button"
                        onClick={clearFilters}
                        disabled={!filtersActive}
                        className="min-h-10 px-1 text-13 font-medium text-muted transition hover:text-primary-strong disabled:cursor-not-allowed disabled:text-subtle disabled:hover:text-subtle"
                    >
                        清空条件
                    </button>
                    <TableHeaderActions className="ml-auto">
                        <ToolbarMore>
                            <Button variant="secondary" icon="refresh" onClick={refresh}>
                                刷新
                            </Button>
                            <Button
                                variant="secondary"
                                icon="download"
                                onClick={() =>
                                    downloadCsv(
                                        "成品出库",
                                        [
                                            "出库单号",
                                            "订单",
                                            "客户",
                                            "BOM 编码",
                                            "发货数量",
                                            "出库日期",
                                            "操作人",
                                            "状态",
                                        ],
                                        pageRows.map(row => [
                                            row.no,
                                            row.orderNo,
                                            row.customer,
                                            row.bomCode,
                                            String(row.qty),
                                            row.date,
                                            row.operator,
                                            outboundStateLabel(row),
                                        ]),
                                    )
                                }
                            >
                                导出
                            </Button>
                        </ToolbarMore>
                        {canRegister && (
                            <Button icon="truck" onClick={() => setNewOpen(true)}>
                                登记发货
                            </Button>
                        )}
                    </TableHeaderActions>
                </div>

                <div className="mobile-records">
                    <ListState loading={isLoading} empty={!pageRows.length}>
                        {pageRows.map(row => (
                            <RecordCard
                                key={row.no}
                                title={row.no}
                                subtitle={`${row.customer} · ${row.orderNo}`}
                                badge={
                                    <Badge tone={row.state === "voided" ? "danger" : "progress"}>
                                        {outboundStateLabel(row)}
                                    </Badge>
                                }
                                actions={
                                    <Button variant="secondary" onClick={() => setDetail(row)}>
                                        查看详情
                                    </Button>
                                }
                            >
                                <BomCell
                                    categories={snap.bomCategories}
                                    bom={bomByCode(snap, row.bomCode)}
                                    bomCode={row.bomCode}
                                />
                                <div className="mt-2 flex flex-col gap-1.5">
                                    <CardField label="出库数量" value={`${num(row.qty)} 个`} strong />
                                    <CardField label="出库日期" value={row.date} />
                                    <CardField label="操作人" value={row.operator} />
                                </div>
                            </RecordCard>
                        ))}
                    </ListState>
                </div>
                <div className="hidden lg:block">
                    {isLoading ? (
                        <PageLoading className="py-16" />
                    ) : (
                        <DataTable
                            tableId="outbound"
                            defaultWidths={[158, 170, 360, 132, 138, 104, 104, 120]}
                            recordCount={filtered.length}
                            identityColumn={0}
                            scrollRef={tableScrollRef}
                        >
                            <thead>
                                <tr className="text-left text-12 text-muted">
                                    <SortTh
                                        label="出库单号"
                                        active={sort.key === "no"}
                                        dir={sort.dir}
                                        onSort={() => applySort("no")}
                                        className="px-5"
                                    />
                                    <th className="px-3 py-2.5 font-semibold">订单 / 客户</th>
                                    <SortTh
                                        label="BOM 编码"
                                        active={sort.key === "bomCode"}
                                        dir={sort.dir}
                                        onSort={() => applySort("bomCode")}
                                        className="px-3"
                                    />
                                    <SortTh
                                        label="发货数量（个）"
                                        align="right"
                                        active={sort.key === "qty"}
                                        dir={sort.dir}
                                        onSort={() => applySort("qty")}
                                        className="px-3"
                                    />
                                    <SortTh
                                        label="出库日期"
                                        active={sort.key === "date"}
                                        dir={sort.dir}
                                        onSort={() => applySort("date")}
                                        className="px-3"
                                    />
                                    <th className="px-3 py-2.5 text-13 font-semibold">操作人</th>
                                    <th className="px-3 py-2.5 font-semibold">状态</th>
                                    <th className="px-5 py-2.5 text-right font-semibold">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="px-5 py-10 text-center">
                                            <EmptyState description="没有找到匹配的出库记录" />
                                        </td>
                                    </tr>
                                )}
                                {pageRows.map(row => (
                                    <tr
                                        key={row.no}
                                        className={
                                            row.state === "voided"
                                                ? "border-t border-line bg-danger-soft/60"
                                                : "border-t border-line transition hover:bg-row-hover"
                                        }
                                    >
                                        <td
                                            className={`px-5 py-3 tnum text-13 font-semibold text-td-strong${
                                                row.state === "voided" ? " line-through decoration-danger/50" : ""
                                            }`}
                                        >
                                            {row.no}
                                        </td>
                                        <td className="px-3 py-3">
                                            <CustomerCell
                                                name={row.customer}
                                                sub={`${row.orderNo} · ${row.customerCode}`}
                                            />
                                        </td>
                                        <td className="px-3 py-4">
                                            <BomCell
                                                categories={snap.bomCategories}
                                                bom={bomByCode(snap, row.bomCode)}
                                                bomCode={row.bomCode}
                                            />
                                        </td>
                                        <td className="px-3 py-3 text-right">
                                            <QtyCell value={row.qty} />
                                        </td>
                                        <td className="px-3 py-3 tnum text-13 text-td">{row.date}</td>
                                        <td className="px-3 py-3 text-13 text-td">{row.operator}</td>
                                        <td className="px-3 py-3">
                                            {row.state === "voided" ? (
                                                <Badge tone="danger">已作废</Badge>
                                            ) : row.state === "printed" ? (
                                                <Badge tone="progress">已打印</Badge>
                                            ) : (
                                                <Badge tone="pending">已登记</Badge>
                                            )}
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <button
                                                type="button"
                                                onClick={() => setDetail(row)}
                                                className="text-13 font-medium text-primary-strong underline-offset-2 hover:underline"
                                            >
                                                查看详情
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </DataTable>
                    )}
                </div>

                <div className="border-t border-line">
                    <Pagination
                        page={page}
                        pageSize={pageSize}
                        total={filtered.length}
                        unit="条出库记录"
                        onPageChange={setPage}
                        onPageSizeChange={size => {
                            setPageSize(size);
                            setPage(1);
                        }}
                    />
                </div>
            </section>

            {canRegister && <OutboundModal open={newOpen} onClose={() => setNewOpen(false)} />}
            <OutboundDetailModal
                row={currentDetail}
                snap={snap}
                onClose={() => setDetail(null)}
                actions={
                    currentDetail && (
                        <>
                            {canVoid && currentDetail.state === "registered" && (
                                <Button
                                    variant="secondary"
                                    disabled={voidRequest.isPending}
                                    onClick={() => setVoidTarget(currentDetail)}
                                >
                                    作废
                                </Button>
                            )}
                            {canEmergencyVoid && currentDetail.state === "printed" && (
                                <button
                                    type="button"
                                    disabled={emergencyVoidRequest.isPending}
                                    onClick={() => setEmergencyTarget(currentDetail)}
                                    className="min-h-10 rounded-btn border border-danger/30 bg-danger-soft px-4 text-13 font-medium text-danger disabled:opacity-50"
                                >
                                    紧急撤销
                                </button>
                            )}
                            {canPrint && currentDetail.state !== "voided" && (
                                <Button
                                    icon="print"
                                    disabled={printRequest.isPending}
                                    onClick={() =>
                                        currentDetail.state === "printed"
                                            ? setReprintTarget(currentDetail)
                                            : requestPrint(currentDetail)
                                    }
                                >
                                    {printRequest.isPending
                                        ? "处理中…"
                                        : currentDetail.state === "printed"
                                          ? "重打"
                                          : "打印"}
                                </Button>
                            )}
                        </>
                    )
                }
            />
            {reprintTarget && (
                <ReprintModal
                    row={reprintTarget}
                    pending={printRequest.isPending}
                    onClose={() => setReprintTarget(null)}
                    onConfirm={reason => requestPrint(reprintTarget, reason)}
                />
            )}
            {voidTarget && (
                <VoidOutboundModal
                    row={voidTarget}
                    pending={voidRequest.isPending}
                    onClose={() => setVoidTarget(null)}
                    onConfirm={reason =>
                        voidRequest.mutate(
                            { no: voidTarget.no, expectedVersion: voidTarget.version, reason },
                            {
                                onError: error => toast(error.message, true),
                                onSuccess: updated => {
                                    setVoidTarget(null);
                                    toast(`出库单 ${updated.no} 已作废，数量已退回库存和订单`);
                                },
                            },
                        )
                    }
                />
            )}
            {emergencyTarget && (
                <EmergencyVoidModal
                    row={emergencyTarget}
                    pending={emergencyVoidRequest.isPending}
                    onClose={() => setEmergencyTarget(null)}
                    onConfirm={reason =>
                        emergencyVoidRequest.mutate(
                            { no: emergencyTarget.no, expectedVersion: emergencyTarget.version, reason },
                            {
                                onError: error => toast(error.message, true),
                                onSuccess: updated => {
                                    setEmergencyTarget(null);
                                    toast(`出库单 ${updated.no} 已紧急撤销，数量已退回库存和订单`);
                                },
                            },
                        )
                    }
                />
            )}
        </div>
    );
}

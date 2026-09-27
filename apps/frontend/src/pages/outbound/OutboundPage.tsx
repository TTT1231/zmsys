import type { ReactNode } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, RecordCard, CardField } from "@/components/ui/MobileList";
import { EmptyRow } from "@/components/ui/EmptyRow";
import { RecordFields, RecordProduct, RecordSummary } from "@/components/business/RecordDetails";
import { DangerNote } from "@/components/business/DangerNote";
import { CustomerDetailModal } from "@/pages/customers/CustomersPage";
import { BomCell } from "@/components/bom/BomCell";
import { BomRemarkNote } from "@/components/bom/BomRemarkNote";
import { RemarkCell } from "@/components/ui/RemarkCell";
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
    useDeleteOutbound,
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

const outboundStateLabel = (row: OutboundRow) => (row.state === "registered" ? "已登记" : "已作废");

/* 拿到后端实时组装的文档后，向预先打开的窗口渲染单据并调起浏览器打印；作废单带醒目标注。 */
function renderOutboundDocument(document: OutboundPrintDocument, win: Window) {
    win.document.title = `出库单 ${document.no}`;
    const voided = document.state === "voided";
    const items: Array<[string, string]> = [
        ["出库单号", escapeHtml(document.no)],
        ["关联订单", escapeHtml(document.orderNo)],
        ["客户", escapeHtml(`${document.customer}（${document.customerCode}）`)],
        ["BOM 编码", escapeHtml(document.bomCode)],
        ["规格", escapeHtml(document.bomSpec || "—")],
        ["发货数量", escapeHtml(`${num(document.qty)} 个`)],
        ["出库日期", escapeHtml(document.date)],
        ["登记人", escapeHtml(document.operator)],
        ["登记时间", escapeHtml(new Date(document.registeredAt).toLocaleString())],
        ["打印人", escapeHtml(document.printedBy)],
        ["备注", escapeHtml(document.remark || "—")],
        ...(voided ? ([["作废原因", escapeHtml(document.voidReason || "—")]] as Array<[string, string]>) : []),
    ];
    const html = `
    <div style="font-family: Inter, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 640px; margin: 32px auto; color: #101828;">
      ${
          voided
              ? `<p style="margin: 0 0 12px; font-size: 15px; font-weight: 700; color: #b42318; border: 2px solid #b42318; border-radius: 6px; padding: 6px 12px; text-align: center;">已作废 · 本单数量不计入有效出库</p>`
              : ""
      }
      <h1 style="margin: 0 0 4px; font-size: 20px;">出库单</h1>
      <p style="margin: 0 0 16px; font-size: 12px; color: #6e7075;">众茂生产系统 · 打印时间 ${new Date(document.printedAt).toLocaleString()}</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        ${items
            .map(
                ([label, value]) => `
              <tr>
                <td style="width: 96px; padding: 8px 10px; border: 1px solid #e4e7ec; background: #f8fafc; color: #6e7075;">${label}</td>
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
            subtitle={`${row.no} · ${row.orderNo}`}
            width={480}
            footer={
                <>
                    <Button variant="secondary" type="button" disabled={pending} onClick={close}>
                        取消
                    </Button>
                    <Button variant="danger" type="submit" form={formId} disabled={pending}>
                        {pending ? "正在作废…" : "确认作废"}
                    </Button>
                </>
            }
        >
            <form id={formId} onSubmit={submit} aria-busy={pending}>
                <DangerNote
                    className="mb-4"
                    impact={`作废后，库存增加 ${num(row.qty)} 个`}
                    note={`订单的已发数量同时减少 ${num(row.qty)} 个。`}
                />
                <TextArea
                    label="作废原因"
                    required
                    value={reason}
                    error={error}
                    placeholder="例如：发货数量登记错误"
                    onChange={event => setReason(event.target.value)}
                />
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
                        className="min-h-10 rounded-btn border border-line-strong bg-surface px-4 text-14 font-medium text-ink hover:border-primary-border"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        disabled={createOutbound.isPending || over}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-14 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        {createOutbound.isPending ? "正在登记…" : "确认发货"}
                    </button>
                </>
            }
        >
            <div className="flex flex-col gap-5">
                <fieldset className="rounded-panel border border-line p-4">
                    <legend className="px-1.5 text-13 font-semibold text-primary-strong">① 客户与订单</legend>
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
                    <legend className="px-1.5 text-13 font-semibold text-primary-strong">② 订单信息</legend>
                    {selectedOrder && status ? (
                        <div className="flex flex-col gap-3 rounded-xl border border-primary-border bg-primary-soft/40 px-3.5 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="tnum text-14 font-semibold text-primary-strong">
                                    {selectedOrder.orderNo}
                                </span>
                                <StatusBadge status={status.key} label={status.label} />
                            </div>
                            <div>
                                <p className="text-13 text-td">
                                    <span className="tnum font-medium">{selectedOrder.bomCode}</span>
                                    {selectedBom ? ` · ${selectedBom.name}` : ""}
                                </p>
                                {selectedBom?.spec && (
                                    <p className="mt-0.5 wrap-break-word text-12 text-muted">{selectedBom.spec}</p>
                                )}
                            </div>
                            {/* 工艺差异独立警示条：发货前要核对的差异，不能混在规格小字里 */}
                            <BomRemarkNote remark={selectedBom?.remark} />
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                                <div className="min-w-0">
                                    <dt className="text-12 text-muted">订单数量</dt>
                                    <dd className="tnum mt-0.5 text-14 font-semibold text-ink">
                                        {num(selectedOrder.qty)} 个
                                    </dd>
                                </div>
                                <div className="min-w-0">
                                    <dt className="text-12 text-muted">交货日期</dt>
                                    <dd className="tnum mt-0.5 text-14 font-semibold text-ink">
                                        {selectedOrder.deliverDate}
                                        {overdue && <span className="ml-1 font-normal text-warning">已逾期</span>}
                                    </dd>
                                </div>
                                <div className="min-w-0">
                                    <dt className="text-12 text-muted">交付情况</dt>
                                    <dd className="tnum mt-0.5 text-14 font-semibold text-ink">
                                        已发 {num(shipped)} 个
                                    </dd>
                                </div>
                                <div className="min-w-0">
                                    <dt className="text-12 text-muted">账面库存</dt>
                                    <dd className="tnum mt-0.5 text-14 font-semibold text-ink">{num(shareStock)} 个</dd>
                                </div>
                            </dl>
                            <div>
                                <ProgressTrack
                                    value={selectedOrder.qty === 0 ? 0 : selectedOrder.outbound / selectedOrder.qty}
                                    done={remaining === 0}
                                />
                                <p className="mt-1.5 text-13 text-muted">
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
                        <p className="text-13 text-subtle">
                            选择订单后，这里会带出成品档案、订单数量、交货日期与交付情况。
                        </p>
                    )}
                </fieldset>

                <fieldset className="rounded-panel border border-line p-4">
                    <legend className="px-1.5 text-13 font-semibold text-primary-strong">③ 发货明细</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {selectedOrder && maxShip > 0 && (
                            <button
                                type="button"
                                className="text-left text-14 text-primary-strong sm:col-span-2"
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

/** 删除已作废出库单的二次确认：软删除（7 天后悔期后系统物理清理），动作记入系统日志 */
function DeleteOutboundModal({
    row,
    pending,
    onClose,
    onConfirm,
}: {
    row: OutboundRow;
    pending: boolean;
    onClose: () => void;
    onConfirm: () => void;
}) {
    return (
        <Modal
            open
            onClose={onClose}
            title="删除出库单"
            subtitle={`${row.no} · 已作废`}
            width={480}
            footer={
                <>
                    <Button variant="secondary" type="button" onClick={onClose}>
                        取消
                    </Button>
                    <Button variant="danger" type="button" disabled={pending} onClick={onConfirm}>
                        {pending ? "正在删除…" : "确认删除"}
                    </Button>
                </>
            }
        >
            <DangerNote
                impact="删除后，这张出库单会从列表移除"
                note={`已作废的 ${num(row.qty)} 个不再计入库存和订单。删除后无恢复入口，记录由系统保留 7 天供审计，随后永久删除；操作日志始终保留。`}
            />
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
                        <Badge tone={row.state === "voided" ? "danger" : "pending"}>{outboundStateLabel(row)}</Badge>
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
                        // 登记时间 = 系统落账时刻，与入库详情同构；出库日期可补录，以此为准
                        { label: "登记时间", value: row.time },
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
    const deleteRequest = useDeleteOutbound();
    const toast = useToast();
    // 首载出替换式占位,后台刷新出保留式遮罩(200ms 内完成不闪现)
    const overlay = useDelayedFlag(isFetching && !isLoading);
    const snap = data ?? EMPTY_SNAPSHOT;
    const [searchParams, setSearchParams] = useSearchParams();
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("全部品类");
    const [statusFilter, setStatusFilter] = useState("全部状态");
    // 按操作人筛：看单个人的全部出库记录（选项来自台账里实际出现过的操作人）
    const [operatorFilter, setOperatorFilter] = useState("全部操作人");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    // 列排序默认升序：默认按出库日期（同日以单号稳定排序）
    const [sort, setSort] = useState<SortState<LedgerSortKey>>({ key: "date", dir: "asc" });
    // 深链 ?new=outbound 首帧即开弹窗（初始 state 直读）；effect 只负责清参数，不在副作用里开弹窗
    const [newOpen, setNewOpen] = useState(() => searchParams.get("new") === "outbound");
    const [detail, setDetail] = useState<OutboundRow | null>(null);
    /* 订单备注跟客户格走（订单维度信息）：按单号回捞，避免逐行 find */
    const orderRemarkByNo = useMemo(
        () => new Map(snap.orders.map(order => [order.orderNo, order.remark])),
        [snap.orders],
    );
    const [voidTarget, setVoidTarget] = useState<OutboundRow | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<OutboundRow | null>(null);
    // “客户/备注”列点客户名打开客户档案详情；存编码渲染时回捞，刷新后数据保持同步
    const [customerDetailCode, setCustomerDetailCode] = useState<string | null>(null);

    const rows = snap.outboundLedger;
    const operators = useMemo(() => [...new Set(rows.map(row => row.operator))], [rows]);
    const currentDetail = detail ? (rows.find(row => row.no === detail.no) ?? null) : null;
    const boms = snap.boms;
    const bomCategory = useMemo(() => new Map(boms.map(bom => [bom.code, bom.name])), [boms]);
    const categories = [...new Set(boms.map(bom => bom.name))];

    const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return rows.filter(row => {
            if (statusFilter !== "全部状态" && outboundStateLabel(row) !== statusFilter) return false;
            if (category !== "全部品类" && bomCategory.get(row.bomCode) !== category) return false;
            if (operatorFilter !== "全部操作人" && row.operator !== operatorFilter) return false;
            return !kw || `${row.no} ${row.orderNo} ${row.customer} ${row.bomCode}`.toLowerCase().includes(kw);
        });
    }, [rows, keyword, category, statusFilter, operatorFilter, bomCategory]);

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
    const canDeleteVoided = can("outbound:delete");
    const applySort = (key: LedgerSortKey) => setSort(current => nextSortState(current, key));
    // 排序或翻页后行序变化，滚动区回到顶部，避免误以为排错行
    const tableScrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
    }, [page, sort]);

    const requestPrint = (row: OutboundRow) => {
        if (printRequest.isPending) return;
        const win = window.open("", "_blank", "width=760,height=640");
        if (!win) {
            toast("浏览器拦截了打印窗口，请允许本站打开新窗口后重试", true);
            return;
        }
        win.opener = null;
        win.document.title = `正在生成出库单 ${row.no}`;
        win.document.body.textContent = "正在生成出库单…";
        printRequest.mutate(
            { no: row.no },
            {
                onError: error => {
                    win.close();
                    toast(error.message, true);
                },
                onSuccess: document => {
                    if (!win.closed) renderOutboundDocument(document, win);
                },
            },
        );
    };

    useEffect(() => {
        if (searchParams.get("new") === "outbound") setSearchParams({}, { replace: true });
    }, [searchParams, setSearchParams]);

    // 清空条件只作用于筛选行（搜索/状态/品类/操作人）；分页由用户自行操作
    const clearFilters = () => {
        setKeyword("");
        setCategory("全部品类");
        setStatusFilter("全部状态");
        setOperatorFilter("全部操作人");
        setPage(1);
    };
    const filtersActive =
        !!keyword.trim() || statusFilter !== "全部状态" || category !== "全部品类" || operatorFilter !== "全部操作人";

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
                            className="w-full bg-transparent text-14 text-ink outline-none placeholder:text-subtle"
                        />
                    </label>
                    <select
                        value={statusFilter}
                        onChange={event => {
                            setStatusFilter(event.target.value);
                            setPage(1);
                        }}
                        aria-label="按状态筛选"
                        className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink"
                    >
                        {["全部状态", "已登记", "已作废"].map(option => (
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
                        className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink"
                    >
                        <option>全部品类</option>
                        {categories.map(item => (
                            <option key={item}>{item}</option>
                        ))}
                    </select>
                    <select
                        value={operatorFilter}
                        onChange={event => {
                            setOperatorFilter(event.target.value);
                            setPage(1);
                        }}
                        aria-label="按操作人筛选"
                        className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink"
                    >
                        <option>全部操作人</option>
                        {operators.map(item => (
                            <option key={item}>{item}</option>
                        ))}
                    </select>
                    <MobileSortSelect
                        columns={LEDGER_SORT_COLUMNS}
                        value={sort}
                        onChange={next => {
                            if (next) setSort(next);
                        }}
                    />
                    <button
                        type="button"
                        onClick={clearFilters}
                        disabled={!filtersActive}
                        className="min-h-10 px-1 text-14 font-medium text-muted transition hover:text-primary-strong disabled:cursor-not-allowed disabled:text-subtle disabled:hover:text-subtle"
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
                        {pageRows.map(row => {
                            const bom = bomByCode(snap, row.bomCode);
                            return (
                                <RecordCard
                                    key={row.no}
                                    title={row.no}
                                    subtitle={`${row.customer} · ${row.orderNo}`}
                                    voided={row.state === "voided"}
                                    badge={
                                        <Badge tone={row.state === "voided" ? "danger" : "pending"}>
                                            {outboundStateLabel(row)}
                                        </Badge>
                                    }
                                    actions={
                                        <Button variant="secondary" onClick={() => setDetail(row)}>
                                            查看详情
                                        </Button>
                                    }
                                >
                                    <BomCell categories={snap.bomCategories} bom={bom} bomCode={row.bomCode} />
                                    {/* 有工艺差异才挂警示条，与入库台账移动卡片一致 */}
                                    {!!bom?.remark?.trim() && <BomRemarkNote remark={bom.remark} className="mt-2" />}
                                    <div className="mt-2 flex flex-col gap-1.5">
                                        <CardField label="出库数量" value={`${num(row.qty)} 个`} strong />
                                        <CardField label="出库日期" value={row.date} />
                                        <CardField label="操作人" value={row.operator} />
                                    </div>
                                </RecordCard>
                            );
                        })}
                    </ListState>
                </div>
                <div className="hidden lg:block">
                    {isLoading ? (
                        <PageLoading className="py-16" />
                    ) : (
                        <DataTable
                            tableId="outbound"
                            defaultWidths={[158, 190, 110, 302, 150, 110, 110, 90, 90, 150, 100]}
                            recordCount={filtered.length}
                            identityColumn={0}
                            pinnedStart={[0, 1, 2, 3, 4]}
                            scrollRef={tableScrollRef}
                        >
                            <thead>
                                <tr className="text-left text-13 text-muted">
                                    <SortTh
                                        label="出库单号"
                                        active={sort.key === "no"}
                                        dir={sort.dir}
                                        onSort={() => applySort("no")}
                                        className="cell-pad-wide"
                                    />
                                    <th>客户 / 备注</th>
                                    <th>销售订单号</th>
                                    <SortTh
                                        label="BOM 编码"
                                        active={sort.key === "bomCode"}
                                        dir={sort.dir}
                                        onSort={() => applySort("bomCode")}
                                    />
                                    <th>BOM 备注</th>
                                    <SortTh
                                        label="发货数量（个）"
                                        active={sort.key === "qty"}
                                        dir={sort.dir}
                                        onSort={() => applySort("qty")}
                                    />
                                    <SortTh
                                        label="出库日期"
                                        active={sort.key === "date"}
                                        dir={sort.dir}
                                        onSort={() => applySort("date")}
                                    />
                                    {/* 出库备注基本不填，排到状态之后、操作列之前 */}
                                    <th className="text-14">操作人</th>
                                    <th>状态</th>
                                    <th>出库备注</th>
                                    <th className="cell-pad-wide text-center">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && (
                                    <EmptyRow colSpan={11} description="没有找到匹配的出库记录" />
                                )}
                                {pageRows.map(row => {
                                    const bom = bomByCode(snap, row.bomCode);
                                    return (
                                        <tr
                                            key={row.no}
                                            className={
                                                row.state === "voided"
                                                    ? /* row-voided：底色落 td 层，避开固定列白底与全局 hover 盖色 */
                                                      "row-voided"
                                                    : undefined
                                            }
                                        >
                                            <td
                                                className={`cell-pad-wide tnum text-14 font-semibold text-td-strong${
                                                    row.state === "voided" ? " line-through decoration-danger/50" : ""
                                                }`}
                                            >
                                                {row.no}
                                            </td>
                                            <td>
                                                {/* 与销售订单列表同款：客户名可点开客户档案详情（档案已删除的不可点） */}
                                                <CustomerCell
                                                    name={row.customer}
                                                    remark={orderRemarkByNo.get(row.orderNo)}
                                                    onClick={
                                                        snap.customers.some(item => item.code === row.customerCode)
                                                            ? () => setCustomerDetailCode(row.customerCode)
                                                            : undefined
                                                    }
                                                />
                                            </td>
                                            <td className="tnum text-14 text-td">{row.orderNo}</td>
                                            <td>
                                                <BomCell
                                                    categories={snap.bomCategories}
                                                    bom={bom}
                                                    bomCode={row.bomCode}
                                                />
                                            </td>
                                            <td>
                                                <RemarkCell remark={bom?.remark} variant="warning" />
                                            </td>
                                            <td>
                                                <QtyCell value={row.qty} />
                                            </td>
                                            <td className="tnum text-14 text-td">{row.date}</td>
                                            <td className="text-14 text-td">{row.operator}</td>
                                            <td>
                                                {row.state === "voided" ? (
                                                    <Badge tone="danger">已作废</Badge>
                                                ) : (
                                                    <Badge tone="pending">已登记</Badge>
                                                )}
                                            </td>
                                            <td>
                                                <RemarkCell remark={row.remark} />
                                            </td>
                                            <td className="cell-pad-wide text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => setDetail(row)}
                                                    className="text-14 font-medium text-primary-strong underline-offset-2 hover:underline"
                                                >
                                                    查看详情
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
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
            <CustomerDetailModal
                customer={
                    customerDetailCode ? (snap.customers.find(item => item.code === customerDetailCode) ?? null) : null
                }
                snap={snap}
                onClose={() => setCustomerDetailCode(null)}
            />
            <OutboundDetailModal
                row={currentDetail}
                snap={snap}
                onClose={() => setDetail(null)}
                actions={
                    currentDetail && (
                        <>
                            {/* 危险入口固定最左（软红底），打印保持主按钮紧邻关闭：已登记/已作废两种状态槽位一致 */}
                            {canVoid && currentDetail.state === "registered" && (
                                <button
                                    type="button"
                                    disabled={voidRequest.isPending}
                                    onClick={() => setVoidTarget(currentDetail)}
                                    className="min-h-10 rounded-btn border border-danger/30 bg-danger-soft px-4 text-14 font-medium text-danger disabled:opacity-50"
                                >
                                    作废
                                </button>
                            )}
                            {/* 已作废单的清理入口：软删除（7 天后悔期），仅持有删除权限者可见 */}
                            {canDeleteVoided && currentDetail.state === "voided" && (
                                <button
                                    type="button"
                                    disabled={deleteRequest.isPending}
                                    onClick={() => setDeleteTarget(currentDetail)}
                                    className="min-h-10 rounded-btn border border-danger/30 bg-danger-soft px-4 text-14 font-medium text-danger disabled:opacity-50"
                                >
                                    删除
                                </button>
                            )}
                            {canPrint && (
                                <Button disabled={printRequest.isPending} onClick={() => requestPrint(currentDetail)}>
                                    {/* 打印是常规操作不带图标（图标库也无 print 字形，传了会落到 info 兜底） */}
                                    {printRequest.isPending ? "处理中…" : "打印"}
                                </Button>
                            )}
                        </>
                    )
                }
            />
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
                                    toast(
                                        `${updated.no} 已作废，库存增加 ${num(updated.qty)} 个，订单已发减少 ${num(updated.qty)} 个`,
                                    );
                                },
                            },
                        )
                    }
                />
            )}
            {deleteTarget && (
                <DeleteOutboundModal
                    row={deleteTarget}
                    pending={deleteRequest.isPending}
                    onClose={() => setDeleteTarget(null)}
                    onConfirm={() =>
                        deleteRequest.mutate(
                            { no: deleteTarget.no, expectedVersion: deleteTarget.version },
                            {
                                onError: error => toast(error.message, true),
                                onSuccess: () => {
                                    setDeleteTarget(null);
                                    setDetail(null);
                                    toast(`出库单 ${deleteTarget.no} 已删除`);
                                },
                            },
                        )
                    }
                />
            )}
        </div>
    );
}

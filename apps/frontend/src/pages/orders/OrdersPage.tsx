import { DataTable } from "@/components/ui/DataTable";
import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { SearchSelect } from "@/components/ui/SearchSelect";
import { ListState, OrderTaskCard } from "@/components/ui/MobileList";
import { EmptyRow } from "@/components/ui/EmptyRow";
import { BomCell } from "@/components/bom/BomCell";
import { RemarkCell } from "@/components/ui/RemarkCell";
import { RecordFields, RecordProduct, RecordSummary } from "@/components/business/RecordDetails";
import { DangerNote } from "@/components/business/DangerNote";
import { CustomerDetailModal } from "@/pages/customers/CustomersPage";
import { OutboundModal } from "@/pages/outbound/OutboundPage";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { downloadCsv, num } from "@/lib/format";
import { useApp } from "@/context/useApp";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { Badge, Button, ProgressTrack, StatusBadge, TableLink } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { CustomerCell, DateCell, QtyCell } from "@/components/ui/cells";
import { SortTh } from "@/components/ui/SortTh";
import { MobileSortSelect } from "@/components/ui/MobileSortSelect";
import { nextSortState, type SortState } from "@/lib/tableSort";
import { Field, TextArea, TextField, DateField } from "@/components/ui/Field";
import {
    useArchiveOrder,
    useCreateOrder,
    useDeleteOrder,
    useUpdateOrder,
    useWbRefresh,
    useWbSnapshot,
} from "@/data/queries";
import { EMPTY_SNAPSHOT, bomByCode, maxShipOf, orderStatusOf, remainingOf } from "@/data/views";
import { addDays, addMonths, formatDateTime, todayIso } from "@/lib/date";
import { useToast } from "@/components/ui/toastContexts";
import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useDelayedFlag } from "@/components/ui/useDelayedFlag";
import { PageLoading } from "@/components/ui/PageLoading";
import type { Order, Snapshot } from "@/api";

const STATUS_OPTIONS = ["全部状态", "待备货", "可发货", "部分可发货", "部分发货", "已完成"];
const EMPTY_BOMS: Snapshot["boms"] = [];
const EMPTY_CUSTOMERS: Snapshot["customers"] = [];

/* 可排序列：订单号 / 数量 / 交期 / 交付情况（按累计已发对比）/ 创建时间；桌面表头与移动端排序下拉共用 */
type OrderSortKey = "orderNo" | "qty" | "deliverDate" | "outbound" | "createdAt";
const ORDER_SORT_COLUMNS: Array<{ key: OrderSortKey; label: string }> = [
    { key: "orderNo", label: "销售订单号" },
    { key: "qty", label: "订单数量" },
    { key: "deliverDate", label: "交货日期" },
    { key: "outbound", label: "交付情况" },
    { key: "createdAt", label: "创建时间" },
];

/* 交期筛选激活时在按钮上回显的简写日期（MM/DD） */
const shortDate = (isoDate: string) => `${isoDate.slice(5, 7)}/${isoDate.slice(8, 10)}`;

/* 新建销售订单弹窗（三步表单：客户与交付 → BOM 编码 → 备注） */
export function NewOrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { data } = useWbSnapshot();
    const createOrder = useCreateOrder();
    const toast = useToast();
    const customers = data?.customers ?? EMPTY_CUSTOMERS;
    const boms = data?.boms ?? EMPTY_BOMS;

    const [customerCode, setCustomerCode] = useState("");
    const [qty, setQty] = useState("");
    const [orderDate, setOrderDate] = useState(todayIso);
    const [deliverDate, setDeliverDate] = useState("");
    const [bomCode, setBomCode] = useState("");
    const [remark, setRemark] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});

    /* 用户改动某字段即清除该字段的报错，避免补填后验证词残留 */
    const clearError = (key: string) => setErrors(current => ({ ...current, [key]: "" }));

    const customerOptions = useMemo(
        () =>
            customers.map(customer => ({
                value: customer.code,
                label: `${customer.name}（${customer.code}）`,
            })),
        [customers],
    );
    /* 输入即解析：编码在物料与BOM建档时已生成，这里按编码回捞档案（容错首尾空格与大小写） */
    const matchedBom = useMemo(() => {
        const code = bomCode.trim().toLowerCase();
        return code ? boms.find(bom => bom.code.toLowerCase() === code) : undefined;
    }, [boms, bomCode]);

    const inputBomCode = (nextCode: string) => {
        setBomCode(nextCode);
        clearError("bom");
    };

    const reset = () => {
        setCustomerCode("");
        setQty("");
        setOrderDate(todayIso());
        setDeliverDate("");
        setBomCode("");
        setRemark("");
        setErrors({});
    };

    const submit = () => {
        if (createOrder.isPending) return;
        const nextErrors: Record<string, string> = {};
        if (!orderDate) nextErrors.orderDate = "请选择下单日期";
        if (!customerCode) nextErrors.customerCode = "请选择客户";
        if (!qty || Number(qty) <= 0) nextErrors.qty = "请填写订单数量";
        if (!deliverDate) nextErrors.deliverDate = "请选择交货日期";
        if (!bomCode.trim()) nextErrors.bom = "请输入 BOM 编码";
        else if (!matchedBom) nextErrors.bom = "未找到该 BOM 编码，请核对";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length)
            requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus(),
            );
        if (Object.keys(nextErrors).length > 0) return;

        createOrder.mutate(
            {
                customerCode,
                bomCode: matchedBom!.code,
                qty: Number(qty),
                deliverDate,
                orderDate,
                remark,
            },
            {
                onError: error => toast(error.message, true),
                onSuccess: () => {
                    toast("订单已创建，可在订单列表查看");
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
            title="新建销售订单"
            subtitle="输入 BOM 编码自动带出成品档案"
            width={640}
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
                        disabled={createOrder.isPending}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-14 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        {createOrder.isPending ? "正在提交…" : "提交订单"}
                    </button>
                </>
            }
        >
            <div className="flex flex-col gap-5">
                <fieldset className="rounded-panel border border-line p-4">
                    <legend className="px-1.5 text-13 font-semibold text-primary-strong">① 客户与交付</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <SearchSelect
                            label="客户"
                            required
                            error={errors.customerCode}
                            value={customerCode}
                            onChange={code => {
                                setCustomerCode(code);
                                clearError("customerCode");
                            }}
                            options={customerOptions}
                        />
                        <TextField
                            label="订单数量（个）"
                            required
                            inputMode="numeric"
                            placeholder="如 2400"
                            error={errors.qty}
                            value={qty}
                            onChange={event => {
                                setQty(event.target.value.replace(/\D/g, ""));
                                clearError("qty");
                            }}
                        />
                        <DateField
                            label="下单日期"
                            error={errors.orderDate}
                            required
                            value={orderDate}
                            onChange={event => {
                                setOrderDate(event.target.value);
                                clearError("orderDate");
                            }}
                        />
                        <DateField
                            label="交货日期"
                            required
                            error={errors.deliverDate}
                            value={deliverDate}
                            onChange={event => {
                                setDeliverDate(event.target.value);
                                clearError("deliverDate");
                            }}
                        />
                    </div>
                </fieldset>

                <fieldset className="rounded-panel border border-line p-4">
                    <legend className="px-1.5 text-13 font-semibold text-primary-strong">② BOM 编码</legend>
                    <div className="flex flex-col gap-3">
                        <TextField
                            label="BOM 编码"
                            required
                            placeholder="如 KW042"
                            error={errors.bom}
                            value={bomCode}
                            onChange={event => inputBomCode(event.target.value)}
                        />
                        {/* 输入即反馈：命中回显成品档案即完成选择；失配仅中性提示，提交时才拦截报错 */}
                        {bomCode.trim() && !matchedBom && (
                            <p className="text-13 text-muted" aria-live="polite">
                                未找到编码「{bomCode.trim()}」对应的 BOM，请到「物料与BOM」核对
                            </p>
                        )}
                        {matchedBom && (
                            <div
                                className="rounded-btn border border-primary-border bg-primary-soft/70 px-3.5 py-3"
                                aria-live="polite"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="tnum text-14 font-semibold text-primary-strong">
                                        {matchedBom.code}
                                    </span>
                                    <span className="rounded-full bg-surface px-2 py-1 text-12 font-medium text-success">
                                        已匹配
                                    </span>
                                </div>
                                <p className="mt-1 text-13 text-td">{matchedBom.name}</p>
                                <p className="mt-1 wrap-break-word text-12 text-muted">{matchedBom.spec}</p>
                            </div>
                        )}
                    </div>
                </fieldset>

                <fieldset className="rounded-panel border border-line p-4">
                    <legend className="px-1.5 text-13 font-semibold text-primary-strong">③ 订单备注</legend>
                    <TextArea
                        label="备注"
                        placeholder="选填"
                        value={remark}
                        onChange={event => setRemark(event.target.value)}
                    />
                </fieldset>
            </div>
        </Modal>
    );
}

/* 编辑销售订单弹窗：已发货（累计出库>0）订单数量与交期锁定、仅可改备注。
 * 业务上没有"取消订单"动作：一件未发不要了直接删除（超级管理员）；发过货
 * 不要了直接归档结案（超级管理员）——欠量随归档关闭 */
function EditOrderModal({
    order,
    hasShipmentLedger,
    onClose,
}: {
    order: Order;
    hasShipmentLedger: boolean;
    onClose: () => void;
}) {
    const { can } = useApp();
    const updateOrder = useUpdateOrder();
    const deleteOrder = useDeleteOrder();
    const archiveOrder = useArchiveOrder();
    const toast = useToast();
    const [qty, setQty] = useState(String(order.qty));
    const [deliverDate, setDeliverDate] = useState(order.deliverDate);
    const [remark, setRemark] = useState(order.remark);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [confirmArchive, setConfirmArchive] = useState(false);
    const [archiveRemark, setArchiveRemark] = useState("");
    const cancelled = order.lifecycleStatus === "cancelled";
    /* 已发货订单锁数量与交期（与后端口径一致），仅备注可改；历史取消单后端全
     * 字段不可改，表单只读，弹窗仅承载归档/删除终端动作 */
    const locked = order.outbound > 0 || cancelled;
    const remarkDirty = remark !== order.remark;
    /* 可见出库单（含已作废但未删除）仍需先处理；已软删除的出库单不再阻止订单删除。 */
    const canDelete = can("orders:delete") && order.outbound === 0 && !hasShipmentLedger;
    /* 归档（仅超级管理员）：发过货的订单（已完成/部分发货）不要了直接归档结案；
     * 一件未发不归档，直接删除 */
    const canArchive = can("orders:archive") && order.outbound > 0;

    const submit = () => {
        if (!order) return;
        const nextErrors: Record<string, string> = {};
        if (!locked) {
            if (!qty || Number(qty) <= 0) nextErrors.qty = "请填写订单数量";
            if (Number(qty) < order.outbound) nextErrors.qty = `新数量不能低于累计已发 ${order.outbound} 个`;
            if (!deliverDate) nextErrors.deliverDate = "请选择交货日期";
        }
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length)
            requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus(),
            );
        if (Object.keys(nextErrors).length > 0) return;
        updateOrder.mutate(
            {
                orderNo: order.orderNo,
                expectedVersion: order.version,
                // 已发货订单数量/交期不可改，不上送以免触发后端锁定校验
                ...(locked ? {} : { qty: Number(qty), deliverDate }),
                remark,
            },
            {
                onSuccess: () => {
                    toast(`订单 ${order.orderNo} 已更新`);
                    onClose();
                },
                onError: error => toast(error.message, true),
            },
        );
    };

    const submitDelete = () => {
        if (deleteOrder.isPending) return;
        deleteOrder.mutate(
            { orderNo: order.orderNo, expectedVersion: order.version },
            {
                onSuccess: () => {
                    toast(`订单 ${order.orderNo} 已删除`);
                    setConfirmDelete(false);
                    onClose();
                },
                onError: error => toast(error.message, true),
            },
        );
    };

    const submitArchive = () => {
        if (archiveOrder.isPending) return;
        archiveOrder.mutate(
            { orderNo: order.orderNo, expectedVersion: order.version, reason: archiveRemark.trim() },
            {
                onSuccess: () => {
                    toast(`订单 ${order.orderNo} 已归档，可在「归档订单」查看`);
                    setConfirmArchive(false);
                    onClose();
                },
                onError: error => toast(error.message, true),
            },
        );
    };

    return (
        <Modal
            open={!!order}
            onClose={onClose}
            title="编辑销售订单"
            subtitle={order ? `${order.orderNo} · ${order.customer}` : ""}
            width={520}
            footer={
                <>
                    <div className="mr-auto flex flex-wrap items-center gap-1">
                        {canArchive && (
                            <button
                                type="button"
                                onClick={() => setConfirmArchive(true)}
                                className="min-h-10 rounded-btn px-2 text-14 font-medium text-muted transition hover:bg-soft hover:text-td-strong"
                            >
                                归档订单
                            </button>
                        )}
                        {canDelete && (
                            <button
                                type="button"
                                onClick={() => setConfirmDelete(true)}
                                className="min-h-10 rounded-btn px-2 text-14 font-medium text-danger transition hover:bg-danger-soft"
                            >
                                删除订单
                            </button>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="min-h-10 rounded-btn border border-line-strong bg-surface px-4 text-14 font-medium text-ink hover:border-primary-border"
                    >
                        取消
                    </button>
                    {cancelled ? (
                        // 取消单后端全字段不可改，无保存动作；弹窗仅承载归档/删除
                        <button
                            type="button"
                            onClick={onClose}
                            className="min-h-10 rounded-btn bg-primary px-4 text-14 font-medium text-white hover:bg-primary-hover"
                        >
                            完成
                        </button>
                    ) : (
                        <button
                            type="button"
                            disabled={updateOrder.isPending || (locked && !remarkDirty)}
                            onClick={submit}
                            className="min-h-10 rounded-btn bg-primary px-4 text-14 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                        >
                            {updateOrder.isPending ? "正在提交…" : "保存修改"}
                        </button>
                    )}
                </>
            }
        >
            {order && (
                <div className="grid gap-3 sm:grid-cols-2">
                    <TextField
                        label="订单数量（个）"
                        required
                        inputMode="numeric"
                        value={qty}
                        error={errors.qty}
                        disabled={locked}
                        onChange={event => setQty(event.target.value.replace(/\D/g, ""))}
                    />
                    <DateField
                        label="交货日期"
                        required
                        error={errors.deliverDate}
                        value={deliverDate}
                        disabled={locked}
                        onChange={event => setDeliverDate(event.target.value)}
                    />
                    <div className="sm:col-span-2">
                        <TextArea
                            label="订单备注"
                            value={remark}
                            disabled={cancelled}
                            onChange={event => setRemark(event.target.value)}
                        />
                    </div>
                    {locked && !cancelled && (
                        <p className="text-13 text-subtle sm:col-span-2">
                            该订单累计已发 {order.outbound} 个，数量与交货日期不可修改，仅可修改备注。
                        </p>
                    )}
                    {cancelled && (
                        <p className="text-13 text-subtle sm:col-span-2">
                            该订单已取消，信息不可修改{order.outbound > 0 ? "；可归档留档" : "；可由超级管理员删除"}。
                        </p>
                    )}
                    {canDelete && (
                        <p className="text-13 text-subtle sm:col-span-2">
                            该订单一件未发，可由超级管理员删除；删除前需二次确认。
                        </p>
                    )}
                </div>
            )}
            {confirmDelete && (
                <Modal
                    open
                    onClose={() => setConfirmDelete(false)}
                    title="删除销售订单"
                    subtitle={order ? `${order.orderNo} · ${order.customer}` : ""}
                    width={440}
                    footer={
                        <>
                            <Button variant="secondary" type="button" onClick={() => setConfirmDelete(false)}>
                                取消
                            </Button>
                            <Button
                                variant="danger"
                                type="button"
                                disabled={deleteOrder.isPending}
                                onClick={submitDelete}
                            >
                                {deleteOrder.isPending ? "正在删除…" : "确认删除"}
                            </Button>
                        </>
                    }
                >
                    <DangerNote
                        impact="删除后，这张订单会从列表移除"
                        note={`${num(order.qty)} 个的订单当前已发 0 个。删除后无恢复入口，记录由系统保留 7 天供审计，随后永久删除；操作日志始终保留。`}
                    />
                </Modal>
            )}
            {confirmArchive && order && (
                <Modal
                    open
                    onClose={() => setConfirmArchive(false)}
                    label="终态操作"
                    title="归档销售订单"
                    subtitle={`${order.orderNo} · ${order.customer}`}
                    width={480}
                    footer={
                        <>
                            <button
                                type="button"
                                onClick={() => setConfirmArchive(false)}
                                className="min-h-10 rounded-btn border border-line-strong bg-surface px-4 text-14 font-medium text-ink hover:border-primary-border"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                disabled={archiveOrder.isPending}
                                onClick={submitArchive}
                                className="min-h-10 rounded-btn bg-primary px-4 text-14 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                            >
                                {archiveOrder.isPending ? "正在归档…" : "确认归档"}
                            </button>
                        </>
                    }
                >
                    <div className="flex flex-col gap-3">
                        <div className="flex items-start gap-3 rounded-panel border border-line bg-soft p-4">
                            <Icon name="archive" size={20} className="mt-0.5 shrink-0 text-muted" />
                            <div className="text-14 leading-6 text-td">
                                即将归档订单 <span className="tnum font-semibold text-ink">{order.orderNo}</span>（
                                {order.customer} · 订单 {num(order.qty)} 个 · 已发 {num(order.outbound)} 个）。
                                <p className="mt-1 text-subtle">
                                    归档即结案：订单将从销售订单列表移入「归档订单」，仅供查询，不可修改或删除。
                                    {order.outbound > 0 && order.outbound < order.qty && " 剩余欠量不再安排交付。"}
                                </p>
                                <p className="mt-1 font-medium text-td-strong">归档为最终操作，不可恢复。</p>
                            </div>
                        </div>
                        <TextArea
                            label="归档备注（选填）"
                            placeholder="如：行情不好客户弃单"
                            value={archiveRemark}
                            onChange={event => setArchiveRemark(event.target.value.slice(0, 500))}
                        />
                    </div>
                </Modal>
            )}
        </Modal>
    );
}

/* 订单详情弹窗 */
export function OrderDetailModal({
    order,
    snap,
    onClose,
    onShip,
    onEdit,
}: {
    order: Order | null;
    snap: Snapshot;
    onClose: () => void;
    onShip?: () => void;
    onEdit?: () => void;
}) {
    if (!order) return null;
    const bom = bomByCode(snap, order.bomCode);
    const status = orderStatusOf(snap, order);
    const remaining = remainingOf(order);
    const shipments = snap.outboundLedger.filter(row => row.orderNo === order.orderNo);
    // 曾取消过（终态为取消，或取消后再归档）：取消语境保留展示
    const wasCancelled = order.lifecycleStatus === "cancelled" || !!order.cancelledAt;
    return (
        <Modal
            open={!!order}
            onClose={onClose}
            label="订单详情"
            title={order.orderNo}
            subtitle={`${order.customer} · ${order.customerCode}`}
            width={560}
            layout="detail"
            footer={
                <>
                    {onEdit && (
                        <Button variant="secondary" onClick={onEdit}>
                            编辑订单
                        </Button>
                    )}
                    {onShip && maxShipOf(snap, order.orderNo) > 0 && (
                        <Button icon="truck" onClick={onShip}>
                            登记发货
                        </Button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="min-h-10 rounded-btn border border-line-strong bg-surface px-4 text-14 font-medium text-ink"
                    >
                        关闭
                    </button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <RecordSummary
                    metrics={[
                        { label: "订单数量", value: order.qty },
                        { label: "累计出库", value: order.outbound },
                        { label: "剩余待交付", value: remaining },
                    ]}
                    status={<StatusBadge status={status.key} label={status.label} />}
                    note={
                        order.lifecycleStatus === "cancelled"
                            ? "订单已取消，剩余数量不再安排交付。"
                            : order.lifecycleStatus === "archived"
                              ? "订单已归档，仅供查询，不可修改。"
                              : undefined
                    }
                />
                <RecordProduct categories={snap.bomCategories} bom={bom} bomCode={order.bomCode} />
                <RecordFields
                    title="订单信息"
                    items={[
                        { label: "下单日期", value: order.orderDate },
                        {
                            label: "交货日期",
                            value: (
                                <>
                                    {order.deliverDate}
                                    {remaining > 0 && order.deliverDate < todayIso() && (
                                        <span className="ml-1.5 text-warning">已逾期</span>
                                    )}
                                </>
                            ),
                        },
                        { label: "创建人", value: order.createdBy },
                        { label: "创建时间", value: formatDateTime(order.createdAt) },
                        { label: "订单备注", value: order.remark || "—", fullWidth: true },
                        ...(wasCancelled
                            ? [{ label: "取消原因", value: order.cancelReason || "—", fullWidth: true }]
                            : []),
                        ...(order.archivedAt
                            ? [
                                  { label: "归档人", value: order.archivedBy || "—" },
                                  { label: "归档时间", value: new Date(order.archivedAt).toLocaleString() },
                                  { label: "归档备注", value: order.archiveReason || "—", fullWidth: true },
                              ]
                            : []),
                    ]}
                />
                <details className="border-t border-line pt-2" open={shipments.length > 0}>
                    <summary className="min-h-11 cursor-pointer py-3 text-14 font-medium text-ink">
                        发货记录（{shipments.length}）
                    </summary>
                    <div className="mt-1 flex flex-col gap-2">
                        {shipments.length === 0 && <p className="text-13 text-subtle">暂无发货记录。</p>}
                        {shipments.map(row => (
                            <div
                                key={row.no}
                                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-input bg-soft p-3 text-14"
                            >
                                <span className="tnum text-ink wrap-anywhere">{row.no}</span>
                                <QtyCell value={row.qty} unit="个" />
                                <span className="text-13 leading-5 text-muted wrap-anywhere">
                                    {row.date} · {row.operator}
                                </span>
                                <Badge tone={row.state === "voided" ? "danger" : "pending"}>
                                    {row.state === "voided" ? "已作废" : "已登记"}
                                </Badge>
                            </div>
                        ))}
                    </div>
                </details>
            </div>
        </Modal>
    );
}

export function OrdersPage() {
    const { role, can } = useApp();
    const { data, isLoading, isFetching } = useWbSnapshot();
    const { refresh } = useWbRefresh();
    // 首载出替换式占位,后台刷新出保留式遮罩(200ms 内完成不闪现)
    const overlay = useDelayedFlag(isFetching && !isLoading);
    const snap = data ?? EMPTY_SNAPSHOT;
    const [searchParams, setSearchParams] = useSearchParams();
    const [statusFilter, setStatusFilter] = useState("全部状态");
    const [keyword, setKeyword] = useState(searchParams.get("q") ?? "");
    const [categoryFilter, setCategoryFilter] = useState("全部品类");
    const [dateStart, setDateStart] = useState("");
    const [dateEnd, setDateEnd] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    // 列排序默认升序：默认按订单号；仓管视角默认交货日期（按交期备货）
    const [sort, setSort] = useState<SortState<OrderSortKey>>({
        key: role === "warehouse" ? "deliverDate" : "orderNo",
        dir: "asc",
    });
    // 深链 ?new=order 首帧即开弹窗（初始 state 直读）；effect 只负责清参数，不在副作用里开弹窗
    const [newOpen, setNewOpen] = useState(() => searchParams.get("new") === "order");
    const [ship, setShip] = useState<string | null>(null);
    const [taskFilter, setTaskFilter] = useState(searchParams.get("task") ?? (role === "warehouse" ? "ready" : "all"));
    const [detail, setDetail] = useState<Order | null>(null);
    const [editing, setEditing] = useState<Order | null>(null);
    // “客户/备注”列点客户名打开客户档案详情；存编码渲染时回捞，刷新后数据保持同步
    const [customerDetailCode, setCustomerDetailCode] = useState<string | null>(null);

    /* 归档单分流到「归档订单」页，销售订单页只展示活跃与已取消订单 */
    const orders = snap.orders.filter(order => order.lifecycleStatus !== "archived");
    const boms = snap.boms;
    const bomCategory = new Map(boms.map(bom => [bom.code, bom.name]));
    const categories = [...new Set(boms.map(bom => bom.name))];
    const counts = {
        total: orders.length,
        // 待交付口径与剩余量一致：已取消订单剩余按 0，不再虚增计数
        unfinished: orders.filter(order => remainingOf(order) > 0).length,
        ready: orders.filter(order => maxShipOf(snap, order.orderNo) > 0).length,
    };

    const filtered = (() => {
        const kw = keyword.trim().toLowerCase();
        const rows = orders.filter(order => {
            if (taskFilter === "pending" && remainingOf(order) <= 0) return false;
            if (taskFilter === "ready" && maxShipOf(snap, order.orderNo) <= 0) return false;
            if (statusFilter !== "全部状态" && orderStatusOf(snap, order).label !== statusFilter) return false;
            if (categoryFilter !== "全部品类" && bomCategory.get(order.bomCode) !== categoryFilter) return false;
            if (dateStart && order.deliverDate < dateStart) return false;
            if (dateEnd && order.deliverDate > dateEnd) return false;
            if (kw) {
                const bom = bomByCode(snap, order.bomCode);
                const text =
                    `${order.orderNo} ${order.customer} ${order.customerCode} ${order.bomCode} ${bom?.spec}`.toLowerCase();
                if (!text.includes(kw)) return false;
            }
            return true;
        });
        return rows;
    })();

    const sorted = (() => {
        const factor = sort.dir === "asc" ? 1 : -1;
        return [...filtered].sort((a, b) => {
            const byKey =
                sort.key === "qty"
                    ? a.qty - b.qty
                    : sort.key === "outbound"
                      ? a.outbound - b.outbound
                      : sort.key === "deliverDate"
                        ? a.deliverDate.localeCompare(b.deliverDate)
                        : sort.key === "createdAt"
                          ? a.createdAt.localeCompare(b.createdAt)
                          : a.orderNo.localeCompare(b.orderNo);
            return byKey * factor || a.orderNo.localeCompare(b.orderNo);
        });
    })();

    const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
    const dateFilterActive = !!dateStart || !!dateEnd;
    const filtersActive =
        dateFilterActive || !!keyword.trim() || statusFilter !== "全部状态" || categoryFilter !== "全部品类";
    const dateLabel =
        dateStart && dateEnd
            ? `交期：${shortDate(dateStart)}–${shortDate(dateEnd)}`
            : dateStart
              ? `交期：${shortDate(dateStart)} 起`
              : dateEnd
                ? `交期：至 ${shortDate(dateEnd)}`
                : "交期";
    /* 交期快捷区间：手机上免滚原生日期选择器 */
    const today = todayIso();
    const monthStart = `${today.slice(0, 8)}01`;
    const quickRanges = [
        { label: "近 7 天", start: addDays(today, -6), end: today },
        { label: "近 30 天", start: addDays(today, -29), end: today },
        { label: "本月", start: monthStart, end: addDays(addMonths(monthStart, 1), -1) },
        { label: "下月", start: addMonths(monthStart, 1), end: addDays(addMonths(monthStart, 2), -1) },
    ];

    useEffect(() => {
        if (searchParams.get("new") === "order") setSearchParams({}, { replace: true });
    }, [searchParams, setSearchParams]);

    const applySort = (key: OrderSortKey) => setSort(current => nextSortState(current, key));
    // 排序或翻页后行序变化，滚动区回到顶部，避免误以为排错行
    const tableScrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
    }, [page, sort]);

    // 清空条件只作用于筛选行（搜索/状态/品类/交期）；快捷 tab 由用户自行切换
    const clearFilters = () => {
        setKeyword("");
        setStatusFilter("全部状态");
        setCategoryFilter("全部品类");
        setDateStart("");
        setDateEnd("");
        setPage(1);
    };
    const clearDates = () => {
        setDateStart("");
        setDateEnd("");
        setPage(1);
    };

    const canCreate = can("orders:create");
    const canEdit = can("orders:edit");
    const canShip = can("outbound:ship");

    return (
        <div className="flex flex-col gap-5">
            <h1 className="sr-only">{role === "warehouse" ? "待发货订单" : "销售订单"}</h1>

            <section className="relative overflow-hidden rounded-panel border border-line bg-surface/97 shadow-card">
                {overlay && <LoadingOverlay />}
                <div className="list-card-primary">
                    <div className="table-task-tabs" aria-label="订单快捷筛选">
                        {[
                            { key: "all", label: "全部", count: counts.total },
                            { key: "pending", label: "待交付", count: counts.unfinished },
                            { key: "ready", label: "可发货", count: counts.ready },
                        ].map(item => (
                            <button
                                type="button"
                                key={item.key}
                                aria-pressed={taskFilter === item.key}
                                onClick={() => {
                                    setTaskFilter(item.key);
                                    setStatusFilter("全部状态");
                                    setPage(1);
                                }}
                            >
                                {item.label} <strong>{item.count}</strong>
                            </button>
                        ))}
                    </div>
                    <TableHeaderActions className="ml-auto">
                        {canCreate && (
                            <Button icon="plus" className="max-sm:flex-1" onClick={() => setNewOpen(true)}>
                                新建订单
                            </Button>
                        )}
                    </TableHeaderActions>
                </div>
                <div className="list-toolbar flex flex-wrap items-center border-b border-line bg-linear-to-b from-surface to-panel px-5 py-4 lg:gap-2.5">
                    {/* 搜索最左：窄屏由 list-toolbar 规则独占整行，宽屏固定 280px */}
                    <label className="flex h-10 items-center gap-2 rounded-btn border border-line-strong bg-surface px-3 lg:w-70">
                        <Icon name="search" size={15} className="text-subtle" />
                        <input
                            value={keyword}
                            onChange={event => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                            placeholder="客户名 / 订单号 / BOM"
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
                        {STATUS_OPTIONS.map(option => (
                            <option key={option}>{option}</option>
                        ))}
                    </select>
                    <select
                        value={categoryFilter}
                        onChange={event => {
                            setCategoryFilter(event.target.value);
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
                    <MobileSortSelect columns={ORDER_SORT_COLUMNS} value={sort} onChange={setSort} />
                    <details className="relative">
                        <summary
                            className={`flex h-10 list-none items-center gap-1.5 rounded-btn px-3 text-14 transition ${
                                dateFilterActive
                                    ? "bg-primary-soft text-primary-strong"
                                    : "text-ink hover:text-primary-strong"
                            }`}
                        >
                            <Icon name="calendar" size={15} />
                            {dateLabel}
                        </summary>
                        {/* 移动端贴底弹层（同 Modal：scrim 关闭 + 顶圆角），宽屏锚定按钮右侧下拉；
                            section 有 overflow-hidden，下拉面板在窄屏会被裁剪，故窄屏走 fixed 贴底 */}
                        <div
                            className="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px] lg:hidden"
                            onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}
                        />
                        <div className="absolute top-12 right-0 z-50 grid w-75 grid-cols-1 gap-2 rounded-xl border border-line bg-surface p-3 shadow-modal max-lg:fixed max-lg:inset-x-0 max-lg:top-auto max-lg:bottom-0 max-lg:left-0 max-lg:w-auto max-lg:gap-3 max-lg:rounded-b-none max-lg:rounded-t-[22px] max-lg:border-x-0 max-lg:border-b-0 max-lg:p-4 max-lg:pb-[max(16px,env(safe-area-inset-bottom))]">
                            <div className="flex items-center justify-between lg:hidden">
                                <span className="text-14 font-semibold text-ink">按交货日期筛选</span>
                                <button
                                    type="button"
                                    aria-label="关闭"
                                    onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}
                                    className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition hover:bg-soft hover:text-ink"
                                >
                                    <Icon name="close" size={16} />
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {quickRanges.map(item => {
                                    const active = dateStart === item.start && dateEnd === item.end;
                                    return (
                                        <button
                                            type="button"
                                            key={item.label}
                                            aria-pressed={active}
                                            onClick={() => {
                                                setDateStart(item.start);
                                                setDateEnd(item.end);
                                                setPage(1);
                                            }}
                                            className={`min-h-8 rounded-full border px-3 text-13 font-medium transition ${
                                                active
                                                    ? "border-primary-border bg-primary-soft text-primary-strong"
                                                    : "border-line-strong bg-surface text-muted hover:text-primary-strong"
                                            }`}
                                        >
                                            {item.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <Field label="开始">
                                <input
                                    type="date"
                                    value={dateStart}
                                    onChange={event => {
                                        setDateStart(event.target.value);
                                        setPage(1);
                                    }}
                                    className="w-full rounded-input border border-line-strong px-2.5 py-2 text-14"
                                />
                            </Field>
                            <Field label="结束">
                                <input
                                    type="date"
                                    value={dateEnd}
                                    onChange={event => {
                                        setDateEnd(event.target.value);
                                        setPage(1);
                                    }}
                                    className="w-full rounded-input border border-line-strong px-2.5 py-2 text-14"
                                />
                            </Field>
                            <div className="flex gap-2">
                                {dateFilterActive && (
                                    <Button variant="secondary" icon="reset" onClick={clearDates}>
                                        清除
                                    </Button>
                                )}
                                <Button
                                    className="flex-1"
                                    onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}
                                >
                                    完成筛选
                                </Button>
                            </div>
                        </div>
                    </details>
                    <button
                        type="button"
                        onClick={clearFilters}
                        disabled={!filtersActive}
                        className="min-h-10 px-1 text-14 font-medium text-muted transition hover:text-primary-strong disabled:cursor-not-allowed disabled:text-subtle disabled:hover:text-subtle"
                    >
                        清空条件
                    </button>
                    <div className="ml-auto">
                        <ToolbarMore>
                            <Button variant="secondary" icon="refresh" onClick={refresh}>
                                刷新
                            </Button>
                            <Button
                                variant="secondary"
                                icon="download"
                                onClick={() =>
                                    downloadCsv(
                                        "销售订单",
                                        [
                                            "销售订单号",
                                            "客户",
                                            "客户编码",
                                            "BOM 编码",
                                            "BOM 备注",
                                            "订单备注",
                                            "订单数量",
                                            "交货日期",
                                            "累计出库",
                                            "创建人",
                                            "创建时间",
                                            "状态",
                                        ],
                                        pageRows.map(order => [
                                            order.orderNo,
                                            order.customer,
                                            order.customerCode,
                                            order.bomCode,
                                            bomByCode(snap, order.bomCode)?.remark ?? "",
                                            order.remark,
                                            String(order.qty),
                                            order.deliverDate,
                                            String(order.outbound),
                                            order.createdBy,
                                            formatDateTime(order.createdAt),
                                            orderStatusOf(snap, order).label,
                                        ]),
                                    )
                                }
                            >
                                导出
                            </Button>
                        </ToolbarMore>
                    </div>
                </div>

                <div className="mobile-records">
                    <ListState loading={isLoading} empty={!pageRows.length}>
                        {pageRows.map(order => (
                            <OrderTaskCard
                                key={order.orderNo}
                                order={order}
                                snap={snap}
                                onDetail={() => setDetail(order)}
                            />
                        ))}
                    </ListState>
                </div>
                <div className="hidden lg:block">
                    {isLoading ? (
                        <PageLoading className="py-16" />
                    ) : (
                        <DataTable
                            tableId="orders"
                            defaultWidths={[154, 260, 397, 150, 100, 120, 140, 90, 150, 125, 100]}
                            recordCount={filtered.length}
                            identityColumn={0}
                            pinnedStart={[0, 1, 2, 3]}
                            scrollRef={tableScrollRef}
                        >
                            <thead>
                                <tr className="text-13 text-muted">
                                    <SortTh
                                        label="销售订单号"
                                        active={sort.key === "orderNo"}
                                        dir={sort.dir}
                                        onSort={() => applySort("orderNo")}
                                        className="cell-pad-wide"
                                        width="14%"
                                    />
                                    <th style={{ width: "14%" }}>客户 / 备注</th>
                                    <th style={{ width: "24%" }}>成品 / BOM</th>
                                    <th style={{ width: "12%" }}>BOM 备注</th>
                                    <SortTh
                                        label="订单数量"
                                        active={sort.key === "qty"}
                                        dir={sort.dir}
                                        onSort={() => applySort("qty")}
                                        width="8%"
                                    />
                                    <SortTh
                                        label="交货日期"
                                        active={sort.key === "deliverDate"}
                                        dir={sort.dir}
                                        onSort={() => applySort("deliverDate")}
                                        width="12%"
                                    />
                                    <SortTh
                                        label="交付情况"
                                        active={sort.key === "outbound"}
                                        dir={sort.dir}
                                        onSort={() => applySort("outbound")}
                                        width="12%"
                                    />
                                    <th style={{ width: "7%" }}>创建人</th>
                                    <SortTh
                                        label="创建时间"
                                        active={sort.key === "createdAt"}
                                        dir={sort.dir}
                                        onSort={() => applySort("createdAt")}
                                        width="10%"
                                    />
                                    <th style={{ width: "8%" }}>状态</th>
                                    <th className="min-w-28 cell-pad-wide text-center" style={{ width: "8%" }}>
                                        操作
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && <EmptyRow colSpan={11} description="没有找到匹配的订单" />}
                                {pageRows.map(order => {
                                    const bom = bomByCode(snap, order.bomCode);
                                    const status = orderStatusOf(snap, order);
                                    const remaining = remainingOf(order);
                                    const cancelled = order.lifecycleStatus === "cancelled";
                                    const done = !cancelled && remaining === 0;
                                    // 档案已删除的客户名不可点（快照里已无对应档案）
                                    const customer = snap.customers.find(item => item.code === order.customerCode);
                                    return (
                                        <tr key={order.orderNo}>
                                            <td className="cell-pad-wide">
                                                <button
                                                    type="button"
                                                    onClick={() => setDetail(order)}
                                                    className="tnum text-14 font-semibold text-td-strong underline-offset-2 hover:text-primary-strong hover:underline"
                                                >
                                                    {order.orderNo}
                                                </button>
                                            </td>
                                            <td>
                                                <CustomerCell
                                                    name={order.customer}
                                                    remark={order.remark}
                                                    onClick={
                                                        customer
                                                            ? () => setCustomerDetailCode(customer.code)
                                                            : undefined
                                                    }
                                                />
                                            </td>
                                            <td>
                                                <BomCell
                                                    categories={snap.bomCategories}
                                                    bom={bom}
                                                    bomCode={order.bomCode}
                                                />
                                            </td>
                                            <td>
                                                <RemarkCell remark={bom?.remark} variant="warning" />
                                            </td>
                                            <td>
                                                <QtyCell value={order.qty} />
                                            </td>
                                            <td>
                                                <DateCell
                                                    date={order.deliverDate}
                                                    overdue={order.deliverDate < todayIso() && remaining > 0}
                                                />
                                            </td>
                                            <td className="delivery-cell">
                                                {/* 已全部交付只留绿色满条（悬停 title 兜底语义），
                                                    未交付/已取消才展开文字明细 */}
                                                {cancelled ? (
                                                    <>
                                                        <div className="text-13 text-muted">已停止交付</div>
                                                        <div className="delivery-shipped tnum mt-0.5 text-12 text-muted">
                                                            已发 {num(order.outbound)} / {num(order.qty)}
                                                        </div>
                                                    </>
                                                ) : done ? (
                                                    <div className="delivery-track" title="已全部交付">
                                                        <ProgressTrack value={1} done />
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="text-13 text-muted">
                                                            待交 <QtyCell value={remaining} />
                                                        </div>
                                                        <div className="delivery-shipped tnum mt-0.5 text-12 text-muted">
                                                            已发 {num(order.outbound)} / {num(order.qty)}
                                                        </div>
                                                        <div className="delivery-track mt-1.5">
                                                            <ProgressTrack
                                                                value={order.qty === 0 ? 0 : order.outbound / order.qty}
                                                            />
                                                        </div>
                                                    </>
                                                )}
                                            </td>
                                            <td className="text-14 text-td">{order.createdBy}</td>
                                            <td className="tnum text-14 text-td">{formatDateTime(order.createdAt)}</td>
                                            <td>
                                                <StatusBadge status={status.key} label={status.label} />
                                            </td>
                                            <td className="min-w-28 cell-pad-wide text-center whitespace-nowrap">
                                                <TableLink onClick={() => setDetail(order)}>查看详情</TableLink>
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
                        unit="条订单"
                        onPageChange={setPage}
                        onPageSizeChange={size => {
                            setPageSize(size);
                            setPage(1);
                        }}
                    />
                </div>
            </section>

            {canCreate && newOpen && <NewOrderModal open onClose={() => setNewOpen(false)} />}
            {editing && (
                <EditOrderModal
                    key={editing.orderNo}
                    order={editing}
                    hasShipmentLedger={snap.outboundLedger.some(row => row.orderNo === editing.orderNo)}
                    onClose={() => setEditing(null)}
                />
            )}
            <OrderDetailModal
                order={detail ? (orders.find(order => order.orderNo === detail.orderNo) ?? null) : null}
                snap={snap}
                onClose={() => setDetail(null)}
                onEdit={
                    // 已取消订单本身不可改，但发过货的可归档、一件未发的可删除（均仅
                    // 超管），按终端动作放行入口；弹窗内表单对取消单全程只读
                    canEdit &&
                    detail &&
                    (detail.lifecycleStatus === "active" ||
                        (detail.lifecycleStatus === "cancelled" &&
                            ((detail.outbound > 0 && can("orders:archive")) ||
                                (detail.outbound === 0 && can("orders:delete")))))
                        ? () => setEditing(orders.find(order => order.orderNo === detail.orderNo) ?? detail)
                        : undefined
                }
                onShip={
                    canShip
                        ? () => {
                              setShip(detail!.orderNo);
                          }
                        : undefined
                }
            />
            <CustomerDetailModal
                customer={
                    customerDetailCode ? (snap.customers.find(item => item.code === customerDetailCode) ?? null) : null
                }
                snap={snap}
                onClose={() => setCustomerDetailCode(null)}
            />
            {ship !== null && <OutboundModal open initialOrderNo={ship} onClose={() => setShip(null)} />}
        </div>
    );
}

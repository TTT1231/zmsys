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
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { num } from "@/lib/format";
import { useApp } from "@/context/useApp";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { Badge, Button, ProgressTrack, StatusBadge, TableLink } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { CustomerCell, DateCell, QtyCell } from "@/components/ui/cells";
import { SortTh } from "@/components/ui/SortTh";
import { MobileSortSelect } from "@/components/ui/MobileSortSelect";
import {
    DndContext,
    PointerSensor,
    useDraggable,
    useSensor,
    useSensors,
    type DragMoveEvent,
    type DragStartEvent,
} from "@dnd-kit/core";
import { cycleSortState, type SortState } from "@/lib/tableSort";
import { mergeReordered, moveItem } from "@/lib/rowOrder";
import { Field, TextArea, TextField, DateField } from "@/components/ui/Field";
import {
    useArchiveOrder,
    useCreateOrder,
    useDeleteOrder,
    useUpdateOrder,
    useWbRefresh,
    useWbSnapshot,
} from "@/data/queries";
import {
    EMPTY_SNAPSHOT,
    bomByCode,
    deriveOrders,
    maxShipOf,
    orderStatusOfMax,
    remainingOf,
    stockOf,
    type DerivedOrders,
} from "@/data/views";
import { addDays, addMonths, formatDateTime, monthStartOf, shortDate, todayIso } from "@/lib/date";
import { focusFirstInvalid } from "@/lib/formFocus";
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
        if (Object.keys(nextErrors).length > 0) {
            focusFirstInvalid();
            return;
        }

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
    /* 已发货订单锁数量与交期（与后端口径一致），仅备注可改 */
    const locked = order.outbound > 0;
    const remarkDirty = remark !== order.remark;
    /* 可见出库单（含已作废但未删除）仍需先处理；已软删除的出库单不再阻止订单删除。 */
    const canDelete = can("orders:delete") && order.outbound === 0 && !hasShipmentLedger;
    /* 归档（仅超级管理员）：发过货的订单（已完成/部分发货）不要了直接归档结案；
     * 一件未发不归档，直接删除 */
    const canArchive = can("orders:archive") && order.outbound > 0;

    const submit = () => {
        const nextErrors: Record<string, string> = {};
        if (!locked) {
            if (!qty || Number(qty) <= 0) nextErrors.qty = "请填写订单数量";
            if (Number(qty) < order.outbound) nextErrors.qty = `新数量不能低于累计已发 ${order.outbound} 个`;
            if (!deliverDate) nextErrors.deliverDate = "请选择交货日期";
        }
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) {
            focusFirstInvalid();
            return;
        }
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
            },
        );
    };

    return (
        <Modal
            open={!!order}
            onClose={onClose}
            title="编辑销售订单"
            subtitle={`${order.orderNo} · ${order.customer}`}
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
                    <button
                        type="button"
                        disabled={updateOrder.isPending || (locked && !remarkDirty)}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-14 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        {updateOrder.isPending ? "正在提交…" : "保存修改"}
                    </button>
                </>
            }
        >
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
                    <TextArea label="订单备注" value={remark} onChange={event => setRemark(event.target.value)} />
                </div>
                {locked && (
                    <p className="text-13 text-subtle sm:col-span-2">
                        该订单累计已发 {order.outbound} 个，数量与交货日期不可修改，仅可修改备注。
                    </p>
                )}
                {canDelete && (
                    <p className="text-13 text-subtle sm:col-span-2">
                        该订单一件未发，可由超级管理员删除；删除前需二次确认。
                    </p>
                )}
            </div>
            {confirmDelete && (
                <Modal
                    open
                    onClose={() => setConfirmDelete(false)}
                    title="删除销售订单"
                    subtitle={`${order.orderNo} · ${order.customer}`}
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
            {confirmArchive && (
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
    derived,
    onClose,
    onShip,
    onEdit,
}: {
    order: Order | null;
    snap: Snapshot;
    /** 页面级一次分配结果（P2）：传入时弹窗复用预计算可发量/索引，不再单点全量派生 */
    derived?: DerivedOrders;
    onClose: () => void;
    onShip?: () => void;
    onEdit?: () => void;
}) {
    if (!order) return null;
    const bom = derived ? derived.bomIndex.get(order.bomCode) : bomByCode(snap, order.bomCode);
    const maxShip = derived ? (derived.byOrderNo.get(order.orderNo)?.maxShip ?? 0) : maxShipOf(snap, order.orderNo);
    const status = orderStatusOfMax(order, maxShip);
    const remaining = remainingOf(order);
    const shipments = snap.outboundLedger.filter(row => row.orderNo === order.orderNo);
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
                    {onShip && maxShip > 0 && (
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
                    note={order.lifecycleStatus === "archived" ? "订单已归档，仅供查询，不可修改。" : undefined}
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
                        ...(order.archivedAt
                            ? [
                                  { label: "归档人", value: order.archivedBy || "—" },
                                  { label: "归档时间", value: formatDateTime(order.archivedAt) },
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
    // 列排序默认升序：默认按订单号；仓管视角默认交货日期（按交期备货）。
    // 三态循环（升→降→取消）：点表头即按所选序重排一次；拖拽手动序会暂停当前排序，重新点表头才恢复
    const [sort, setSort] = useState<SortState<OrderSortKey> | null>(() => ({
        key: role === "warehouse" ? "deliverDate" : "orderNo",
        dir: "asc",
    }));
    // 手动行序（纯前端）：拖拽/键盘提交的完整序；提交时暂停当前排序，筛选、刷新、重新排序即作废
    const [manualOrder, setManualOrder] = useState<string[] | null>(null);
    // 拖拽态：拖拽中的订单号 + 插入线下标（相对 pageRows，"插到该行前"，n=追加到末尾）
    const [draggingNo, setDraggingNo] = useState<string | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    // 落地/键盘移动的确认高亮（500ms 瞬时装饰）：直接操作单元格类，不经组件状态——
    // 拖拽收尾的重渲染会整体重写 tr 的 className（抹掉手动类），但 td 的虚拟值未变
    // 不会触发属性重写，类挂在 td 上天然存活于 React 渲染之外
    const flashRow = (orderNo: string) => {
        const tr = rowRefs.current.get(orderNo);
        if (!tr) return;
        const cells = [...tr.children];
        cells.forEach(td => td.classList.remove("row-just-moved"));
        void tr.offsetWidth; // 强制 reflow 重启动画
        cells.forEach(td => td.classList.add("row-just-moved"));
        window.setTimeout(() => cells.forEach(td => td.classList.remove("row-just-moved")), 500);
    };
    // 深链 ?new=order 首帧即开弹窗（初始 state 直读）；effect 只负责清参数，不在副作用里开弹窗
    const [newOpen, setNewOpen] = useState(() => searchParams.get("new") === "order");
    const [ship, setShip] = useState<string | null>(null);
    const [taskFilter, setTaskFilter] = useState(searchParams.get("task") ?? (role === "warehouse" ? "ready" : "all"));
    const [detail, setDetail] = useState<Order | null>(null);
    const [editing, setEditing] = useState<Order | null>(null);
    // “客户/备注”列点客户名打开客户档案详情；存编码渲染时回捞，刷新后数据保持同步
    const [customerDetailCode, setCustomerDetailCode] = useState<string | null>(null);

    /* P2 一次分配：全部订单可发量/状态与 BOM 索引单次派生，统计、筛选与行组件共用；
     * 逾期随业务日期变化——today 不参与计算，仅作跨天后的缓存失效键 */
    const today = todayIso();
    const derived = useMemo(() => {
        void today;
        return deriveOrders(snap);
    }, [snap, today]);
    /* 归档单分流到「归档订单」页，销售订单页只展示活跃订单 */
    const orders = useMemo(() => snap.orders.filter(order => order.lifecycleStatus !== "archived"), [snap.orders]);
    const boms = snap.boms;
    const bomCategory = useMemo(() => new Map(boms.map(bom => [bom.code, bom.name])), [boms]);
    const categories = useMemo(() => [...new Set(boms.map(bom => bom.name))], [boms]);
    const counts = {
        total: orders.length,
        unfinished: orders.filter(order => remainingOf(order) > 0).length,
        ready: derived.rows.filter(row => row.maxShip > 0).length,
    };

    const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return orders.filter(order => {
            if (taskFilter === "pending" && remainingOf(order) <= 0) return false;
            // 可发量/状态读一次分配的预计算行；不在分配行内（已交满）按可发 0 判状态
            const row = derived.byOrderNo.get(order.orderNo);
            if (taskFilter === "ready" && (row?.maxShip ?? 0) <= 0) return false;
            if (statusFilter !== "全部状态" && (row?.status ?? orderStatusOfMax(order, 0)).label !== statusFilter)
                return false;
            if (categoryFilter !== "全部品类" && bomCategory.get(order.bomCode) !== categoryFilter) return false;
            if (dateStart && order.deliverDate < dateStart) return false;
            if (dateEnd && order.deliverDate > dateEnd) return false;
            if (kw) {
                const bom = derived.bomIndex.get(order.bomCode);
                const text =
                    `${order.orderNo} ${order.customer} ${order.customerCode} ${order.bomCode} ${bom?.spec}`.toLowerCase();
                if (!text.includes(kw)) return false;
            }
            return true;
        });
    }, [orders, keyword, taskFilter, statusFilter, categoryFilter, dateStart, dateEnd, derived, bomCategory]);

    const sorted = useMemo(() => {
        if (!sort) return filtered; // 取消排序：数据顺序，手动行序接管显示
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
    }, [filtered, sort]);

    // 手动行序生效（无排序时）：已记录的行按手动序，未记录的新行（新建订单）按数据序补尾
    const ordered = useMemo(() => {
        if (sort || !manualOrder) return sorted;
        const byNo = new Map(sorted.map(order => [order.orderNo, order]));
        const ranked = manualOrder.map(no => byNo.get(no)).filter(Boolean) as Order[];
        const rankedSet = new Set(ranked.map(order => order.orderNo));
        return [...ranked, ...sorted.filter(order => !rankedSet.has(order.orderNo))];
    }, [sorted, sort, manualOrder]);

    const pageRows = ordered.slice((page - 1) * pageSize, page * pageSize);
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
    /* 交期快捷区间：手机上免滚原生日期选择器（today 声明在派生 memo 处，两处共用） */
    const monthStart = monthStartOf(today);
    const quickRanges = [
        { label: "近 7 天", start: addDays(today, -6), end: today },
        { label: "近 30 天", start: addDays(today, -29), end: today },
        { label: "本月", start: monthStart, end: addDays(addMonths(monthStart, 1), -1) },
        { label: "下月", start: addMonths(monthStart, 1), end: addDays(addMonths(monthStart, 2), -1) },
    ];

    useEffect(() => {
        if (searchParams.get("new") === "order") setSearchParams({}, { replace: true });
    }, [searchParams, setSearchParams]);

    const applySort = (key: OrderSortKey) => {
        setSort(current => cycleSortState(current, key));
        setManualOrder(null); // 点表头排序即作废手动序（最后一次操作生效）
    };
    // 排序或翻页后行序变化，滚动区回到顶部，避免误以为排错行；
    // 拖拽/键盘移动暂停排序的那一次跳过回顶（落点行就在眼前），标记由 submitMove 置位
    const tableScrollRef = useRef<HTMLDivElement>(null);
    const skipScrollOnceRef = useRef(false);
    useEffect(() => {
        if (skipScrollOnceRef.current) {
            skipScrollOnceRef.current = false;
            return;
        }
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
    }, [page, sort]);

    /* ── 行拖拽手动排序（仅桌面表格，手机端卡片不参与）──
       line 派落点指示：行全程不动，目标行上/下缘 2px 主色插入线，松手才一次落位；
       dnd-kit 只做指针层（激活阈值 4px 区分手柄点击与拖拽），不用 sortable 腾位 */
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
    const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
    // 把 pageRows[from] 移到 insertBefore（"插到该下标行之前"，n=末尾），合流提交完整序；
    // 有排序时提交即暂停排序（最后一次操作生效：拖动只改变顺序，排序不再参与，点表头才恢复）
    const submitMove = (from: number, insertBefore: number) => {
        if (insertBefore === from || insertBefore === from + 1) return false;
        const visibleNos = pageRows.map(order => order.orderNo);
        const nextVisible = moveItem(visibleNos, from, insertBefore > from ? insertBefore - 1 : insertBefore);
        // 仅在排序真被暂停的这次置位，否则排序为 null 时 setSort 是空操作，标记会残留误跳下一次回顶
        if (sort) skipScrollOnceRef.current = true;
        setSort(null);
        setManualOrder(
            mergeReordered(
                ordered.map(order => order.orderNo),
                visibleNos,
                nextVisible,
            ),
        );
        return true;
    };
    // 插入线落点：以浮层（精简行快照）几何中心越过目标行边缘判定（指针触发发糊、边缘最稳）
    const onDragStart = (event: DragStartEvent) => {
        const no = event.active.id as string;
        const el = rowRefs.current.get(no);
        if (el) {
            const rect = el.getBoundingClientRect();
            dragGhostRef.current = {
                baseTop: rect.top,
                height: rect.height,
                left: rect.left,
                centerY: rect.top + rect.height / 2,
            };
            setGhostTop(rect.top);
            setGhostLeft(rect.left);
        }
        setDraggingNo(no);
    };
    /* 浮层几何自管理：DragOverlay 在 React 19 下不挂载（translated rect 恒 null），
       改用 dnd-kit 的 delta 坐标自绘精简浮层，插入线以浮层中心越行缘判定 */
    const dragGhostRef = useRef<{ baseTop: number; height: number; left: number; centerY: number } | null>(null);
    // 浮层渲染位置走 state（渲染期不读 ref）：left 拖拽中不变，top 逐帧跟随
    const [ghostTop, setGhostTop] = useState(0);
    const [ghostLeft, setGhostLeft] = useState(0);
    const computeDrop = (centerY: number) => {
        let index = pageRows.length;
        for (let i = 0; i < pageRows.length; i++) {
            const el = rowRefs.current.get(pageRows[i].orderNo);
            if (!el) continue;
            const rowRect = el.getBoundingClientRect();
            if (centerY < rowRect.bottom) {
                index = centerY > rowRect.top + rowRect.height / 2 ? i + 1 : i;
                break;
            }
        }
        setDropIndex(current => (current === index ? current : index));
    };
    // 边缘自动滚动的 rAF effect 只挂 draggingNo：拖拽中逐帧重渲染，不能把随帧变化的
    // computeDrop 拖进依赖重启循环，经 ref 取最新闭包
    const computeDropRef = useRef(computeDrop);
    useEffect(() => {
        computeDropRef.current = computeDrop;
    });
    const onDragMove = (event: DragMoveEvent) => {
        const ghost = dragGhostRef.current;
        if (!ghost) return;
        const top = Math.min(window.innerHeight - ghost.height - 12, Math.max(8, ghost.baseTop + event.delta.y));
        ghost.centerY = top + ghost.height / 2;
        setGhostTop(current => (current === top ? current : top));
        computeDrop(ghost.centerY);
    };
    const resetDrag = () => {
        setDraggingNo(null);
        setDropIndex(null);
        dragGhostRef.current = null;
    };
    const onDragEnd = () => {
        const from = draggingNo ? pageRows.findIndex(order => order.orderNo === draggingNo) : -1;
        const moved = from >= 0 && dropIndex !== null && submitMove(from, dropIndex);
        const landedNo = draggingNo;
        resetDrag();
        if (moved) {
            flashRow(landedNo!);
        }
    };
    const onDragCancel = () => {
        resetDrag();
    };
    // 插入线渲染目标（拖拽中才有）：dropIndex 指向行画上缘线，越界则末行画下缘线
    const dropLineAbove =
        draggingNo && dropIndex !== null && dropIndex < pageRows.length ? pageRows[dropIndex]?.orderNo : null;
    const dropLineBelow = draggingNo && dropIndex === pageRows.length ? pageRows[pageRows.length - 1]?.orderNo : null;
    // 键盘微调（无障碍）：手柄聚焦后 ↑/↓ 换行，与拖拽共用同一提交路径
    const onHandleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, orderNo: string) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const from = pageRows.findIndex(order => order.orderNo === orderNo);
        if (from < 0) return;
        const insertBefore = event.key === "ArrowUp" ? from - 1 : from + 2;
        if (insertBefore < 0 || insertBefore > pageRows.length) return;
        if (submitMove(from, insertBefore)) {
            flashRow(orderNo);
        }
    };
    // 拖到表格滚动区上下边缘时自动滚动：行屏幕位置随滚动变化，每帧重算插入线，
    // 否则占位指示漂出视口与浮层脱钩（速度按深入感应区比例分档）
    useEffect(() => {
        if (!draggingNo) return;
        let raf = 0;
        const tick = () => {
            const scroller = tableScrollRef.current;
            const ghost = dragGhostRef.current;
            if (scroller && ghost) {
                const rect = scroller.getBoundingClientRect();
                const EDGE = 72;
                const MAX = 16;
                let depth = 0;
                let dir = 0;
                if (ghost.centerY < rect.top + EDGE) {
                    depth = (rect.top + EDGE - ghost.centerY) / EDGE;
                    dir = -1;
                } else if (ghost.centerY > rect.bottom - EDGE) {
                    depth = (ghost.centerY - (rect.bottom - EDGE)) / EDGE;
                    dir = 1;
                }
                if (depth > 0) {
                    scroller.scrollTop += dir * Math.max(2, MAX * Math.min(1, depth));
                    computeDropRef.current(ghost.centerY);
                }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [draggingNo]);

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
                                    setManualOrder(null);
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
                            setManualOrder(null);
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
                            setManualOrder(null);
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
                    <MobileSortSelect
                        columns={ORDER_SORT_COLUMNS}
                        value={sort}
                        onChange={next => {
                            setSort(next);
                            setManualOrder(null); // 与桌面表头一致：重新选择排序（含回到默认顺序）即作废手动序
                        }}
                        noneLabel="默认顺序"
                    />
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
                                                setManualOrder(null);
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
                                        setManualOrder(null);
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
                                        setManualOrder(null);
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
                            <Button
                                variant="secondary"
                                icon="refresh"
                                onClick={() => {
                                    setManualOrder(null); // 刷新即回到后端返回顺序（手动序不保存）
                                    refresh();
                                }}
                            >
                                刷新
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
                                derived={derived}
                                onDetail={() => setDetail(order)}
                            />
                        ))}
                    </ListState>
                </div>
                <div className="hidden lg:block">
                    {isLoading ? (
                        <PageLoading className="py-16" />
                    ) : (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={() => []}
                            onDragStart={onDragStart}
                            onDragMove={onDragMove}
                            onDragEnd={onDragEnd}
                            onDragCancel={onDragCancel}
                        >
                            <DataTable
                                tableId="orders"
                                defaultWidths={[44, 154, 260, 397, 150, 100, 100, 120, 140, 90, 150, 125, 100]}
                                recordCount={filtered.length}
                                identityColumn={1}
                                pinnedStart={[0, 1, 2, 3, 4]}
                                scrollRef={tableScrollRef}
                            >
                                <thead>
                                    <tr className="text-13 text-muted">
                                        {/* 拖拽手柄列：sr-only 文本供 DataTable 提取稳定列标识 */}
                                        <th aria-label="拖拽调整顺序" className="drag-col">
                                            <span className="sr-only">拖拽调整顺序</span>
                                        </th>
                                        <SortTh
                                            label="销售订单号"
                                            active={sort?.key === "orderNo"}
                                            dir={sort?.dir ?? "asc"}
                                            onSort={() => applySort("orderNo")}
                                            className="cell-pad-wide"
                                            width="14%"
                                        />
                                        <th style={{ width: "14%" }}>客户 / 备注</th>
                                        <th style={{ width: "24%" }}>成品 / BOM</th>
                                        <th style={{ width: "12%" }}>BOM 备注</th>
                                        <SortTh
                                            label="订单数量"
                                            active={sort?.key === "qty"}
                                            dir={sort?.dir ?? "asc"}
                                            onSort={() => applySort("qty")}
                                            width="8%"
                                        />
                                        <th style={{ width: "8%" }}>库存数量</th>
                                        <SortTh
                                            label="交货日期"
                                            active={sort?.key === "deliverDate"}
                                            dir={sort?.dir ?? "asc"}
                                            onSort={() => applySort("deliverDate")}
                                            width="12%"
                                        />
                                        <SortTh
                                            label="交付情况"
                                            active={sort?.key === "outbound"}
                                            dir={sort?.dir ?? "asc"}
                                            onSort={() => applySort("outbound")}
                                            width="12%"
                                        />
                                        <th style={{ width: "7%" }}>创建人</th>
                                        <SortTh
                                            label="创建时间"
                                            active={sort?.key === "createdAt"}
                                            dir={sort?.dir ?? "asc"}
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
                                    {pageRows.length === 0 && (
                                        <EmptyRow colSpan={13} description="没有找到匹配的订单" />
                                    )}
                                    {pageRows.map(order => {
                                        const bom = derived.bomIndex.get(order.bomCode);
                                        const status =
                                            derived.byOrderNo.get(order.orderNo)?.status ?? orderStatusOfMax(order, 0);
                                        const remaining = remainingOf(order);
                                        const done = remaining === 0;
                                        // 库存列三档字色：0 即缺货；盖不住本单剩余待交为不足；其余充裕
                                        const stock = stockOf(snap, order.bomCode);
                                        const stockTone =
                                            stock === 0 ? "danger" : stock < remaining ? "warning" : "success";
                                        // 档案已删除的客户名不可点（快照里已无对应档案）
                                        const customer = snap.customers.find(item => item.code === order.customerCode);
                                        return (
                                            <tr
                                                key={order.orderNo}
                                                ref={el => {
                                                    if (el) rowRefs.current.set(order.orderNo, el);
                                                    else rowRefs.current.delete(order.orderNo);
                                                }}
                                                className={`${draggingNo === order.orderNo ? "row-drag-source" : ""} ${
                                                    dropLineAbove === order.orderNo ? "row-drop-above" : ""
                                                }${dropLineBelow === order.orderNo ? "row-drop-below" : ""}`}
                                            >
                                                <td className="drag-col">
                                                    <RowDragHandle
                                                        orderNo={order.orderNo}
                                                        sortLabel={
                                                            sort
                                                                ? ORDER_SORT_COLUMNS.find(col => col.key === sort.key)
                                                                      ?.label
                                                                : undefined
                                                        }
                                                        onArrowKey={onHandleKeyDown}
                                                    />
                                                </td>
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
                                                    <QtyCell value={stock} tone={stockTone} />
                                                </td>
                                                <td>
                                                    <DateCell
                                                        date={order.deliverDate}
                                                        overdue={order.deliverDate < todayIso() && remaining > 0}
                                                    />
                                                </td>
                                                <td className="delivery-cell">
                                                    {/* 已全部交付只留绿色满条（悬停 title 兜底语义），
                                                    未交付才展开文字明细 */}
                                                    {done ? (
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
                                                                    value={
                                                                        order.qty === 0 ? 0 : order.outbound / order.qty
                                                                    }
                                                                />
                                                            </div>
                                                        </>
                                                    )}
                                                </td>
                                                <td className="text-14 text-td">{order.createdBy}</td>
                                                <td className="tnum text-14 text-td">
                                                    {formatDateTime(order.createdAt)}
                                                </td>
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
                            {draggingNo
                                ? (() => {
                                      const order = pageRows.find(item => item.orderNo === draggingNo);
                                      return order ? (
                                          <DragGhost order={order} style={{ top: ghostTop, left: ghostLeft }} />
                                      ) : null;
                                  })()
                                : null}
                        </DndContext>
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
                derived={derived}
                onClose={() => setDetail(null)}
                onEdit={
                    canEdit && detail?.lifecycleStatus === "active"
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

/* 行拖拽手柄：dnd-kit 指针层挂在此按钮（listeners 只挂手柄，避免与行内链接/文本选择冲突）；
   有排序时也可拖——拖动即暂停该排序（最后一次操作生效），键盘 ↑/↓ 微调同一入口 */
function RowDragHandle({
    orderNo,
    sortLabel,
    onArrowKey,
}: {
    orderNo: string;
    sortLabel?: string;
    onArrowKey: (event: ReactKeyboardEvent<HTMLButtonElement>, orderNo: string) => void;
}) {
    const { attributes, listeners } = useDraggable({ id: orderNo });
    return (
        <button
            type="button"
            className="row-drag-handle"
            title={
                sortLabel
                    ? `当前按「${sortLabel}」排序，拖拽调整将暂停该排序，点击表头可重新排序`
                    : "拖拽调整顺序：仅改变当前视图显示，刷新或重新排序后恢复"
            }
            aria-label={`拖拽调整 ${orderNo} 的显示顺序，聚焦后可用上下方向键移动`}
            onKeyDown={event => onArrowKey(event, orderNo)}
            {...attributes}
            {...listeners}
        >
            <Icon name="grip" size={14} />
        </button>
    );
}

/* 拖拽浮层：精简行快照（手柄/订单号/客户，宽度对齐表格前三列）+ 跟随操作提示。
   宽表整行快照会遮住大半视线，Atlassian 同款只留关键信息 */
function DragGhost({ order, style }: { order: Order; style?: CSSProperties }) {
    return (
        <div className="drag-ghost" style={{ position: "fixed", zIndex: 200, pointerEvents: "none", ...style }}>
            <div className="flex items-center">
                <div className="flex w-11 shrink-0 justify-center text-muted">
                    <Icon name="grip" size={14} />
                </div>
                <div
                    className="tnum shrink-0 truncate px-1 text-14 font-semibold whitespace-nowrap text-td-strong"
                    style={{ width: 154 }}
                >
                    {order.orderNo}
                </div>
                <div className="truncate pr-3 text-14 font-medium whitespace-nowrap text-ink" style={{ width: 260 }}>
                    {order.customer}
                </div>
            </div>
            <span className="drag-ghost-hint">松手放置 · Esc 取消</span>
        </div>
    );
}

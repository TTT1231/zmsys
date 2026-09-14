import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { SearchSelect } from "@/components/ui/SearchSelect";
import { ListState, OrderTaskCard } from "@/components/ui/MobileList";
import { EmptyState } from "@/components/ui/EmptyState";
import { BomCell } from "@/components/bom/BomCell";
import { RecordFields, RecordProduct, RecordSummary } from "@/components/business/RecordDetails";
import { OutboundModal } from "@/pages/outbound/OutboundPage";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { downloadCsv, num } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { PageHeading } from "@/components/ui/PageHeading";
import { Badge, Button, ProgressTrack, StatusBadge, TableLink } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { CustomerCell, DateCell, QtyCell } from "@/components/ui/cells";
import { SortTh } from "@/components/ui/SortTh";
import { MobileSortSelect } from "@/components/ui/MobileSortSelect";
import { nextSortState, type SortState } from "@/lib/tableSort";
import { Field, SelectField, TextArea, TextField, DateField } from "@/components/ui/Field";
import { useCreateOrder, useUpdateOrder, useWbRefresh, useWbSnapshot } from "@/data/queries";
import { EMPTY_SNAPSHOT, bomByCode, maxShipOf, orderStatusOf, remainingOf } from "@/data/views";
import { addDays, addMonths, todayIso } from "@/lib/date";
import { useToast } from "@/components/ui/Toast";
import { LoadingOverlay, useDelayedFlag } from "@/components/ui/LoadingOverlay";
import { PageLoading } from "@/components/ui/PageLoading";
import type { Order, Snapshot } from "@/api";
import { categoryOf } from "@/data/categories";
import { bomSelectorOptionLabel, buildBomSelectorSchema, resolveBomSelection } from "@/data/bomSelection";

const STATUS_OPTIONS = ["全部状态", "待备货", "可发货", "部分发货", "已完成", "已取消", "部分发货后取消"];
const EMPTY_BOMS: Snapshot["boms"] = [];
const EMPTY_CUSTOMERS: Snapshot["customers"] = [];

/* 可排序列：订单号 / 数量 / 交期 / 交付情况（按累计已发对比）；桌面表头与移动端排序下拉共用 */
type OrderSortKey = "orderNo" | "qty" | "deliverDate" | "outbound";
const ORDER_SORT_COLUMNS: Array<{ key: OrderSortKey; label: string }> = [
    { key: "orderNo", label: "销售订单号" },
    { key: "qty", label: "订单数量" },
    { key: "deliverDate", label: "交货日期" },
    { key: "outbound", label: "交付情况" },
];

/* 交期筛选激活时在按钮上回显的简写日期（MM/DD） */
const shortDate = (isoDate: string) => `${isoDate.slice(5, 7)}/${isoDate.slice(8, 10)}`;

/* 新建销售订单弹窗（三步表单：客户与交付 → BOM 编码 → 备注） */
function NewOrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { data } = useWbSnapshot();
    const createOrder = useCreateOrder();
    const toast = useToast();
    const customers = data?.customers ?? EMPTY_CUSTOMERS;
    const boms = data?.boms ?? EMPTY_BOMS;

    const [customerCode, setCustomerCode] = useState("");
    const [qty, setQty] = useState("");
    const [orderDate, setOrderDate] = useState(todayIso);
    const [deliverDate, setDeliverDate] = useState("");
    const [category, setCategory] = useState("");
    const [bomSelections, setBomSelections] = useState<Record<string, string>>({});
    const [remark, setRemark] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});

    const customerOptions = useMemo(
        () =>
            customers.map(customer => ({
                value: customer.code,
                label: `${customer.name}（${customer.code}）`,
            })),
        [customers],
    );
    const categories = useMemo(() => [...new Set(boms.map(bom => bom.name))], [boms]);
    const categoryBoms = useMemo(() => (category ? boms.filter(bom => bom.name === category) : []), [boms, category]);
    const selectorSchema = useMemo(
        () =>
            buildBomSelectorSchema(
                categoryBoms,
                categoryOf(category)?.fields.map(field => field.key),
            ),
        [categoryBoms, category],
    );
    const resolution = useMemo(
        () => resolveBomSelection(categoryBoms, selectorSchema.fields, bomSelections),
        [categoryBoms, selectorSchema.fields, bomSelections],
    );
    const selectedBom =
        !resolution.pending && resolution.candidates.length === 1 ? resolution.candidates[0] : undefined;

    const pickCategory = (nextCategory: string) => {
        setCategory(nextCategory);
        setBomSelections({});
        setErrors(current => ({ ...current, category: "", bom: "" }));
    };

    const pickBomDimension = (fieldId: string, value: string) => {
        const fieldIndex = selectorSchema.fields.findIndex(field => field.id === fieldId);
        setBomSelections(current => {
            const next: Record<string, string> = {};
            selectorSchema.fields.slice(0, fieldIndex).forEach(field => {
                if (current[field.id]) next[field.id] = current[field.id];
            });
            if (value) next[fieldId] = value;
            return next;
        });
        setErrors(current => ({ ...current, bom: "" }));
    };

    const reset = () => {
        setCustomerCode("");
        setQty("");
        setOrderDate(todayIso());
        setDeliverDate("");
        setCategory("");
        setBomSelections({});
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
        if (!category) nextErrors.category = "请选择 BOM 品类";
        else if (!selectedBom) nextErrors.bom = "请完成规格选择";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length)
            requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus(),
            );
        if (Object.keys(nextErrors).length > 0) return;

        createOrder.mutate(
            {
                customerCode,
                bomCode: selectedBom!.code,
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
            subtitle="按品类与部件组合定位 BOM，无需滚动长清单"
            width={640}
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
                        disabled={createOrder.isPending}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-13 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        {createOrder.isPending ? "正在提交…" : "提交订单"}
                    </button>
                </>
            }
        >
            <div className="flex flex-col gap-5">
                <fieldset className="rounded-panel border border-line p-4">
                    <legend className="px-1.5 text-12.5 font-semibold text-primary">① 客户与交付</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <SearchSelect
                            label="客户"
                            required
                            error={errors.customerCode}
                            value={customerCode}
                            onChange={setCustomerCode}
                            options={customerOptions}
                        />
                        <TextField
                            label="订单数量（件）"
                            required
                            inputMode="numeric"
                            placeholder="如 2400"
                            error={errors.qty}
                            value={qty}
                            onChange={event => setQty(event.target.value.replace(/\D/g, ""))}
                        />
                        <DateField
                            label="下单日期"
                            error={errors.orderDate}
                            required
                            value={orderDate}
                            onChange={event => setOrderDate(event.target.value)}
                        />
                        <DateField
                            label="交货日期"
                            required
                            error={errors.deliverDate}
                            value={deliverDate}
                            onChange={event => setDeliverDate(event.target.value)}
                        />
                    </div>
                </fieldset>

                <fieldset className="rounded-panel border border-line p-4">
                    <legend className="px-1.5 text-12.5 font-semibold text-primary">② 选择 BOM</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <SelectField
                            label="品类"
                            required
                            error={errors.category}
                            value={category}
                            onChange={event => pickCategory(event.target.value)}
                        >
                            <option value="">请选择品类</option>
                            {categories.map(item => (
                                <option key={item} value={item}>
                                    {item}
                                </option>
                            ))}
                        </SelectField>

                        {resolution.steps.map((step, index) => (
                            <SelectField
                                key={step.field.id}
                                label={step.field.label}
                                required
                                error={index === resolution.steps.length - 1 ? errors.bom : undefined}
                                value={bomSelections[step.field.id] ?? ""}
                                onChange={event => pickBomDimension(step.field.id, event.target.value)}
                            >
                                <option value="">请选择{step.field.label}</option>
                                {step.options.map(option => (
                                    <option key={option} value={option}>
                                        {bomSelectorOptionLabel(option)}
                                    </option>
                                ))}
                            </SelectField>
                        ))}

                        {category && selectorSchema.fixedSpecs.length > 0 && (
                            <div className="rounded-btn border border-line bg-panel px-3 py-2.5 sm:col-span-2">
                                <p className="text-11.5 font-semibold text-td">固定规格（无需选择）</p>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {selectorSchema.fixedSpecs.map(item => (
                                        <span
                                            key={item.key}
                                            className="rounded-md bg-white px-2 py-1 text-11.5 text-muted shadow-xs"
                                        >
                                            {item.key}：{item.value}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {category && !selectedBom && categoryBoms.length > 0 && (
                            <p className="text-12 text-muted sm:col-span-2" aria-live="polite">
                                当前匹配 {num(resolution.candidates.length)} 条 BOM，继续选择下一项即可自动定位。
                            </p>
                        )}
                        {errors.bom && resolution.steps.length === 0 && (
                            <p role="alert" className="text-12 text-danger sm:col-span-2">
                                {errors.bom}
                            </p>
                        )}
                        {selectedBom && (
                            <div
                                className="rounded-btn border border-primary-border bg-primary-soft/70 px-3.5 py-3 sm:col-span-2"
                                aria-live="polite"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="tnum text-14 font-semibold text-primary-strong">
                                        {selectedBom.code}
                                    </span>
                                    <span className="rounded-full bg-white px-2 py-1 text-11 font-medium text-success">
                                        已匹配
                                    </span>
                                </div>
                                <p className="mt-1 text-12.5 text-td">
                                    {selectedBom.name} · {selectedBom.modelCode}
                                </p>
                                <p className="mt-1 break-words text-11.5 text-muted">{selectedBom.spec}</p>
                            </div>
                        )}
                    </div>
                </fieldset>

                <fieldset className="rounded-panel border border-line p-4">
                    <legend className="px-1.5 text-12.5 font-semibold text-primary">③ 订单备注</legend>
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

/* 编辑销售订单弹窗（订单不可删除；新数量不能低于累计已发） */
function EditOrderModal({ order, onClose }: { order: Order; onClose: () => void }) {
    const updateOrder = useUpdateOrder();
    const toast = useToast();
    const [qty, setQty] = useState(String(order.qty));
    const [deliverDate, setDeliverDate] = useState(order.deliverDate);
    const [remark, setRemark] = useState(order.remark);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const submit = () => {
        if (!order) return;
        const nextErrors: Record<string, string> = {};
        if (!qty || Number(qty) <= 0) nextErrors.qty = "请填写订单数量";
        if (Number(qty) < order.outbound) nextErrors.qty = `新数量不能低于累计已发 ${order.outbound} 件`;
        if (!deliverDate) nextErrors.deliverDate = "请选择交货日期";
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
                qty: Number(qty),
                deliverDate,
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

    return (
        <Modal
            open={!!order}
            onClose={onClose}
            title="编辑销售订单"
            subtitle={order ? `${order.orderNo} · ${order.customer}` : ""}
            width={520}
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
                        disabled={updateOrder.isPending}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-13 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        保存修改
                    </button>
                </>
            }
        >
            {order && (
                <div className="grid gap-3 sm:grid-cols-2">
                    <TextField
                        label="订单数量（件）"
                        required
                        inputMode="numeric"
                        value={qty}
                        error={errors.qty}
                        onChange={event => setQty(event.target.value.replace(/\D/g, ""))}
                    />
                    <DateField
                        label="交货日期"
                        required
                        error={errors.deliverDate}
                        value={deliverDate}
                        onChange={event => setDeliverDate(event.target.value)}
                    />
                    <div className="sm:col-span-2">
                        <TextArea label="订单备注" value={remark} onChange={event => setRemark(event.target.value)} />
                    </div>
                    {order.outbound > 0 && (
                        <p className="text-12 text-subtle sm:col-span-2">
                            该订单累计已发 {order.outbound} 件，新数量不能低于此值。
                        </p>
                    )}
                </div>
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
}: {
    order: Order | null;
    snap: Snapshot;
    onClose: () => void;
    onShip?: () => void;
}) {
    if (!order) return null;
    const bom = bomByCode(snap, order.bomCode);
    const status = orderStatusOf(snap, order);
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
            footer={
                <>
                    {onShip && maxShipOf(snap, order.orderNo) > 0 && (
                        <Button icon="truck" onClick={onShip}>
                            登记发货
                        </Button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="min-h-10 rounded-btn bg-primary px-4 text-13 font-medium text-white hover:bg-primary-hover"
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
                    note={order.lifecycleStatus === "cancelled" ? "订单已取消，剩余数量不再安排交付。" : undefined}
                />
                <RecordProduct bom={bom} bomCode={order.bomCode} categories={snap.bomCategories} />
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
                        { label: "订单备注", value: order.remark || "—", fullWidth: true },
                        ...(order.lifecycleStatus === "cancelled"
                            ? [{ label: "取消原因", value: order.cancelReason || "—", fullWidth: true }]
                            : []),
                    ]}
                />
                <details className="border-t border-line pt-2" open={shipments.length > 0}>
                    <summary className="min-h-11 cursor-pointer py-3 text-14 font-medium text-ink">
                        发货记录（{shipments.length}）
                    </summary>
                    <div className="mt-1 flex flex-col gap-2">
                        {shipments.length === 0 && <p className="text-12 text-subtle">暂无发货记录。</p>}
                        {shipments.map(row => (
                            <div
                                key={row.no}
                                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-input bg-soft p-3 text-13"
                            >
                                <span className="tnum text-ink wrap-anywhere">{row.no}</span>
                                <QtyCell value={row.qty} unit="件" />
                                <span className="text-12 leading-5 text-muted wrap-anywhere">
                                    {row.date} · {row.operator}
                                </span>
                                <Badge tone={row.state === "voided" ? "danger" : "progress"}>
                                    {row.state === "voided" ? "已作废" : row.state === "printed" ? "已打印" : "已登记"}
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
    const [newOpen, setNewOpen] = useState(false);
    const [ship, setShip] = useState<string | null>(null);
    const [taskFilter, setTaskFilter] = useState(searchParams.get("task") ?? (role === "warehouse" ? "ready" : "all"));
    const [detail, setDetail] = useState<Order | null>(null);
    const [editing, setEditing] = useState<Order | null>(null);

    const orders = snap.orders;
    const boms = snap.boms;
    const bomCategory = new Map(boms.map(bom => [bom.code, bom.name]));
    const categories = [...new Set(boms.map(bom => bom.name))];
    const counts = {
        total: orders.length,
        unfinished: orders.filter(order => order.qty - order.outbound > 0).length,
        ready: orders.filter(order => maxShipOf(snap, order.orderNo) > 0).length,
    };

    const filtered = (() => {
        const kw = keyword.trim().toLowerCase();
        const rows = orders.filter(order => {
            if (taskFilter === "pending" && order.qty <= order.outbound) return false;
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
        if (searchParams.get("new") === "order") {
            setNewOpen(true);
            setSearchParams({}, { replace: true });
        }
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
            <PageHeading
                title={role === "warehouse" ? "待发货订单" : "销售订单"}
                actions={
                    canCreate ? (
                        <Button icon="plus" onClick={() => setNewOpen(true)}>
                            新建订单
                        </Button>
                    ) : undefined
                }
            />

            <div className="task-tabs" aria-label="订单快捷筛选">
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

            <section className="relative overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
                {overlay && <LoadingOverlay />}
                <div className="list-toolbar flex flex-wrap items-center border-b border-line bg-gradient-to-b from-white to-panel px-5 py-4 lg:gap-2.5">
                    {/* 搜索最左：窄屏由 list-toolbar 规则独占整行，宽屏固定 280px */}
                    <label className="flex h-10 items-center gap-2 rounded-btn border border-line-strong bg-white px-3 lg:w-70">
                        <Icon name="search" size={15} className="text-subtle" />
                        <input
                            value={keyword}
                            onChange={event => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                            placeholder="搜索客户、订单或产品"
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
                        className="h-10 rounded-btn border border-line-strong bg-white px-3 text-13 text-ink"
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
                        className="h-10 rounded-btn border border-line-strong bg-white px-3 text-13 text-ink"
                    >
                        <option>全部品类</option>
                        {categories.map(item => (
                            <option key={item}>{item}</option>
                        ))}
                    </select>
                    <MobileSortSelect columns={ORDER_SORT_COLUMNS} value={sort} onChange={setSort} />
                    <details className="relative">
                        <summary
                            className={`flex h-10 list-none items-center gap-1.5 rounded-btn px-3 text-13 transition ${
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
                        <div className="absolute top-12 right-0 z-50 grid w-75 grid-cols-1 gap-2 rounded-xl border border-line bg-white p-3 shadow-modal max-lg:fixed max-lg:inset-x-0 max-lg:top-auto max-lg:bottom-0 max-lg:left-0 max-lg:w-auto max-lg:gap-3 max-lg:rounded-b-none max-lg:rounded-t-[22px] max-lg:border-x-0 max-lg:border-b-0 max-lg:p-4 max-lg:pb-[max(16px,env(safe-area-inset-bottom))]">
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
                                            className={`min-h-8 rounded-full border px-3 text-12.5 font-medium transition ${
                                                active
                                                    ? "border-primary-border bg-primary-soft text-primary-strong"
                                                    : "border-line-strong bg-white text-muted hover:text-primary-strong"
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
                                    className="w-full rounded-input border border-line-strong px-2.5 py-2 text-13"
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
                                    className="w-full rounded-input border border-line-strong px-2.5 py-2 text-13"
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
                        className="min-h-10 px-1 text-13 font-medium text-muted transition hover:text-primary-strong disabled:cursor-not-allowed disabled:text-subtle disabled:hover:text-subtle"
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
                                            "订单数量",
                                            "交货日期",
                                            "累计出库",
                                            "状态",
                                        ],
                                        pageRows.map(order => [
                                            order.orderNo,
                                            order.customer,
                                            order.customerCode,
                                            order.bomCode,
                                            String(order.qty),
                                            order.deliverDate,
                                            String(order.outbound),
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
                                onEdit={canEdit ? () => setEditing(order) : undefined}
                                onShip={canShip ? () => setShip(order.orderNo) : undefined}
                            />
                        ))}
                    </ListState>
                </div>
                <div
                    ref={tableScrollRef}
                    className="hidden overflow-auto lg:block lg:max-h-[calc(100dvh-26rem)] lg:min-h-[18.75rem]"
                >
                    {isLoading ? (
                        <PageLoading className="py-16" />
                    ) : (
                        <table className="data-table w-full min-w-245 border-collapse">
                            <thead>
                                <tr className="text-12 text-muted">
                                    <SortTh
                                        label="销售订单号"
                                        active={sort.key === "orderNo"}
                                        dir={sort.dir}
                                        onSort={() => applySort("orderNo")}
                                        className="px-5"
                                        width="14%"
                                    />
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "16%" }}>
                                        客户
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "22%" }}>
                                        成品 / BOM
                                    </th>
                                    <SortTh
                                        label="订单数量"
                                        align="right"
                                        active={sort.key === "qty"}
                                        dir={sort.dir}
                                        onSort={() => applySort("qty")}
                                        className="px-3"
                                        width="8%"
                                    />
                                    <SortTh
                                        label="交货日期"
                                        active={sort.key === "deliverDate"}
                                        dir={sort.dir}
                                        onSort={() => applySort("deliverDate")}
                                        className="px-3"
                                        width="12%"
                                    />
                                    <SortTh
                                        label="交付情况"
                                        active={sort.key === "outbound"}
                                        dir={sort.dir}
                                        onSort={() => applySort("outbound")}
                                        className="px-3"
                                        width="12%"
                                    />
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "8%" }}>
                                        状态
                                    </th>
                                    <th
                                        className="min-w-28 px-5 py-2.5 text-right font-semibold"
                                        style={{ width: "8%" }}
                                    >
                                        操作
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="px-5 py-10 text-center">
                                            <EmptyState description="没有找到匹配的订单" />
                                        </td>
                                    </tr>
                                )}
                                {pageRows.map(order => {
                                    const bom = bomByCode(snap, order.bomCode);
                                    const status = orderStatusOf(snap, order);
                                    const remaining = remainingOf(order);
                                    const cancelled = order.lifecycleStatus === "cancelled";
                                    const done = !cancelled && remaining === 0;
                                    return (
                                        <tr
                                            key={order.orderNo}
                                            className="border-t border-line transition hover:bg-row-hover"
                                        >
                                            <td className="px-5 py-4">
                                                <button
                                                    type="button"
                                                    onClick={() => setDetail(order)}
                                                    className="tnum text-13 font-semibold text-td-strong underline-offset-2 hover:text-primary-strong hover:underline"
                                                >
                                                    {order.orderNo}
                                                </button>
                                            </td>
                                            <td className="px-3 py-4">
                                                <CustomerCell name={order.customer} sub={order.customerCode} />
                                            </td>
                                            <td className="px-3 py-4">
                                                <BomCell
                                                    bom={bom}
                                                    bomCode={order.bomCode}
                                                    category={snap.bomCategories.find(
                                                        category => category.name === bom?.name,
                                                    )}
                                                />
                                            </td>
                                            <td className="px-3 py-4 text-right">
                                                <QtyCell value={order.qty} />
                                            </td>
                                            <td className="px-3 py-4">
                                                <DateCell
                                                    date={order.deliverDate}
                                                    overdue={order.deliverDate < todayIso() && remaining > 0}
                                                />
                                            </td>
                                            <td className="px-3 py-4">
                                                <div className="text-12.5 text-muted">
                                                    {cancelled ? (
                                                        "已停止交付"
                                                    ) : done ? (
                                                        "已全部交付"
                                                    ) : (
                                                        <>
                                                            待交 <QtyCell value={remaining} />
                                                        </>
                                                    )}
                                                </div>
                                                <div className="tnum mt-0.5 text-11.5 text-muted">
                                                    已发 {num(order.outbound)} / {num(order.qty)}
                                                </div>
                                                {!cancelled && (
                                                    <div className="mt-1.5">
                                                        <ProgressTrack
                                                            value={order.qty === 0 ? 0 : order.outbound / order.qty}
                                                            done={done}
                                                        />
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-4">
                                                <StatusBadge status={status.key} label={status.label} />
                                            </td>
                                            <td className="min-w-28 px-5 py-4 text-right whitespace-nowrap">
                                                <div className="flex flex-col items-end gap-1">
                                                    <TableLink onClick={() => setDetail(order)}>查看详情</TableLink>
                                                    {canShip && maxShipOf(snap, order.orderNo) > 0 && (
                                                        <TableLink onClick={() => setShip(order.orderNo)}>
                                                            登记发货
                                                        </TableLink>
                                                    )}
                                                    {canEdit && (
                                                        <TableLink onClick={() => setEditing(order)}>编辑</TableLink>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
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
            {editing && <EditOrderModal key={editing.orderNo} order={editing} onClose={() => setEditing(null)} />}
            <OrderDetailModal
                order={detail ? (orders.find(order => order.orderNo === detail.orderNo) ?? null) : null}
                snap={snap}
                onClose={() => setDetail(null)}
                onShip={
                    canShip
                        ? () => {
                              setShip(detail!.orderNo);
                              setDetail(null);
                          }
                        : undefined
                }
            />
            {ship !== null && <OutboundModal open initialOrderNo={ship} onClose={() => setShip(null)} />}
        </div>
    );
}

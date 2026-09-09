import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { SearchSelect } from "@/components/ui/SearchSelect";
import { ListState, OrderTaskCard } from "@/components/ui/MobileList";
import { OutboundModal } from "@/pages/outbound/OutboundPage";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { downloadCsv, num } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button, ProgressTrack, StatusBadge, TableLink } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { CustomerCell, DateCell, QtyCell } from "@/components/ui/cells";
import { Field, SelectField, TextArea, TextField, DateField } from "@/components/ui/Field";
import { useCreateOrder, useUpdateOrder, useWbSnapshot } from "@/data/queries";
import { EMPTY_SNAPSHOT, bomByCode, maxShipOf, orderStatusOf, remainingOf } from "@/data/views";
import { todayIso } from "@/lib/date";
import { useToast } from "@/components/ui/Toast";
import type { Order, Snapshot } from "@/api";

const STATUS_OPTIONS = ["全部状态", "待备货", "可发货", "部分发货", "已完成"];

/* 新建销售订单弹窗（三步表单：客户与交付 → BOM 编码 → 备注） */
function NewOrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { data } = useWbSnapshot();
    const createOrder = useCreateOrder();
    const toast = useToast();
    const customers = data?.customers ?? [];
    const boms = data?.boms ?? [];

    const [customerCode, setCustomerCode] = useState("");
    const [qty, setQty] = useState("");
    const [orderDate, setOrderDate] = useState(todayIso);
    const [deliverStart, setDeliverStart] = useState("");
    const [deliverEnd, setDeliverEnd] = useState("");
    const [category, setCategory] = useState("");
    const [bomCode, setBomCode] = useState("");
    const [remark, setRemark] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});

    const categories = [...new Set(boms.map(bom => bom.name))];
    const bomOptions = boms
        .filter(bom => !category || bom.name === category)
        .map(bom => ({
            value: bom.code,
            label: `${bom.code} · ${bom.name} · ${bom.spec}`,
        }));

    const selectedBom = boms.find(bom => bom.code === bomCode);

    const reset = () => {
        setCustomerCode("");
        setQty("");
        setOrderDate(todayIso());
        setDeliverStart("");
        setDeliverEnd("");
        setCategory("");
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
        if (!deliverStart) nextErrors.deliverStart = "请选择交货起始日期";
        if (!deliverEnd) nextErrors.deliverEnd = "请选择交货终止日期";
        if (deliverStart && deliverEnd && deliverEnd < deliverStart) nextErrors.deliverEnd = "终止不能早于起始";
        if (!selectedBom) nextErrors.bom = "请选择 BOM";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length)
            requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus(),
            );
        if (Object.keys(nextErrors).length > 0) return;

        const customer = customers.find(item => item.code === customerCode)!;
        createOrder.mutate(
            {
                customerCode,
                customer: customer.name,
                bomCode: selectedBom!.code,
                qty: Number(qty),
                deliverStart,
                deliverEnd,
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
            subtitle="客户和 BOM 选一次，入库发货自动沿用"
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
                            options={customers.map(customer => ({
                                value: customer.code,
                                label: `${customer.name}（${customer.code}）`,
                            }))}
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
                        <div className="grid grid-cols-2 gap-3">
                            <DateField
                                label="交货起始"
                                required
                                error={errors.deliverStart}
                                value={deliverStart}
                                onChange={event => setDeliverStart(event.target.value)}
                            />
                            <DateField
                                label="交货终止"
                                required
                                error={errors.deliverEnd}
                                value={deliverEnd}
                                onChange={event => setDeliverEnd(event.target.value)}
                            />
                        </div>
                    </div>
                </fieldset>

                <fieldset className="rounded-panel border border-line p-4">
                    <legend className="px-1.5 text-12.5 font-semibold text-primary">② 选择 BOM</legend>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <SelectField
                            label="品类"
                            value={category}
                            onChange={event => {
                                setCategory(event.target.value);
                                setBomCode("");
                            }}
                        >
                            <option value="">全部品类</option>
                            {categories.map(item => (
                                <option key={item} value={item}>
                                    {item}
                                </option>
                            ))}
                        </SelectField>
                        <div className="sm:col-span-2">
                            <SearchSelect
                                label="BOM"
                                required
                                error={errors.bom}
                                value={bomCode}
                                onChange={setBomCode}
                                options={bomOptions}
                            />
                        </div>
                        {selectedBom && (
                            <p className="rounded-btn bg-primary-soft/70 px-3 py-2 text-12 text-primary-strong sm:col-span-3">
                                {selectedBom.code} · {selectedBom.name} · {selectedBom.spec}
                            </p>
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

/* 编辑销售订单弹窗（数量变更需填写修改原因） */
function EditOrderModal({ order, onClose }: { order: Order; onClose: () => void }) {
    const updateOrder = useUpdateOrder();
    const toast = useToast();
    const [qty, setQty] = useState(String(order.qty));
    const [deliverEnd, setDeliverEnd] = useState(order.deliverDate);
    const [remark, setRemark] = useState(order.remark);
    const [reason, setReason] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});
    const qtyChanged = order ? Number(qty) !== order.qty : false;

    const submit = () => {
        if (!order) return;
        const nextErrors: Record<string, string> = {};
        if (!qty || Number(qty) <= 0) nextErrors.qty = "请填写订单数量";
        if (qtyChanged && reason.trim().length < 4) nextErrors.reason = "修改数量必须填写至少 4 个字的修改原因";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length)
            requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus(),
            );
        if (Object.keys(nextErrors).length > 0) return;
        updateOrder.mutate(
            {
                orderNo: order.orderNo,
                qty: Number(qty),
                deliverDate: deliverEnd,
                remark,
                reason,
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
                        value={deliverEnd}
                        onChange={event => setDeliverEnd(event.target.value)}
                    />
                    <div className="sm:col-span-2">
                        <TextArea label="订单备注" value={remark} onChange={event => setRemark(event.target.value)} />
                    </div>
                    {qtyChanged && (
                        <div className="sm:col-span-2">
                            <TextField
                                label="修改原因"
                                required
                                placeholder="数量变更需要说明原因（至少 4 个字）"
                                error={errors.reason}
                                value={reason}
                                onChange={event => setReason(event.target.value)}
                            />
                        </div>
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
                <div className="grid grid-cols-3 gap-2.5">
                    {[
                        { label: "订单数量", value: order.qty, danger: false },
                        { label: "累计出库", value: order.outbound, danger: false },
                        { label: "剩余待交付", value: remaining, danger: remaining > 0 },
                    ].map(metric => (
                        <div key={metric.label} className="rounded-xl border border-line px-3 py-2.5 text-center">
                            <div className="text-11.5 text-muted">{metric.label}</div>
                            <div
                                className={`tnum text-20 font-bold ${metric.value > 0 && metric.label === "剩余待交付" ? "text-danger" : "text-ink"}`}
                            >
                                {num(metric.value)}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex flex-col gap-2 text-13">
                    {[
                        ["状态", <StatusBadge key="s" status={status.key} />],
                        [
                            "BOM 编码",
                            <span key="b" className="tnum font-medium text-ink">
                                {order.bomCode}
                            </span>,
                        ],
                        [
                            "规格",
                            <span key="spec" className="text-td">
                                {bom?.spec}
                            </span>,
                        ],
                        [
                            "下单日期",
                            <span key="od" className="tnum text-td">
                                {order.orderDate}
                            </span>,
                        ],
                        [
                            "交货日期",
                            <span key="dd" className="tnum text-td">
                                {order.deliverDate}
                                {remaining > 0 && order.deliverDate < todayIso() ? "（已逾期）" : ""}
                            </span>,
                        ],
                        [
                            "订单备注",
                            <span key="rk" className="text-td">
                                {order.remark || "—"}
                            </span>,
                        ],
                    ].map(([label, node]) => (
                        <div
                            key={label as string}
                            className="flex items-center justify-between gap-4 border-b border-line/70 pb-1.5"
                        >
                            <span className="text-muted">{label as string}</span>
                            {node}
                        </div>
                    ))}
                </div>
                <details className="rounded-xl border border-line px-3.5 py-2.5" open={shipments.length > 0}>
                    <summary className="cursor-pointer text-12.5 font-semibold text-ink">
                        发货记录（{shipments.length}）
                    </summary>
                    <div className="mt-2 flex flex-col gap-1.5">
                        {shipments.length === 0 && <p className="text-12 text-subtle">暂无发货记录。</p>}
                        {shipments.map(row => (
                            <div
                                key={row.no}
                                className="flex items-center justify-between gap-3 rounded-input bg-soft px-3 py-1.5 text-12.5"
                            >
                                <span className="tnum font-medium text-ink">{row.no}</span>
                                <span className="text-muted">
                                    {row.date} · {row.operator}
                                </span>
                                <QtyCell value={row.qty} unit="件" />
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
    const { data, isLoading } = useWbSnapshot();
    const snap = data ?? EMPTY_SNAPSHOT;
    const [searchParams, setSearchParams] = useSearchParams();
    const [statusFilter, setStatusFilter] = useState("全部状态");
    const [keyword, setKeyword] = useState(searchParams.get("q") ?? "");
    const [categoryFilter, setCategoryFilter] = useState("全部品类");
    const [dateStart, setDateStart] = useState("");
    const [dateEnd, setDateEnd] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
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
        // 仓库角色按交期优先排序，便于安排发货
        return role === "warehouse"
            ? [...rows].sort((a, b) => a.deliverDate.localeCompare(b.deliverDate) || a.orderNo.localeCompare(b.orderNo))
            : rows;
    })();

    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
    const dateFilterActive = !!dateStart || !!dateEnd;

    useEffect(() => {
        if (searchParams.get("new") === "order") {
            setNewOpen(true);
            setSearchParams({}, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const reset = () => {
        setTaskFilter("all");
        setStatusFilter("全部状态");
        setKeyword("");
        setCategoryFilter("全部品类");
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

            <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
                <div className="list-toolbar flex flex-wrap items-center gap-2.5 border-b border-line bg-gradient-to-b from-white to-panel px-5 py-4">
                    <label className="flex h-10 min-w-55 items-center gap-2 rounded-btn border border-line-strong bg-white px-3 sm:w-70">
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
                    <details className="relative">
                        <summary
                            className={`flex h-10 list-none items-center gap-1.5 rounded-btn px-3 text-13 transition ${
                                dateFilterActive
                                    ? "bg-primary-soft text-primary-strong"
                                    : "text-ink hover:text-primary-strong"
                            }`}
                        >
                            <Icon name="calendar" size={15} />
                            交期筛选
                            {dateFilterActive && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
                        </summary>
                        <div className="fixed inset-x-4 top-45 z-50 grid grid-cols-1 gap-2 lg:absolute lg:inset-x-auto lg:top-12 lg:right-0 lg:w-75 rounded-xl border border-line bg-white p-3 shadow-modal">
                            <Field label="开始">
                                <input
                                    type="date"
                                    value={dateStart}
                                    onChange={event => {
                                        setDateStart(event.target.value);
                                        setPage(1);
                                    }}
                                    className="rounded-input border border-line-strong px-2.5 py-2 text-13"
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
                                    className="rounded-input border border-line-strong px-2.5 py-2 text-13"
                                />
                            </Field>
                            <Button onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>
                                完成筛选
                            </Button>
                        </div>
                    </details>

                    <ToolbarMore>
                        <Button variant="secondary" icon="refresh" data-low-priority="true" onClick={reset}>
                            重置
                        </Button>
                        <Button
                            variant="secondary"
                            icon="download"
                            data-low-priority="true"
                            className="ml-auto"
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
                <div className="hidden overflow-x-auto lg:block">
                    {isLoading ? (
                        <div className="py-16 text-center text-13 text-subtle">加载中…</div>
                    ) : (
                        <table className="w-full min-w-245 border-collapse">
                            <thead>
                                <tr className="bg-soft text-left text-12 text-muted">
                                    <th className="px-5 py-2.5 font-semibold" style={{ width: "14%" }}>
                                        销售订单号
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "16%" }}>
                                        客户
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "18%" }}>
                                        BOM 编码
                                    </th>
                                    <th className="px-3 py-2.5 text-right font-semibold" style={{ width: "9%" }}>
                                        订单数量
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "11%" }}>
                                        交货日期
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "14%" }}>
                                        交付情况
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "9%" }}>
                                        状态
                                    </th>
                                    <th className="px-5 py-2.5 text-right font-semibold" style={{ width: "9%" }}>
                                        操作
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="px-5 py-14 text-center">
                                            <Icon name="search" size={28} className="mx-auto mb-2 text-subtle" />
                                            <p className="text-13 font-medium text-ink">没有找到匹配的订单</p>
                                            <p className="mt-0.5 text-12 text-muted">调整筛选或搜索关键词后重试</p>
                                            <button
                                                type="button"
                                                onClick={reset}
                                                className="mt-3 rounded-input border border-line-strong px-3.5 py-2 text-12.5 font-medium text-primary-strong hover:border-primary-border"
                                            >
                                                清除筛选
                                            </button>
                                        </td>
                                    </tr>
                                )}
                                {pageRows.map(order => {
                                    const bom = bomByCode(snap, order.bomCode);
                                    const status = orderStatusOf(snap, order);
                                    const remaining = remainingOf(order);
                                    const done = remaining === 0;
                                    return (
                                        <tr
                                            key={order.orderNo}
                                            className="border-t border-line/70 transition hover:bg-row-hover"
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
                                                <span className="tnum block text-13 font-semibold text-td-strong">
                                                    {order.bomCode}
                                                </span>
                                                <span
                                                    className="mt-0.5 block max-w-65 truncate text-11.5 text-muted"
                                                    title={bom?.spec}
                                                >
                                                    {bom ? `${bom.name} · ${bom.spec}` : "—"}
                                                </span>
                                            </td>
                                            <td className="px-3 py-4 text-right">
                                                <QtyCell value={order.qty} />
                                            </td>
                                            <td className="px-3 py-4">
                                                <DateCell
                                                    date={order.deliverDate}
                                                    overdue={order.deliverDate < todayIso() && !done}
                                                />
                                            </td>
                                            <td className="px-3 py-4">
                                                <div className="text-12.5 text-muted">
                                                    {done ? (
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
                                                <div className="mt-1.5">
                                                    <ProgressTrack
                                                        value={order.qty === 0 ? 0 : order.outbound / order.qty}
                                                        done={done}
                                                    />
                                                </div>
                                            </td>
                                            <td className="px-3 py-4">
                                                <StatusBadge status={status.key} />
                                            </td>
                                            <td className="px-5 py-4 text-right">
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

            {canCreate && <NewOrderModal open={newOpen} onClose={() => setNewOpen(false)} />}
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

import { regionText, cleanAddressPart } from "@/lib/address";
import { DataTable } from "@/components/ui/DataTable";
import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, RecordCard, CardField } from "@/components/ui/MobileList";
import { EmptyRow } from "@/components/ui/EmptyRow";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { downloadCsv, num } from "@/lib/format";
import { useApp } from "@/context/useApp";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { Pagination } from "@/components/ui/Pagination";
import { Badge, Button, StatusBadge, TableLink } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { CustomerCell } from "@/components/ui/cells";
import { OrderDetailModal } from "@/pages/orders/OrdersPage";
import { SortTh } from "@/components/ui/SortTh";
import { MobileSortSelect } from "@/components/ui/MobileSortSelect";
import { nextSortState, type SortState } from "@/lib/tableSort";
import { SelectField, TextField } from "@/components/ui/Field";
import { RegionCascader, type RegionValue } from "@/components/ui/RegionCascader";
import { useCreateCustomer, useUpdateCustomer, useWbRefresh, useWbSnapshot } from "@/data/queries";
import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useDelayedFlag } from "@/components/ui/useDelayedFlag";
import { PageLoading } from "@/components/ui/PageLoading";
import { EMPTY_SNAPSHOT, orderStatusOf, remainingOf } from "@/data/views";
import { useToast } from "@/components/ui/toastContexts";
import type { Customer, Snapshot } from "@/api";

/* 头像底色四循环：全走语义 token（warning/success/primary/accent 轮换），
   暗色下 soft/strong 自动切换到提亮档，不再出现浅色块浮在深底上 */
const AVATAR_TONES = [
    "bg-warning-soft text-warning",
    "bg-success-soft text-success",
    "bg-primary-soft text-primary-strong",
    "bg-accent-soft text-accent",
];

/* 可排序列：最近下单（日期）/ 累计订单 / 待交数量；桌面表头与移动端排序下拉共用 */
type CustomerSortKey = "lastOrderDate" | "orderCount" | "pendingQty";
const CUSTOMER_SORT_COLUMNS: Array<{ key: CustomerSortKey; label: string }> = [
    { key: "lastOrderDate", label: "最近下单" },
    { key: "orderCount", label: "累计订单" },
    { key: "pendingQty", label: "待交数量" },
];

/* 新建 / 编辑客户共用表单弹窗（编辑时传 customer 初值；电话留空表示不修改） */
function CustomerFormModal({
    customer,
    snap,
    onClose,
}: {
    customer: Customer | null;
    snap: Snapshot;
    onClose: () => void;
}) {
    const createCustomer = useCreateCustomer();
    const updateCustomer = useUpdateCustomer();
    const toast = useToast();
    const pending = createCustomer.isPending || updateCustomer.isPending;
    const [name, setName] = useState(customer?.name ?? "");
    const [contact, setContact] = useState(customer?.contact ?? "");
    const [phone, setPhone] = useState("");
    const [region, setRegion] = useState<RegionValue>(
        customer
            ? {
                  province: cleanAddressPart(customer.province),
                  city: cleanAddressPart(customer.city),
                  district: cleanAddressPart(customer.district),
                  town: cleanAddressPart(customer.town),
              }
            : { province: "", city: "", district: "", town: "" },
    );
    const [address, setAddress] = useState(cleanAddressPart(customer?.address));
    const [payTerms, setPayTerms] = useState(customer?.payTerms ?? "");
    const { user } = useApp();
    const [ownerAccount, setOwnerAccount] = useState(() => {
        if (customer) return customer.ownerAccount;
        return user?.role === "sales" ? user.account : "";
    });
    const [errors, setErrors] = useState<Record<string, string>>({});

    // 在职销售与超级管理员作为客户负责人候选
    const salesOptions = snap.customerOwnerOptions.map(item => ({
        value: item.account,
        label: `${item.name}（${item.account}）`,
    }));

    const submit = () => {
        const nextErrors: Record<string, string> = {};
        if (name.trim().length < 4) nextErrors.name = "请填写公司名称（至少 4 个字）";
        if (!contact.trim()) nextErrors.contact = "请填写客户联系人";
        // 新建必填手机号；编辑留空 = 不修改，填了才校验格式
        if (!customer || phone) {
            if (!/^1\d{10}$/.test(phone)) nextErrors.phone = "请填写 11 位手机号";
        }
        if (!ownerAccount) nextErrors.owner = "请选择客户负责人";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length)
            requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus(),
            );
        if (Object.keys(nextErrors).length > 0) return;
        const body = {
            name: name.trim(),
            contact: contact.trim(),
            phone,
            province: region.province,
            city: region.city,
            district: region.district,
            town: region.town,
            address,
            ownerAccount,
            payTerms: payTerms.trim(),
        };
        const onSuccess = (saved: Customer) => {
            toast(customer ? `客户档案 ${saved.code} 已更新` : `客户档案 ${saved.code} 已创建`);
            onClose();
        };
        if (customer) {
            updateCustomer.mutate({ code: customer.code, expectedVersion: customer.version, ...body }, { onSuccess });
        } else createCustomer.mutate(body, { onSuccess });
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={customer ? "编辑客户档案" : "新建客户档案"}
            subtitle={customer ? `${customer.code} · 建档 ${customer.created}` : "客户编码自动生成，订单从档案选择"}
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
                        disabled={pending}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-14 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        {pending ? "正在提交…" : "保存档案"}
                    </button>
                </>
            }
        >
            <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                    label="客户名称"
                    required
                    placeholder="如 苏州某某精密制造"
                    error={errors.name}
                    value={name}
                    onChange={event => setName(event.target.value)}
                />
                {customer && <TextField label="客户编码" disabled value={customer.code} />}
                <TextField
                    label="客户联系人"
                    required
                    placeholder="姓名"
                    error={errors.contact}
                    value={contact}
                    onChange={event => setContact(event.target.value)}
                />
                <TextField
                    label="客户联系电话"
                    required={!customer}
                    placeholder={customer ? "留空保持不变，输入新号替换" : "11 位手机号"}
                    error={errors.phone}
                    value={phone}
                    onChange={event => setPhone(event.target.value.replace(/\D/g, "").slice(0, 11))}
                />
                <SelectField
                    label="客户负责人"
                    required
                    error={errors.owner}
                    value={ownerAccount}
                    onChange={event => setOwnerAccount(event.target.value)}
                >
                    <option value="">请选择负责人</option>
                    {salesOptions.map(item => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
                    ))}
                </SelectField>
                <TextField
                    label="付款条件"
                    placeholder="如 月结 30 天"
                    value={payTerms}
                    onChange={event => setPayTerms(event.target.value)}
                />
                <RegionCascader value={region} onChange={setRegion} />
                <TextField
                    label="详细地址"
                    placeholder="如 示例街道 88 号（可空）"
                    value={address}
                    onChange={event => setAddress(event.target.value)}
                />
            </div>
        </Modal>
    );
}

export function CustomerDetailModal({
    customer,
    snap,
    onClose,
    onEdit,
}: {
    customer: Customer | null;
    snap: Snapshot;
    onClose: () => void;
    onEdit?: (customer: Customer) => void;
}) {
    // 叠加在客户详情之上的订单详情；存 orderNo 渲染时回捞，刷新后数据保持同步
    const [orderNo, setOrderNo] = useState<string | null>(null);
    // 最近订单默认 3 笔，“查看全部”就地展开完整时间线，不跳出当前弹窗
    const [expanded, setExpanded] = useState(false);
    // 切换查看的客户时在渲染期清掉上层订单详情与展开态，避免残留上一个客户的弹窗
    const viewedCode = customer?.code;
    const [lastViewedCode, setLastViewedCode] = useState(viewedCode);
    if (viewedCode !== lastViewedCode) {
        setLastViewedCode(viewedCode);
        setOrderNo(null);
        setExpanded(false);
    }
    if (!customer) return null;
    const orders = snap.orders.filter(order => order.customerCode === customer.code);
    // 待交付口径与订单列表一致：已取消/已归档订单剩余按 0，不再计入
    const pendingQty = orders.reduce((sum, order) => sum + remainingOf(order), 0);
    const byDateDesc = [...orders].sort((a, b) => b.orderDate.localeCompare(a.orderDate));
    const timeline = expanded ? byDateDesc : byDateDesc.slice(0, 3);
    const orderDetail = orderNo ? (snap.orders.find(order => order.orderNo === orderNo) ?? null) : null;

    return (
        <>
            <Modal
                open={!!customer}
                onClose={onClose}
                label="客户档案详情"
                title={customer.name}
                subtitle={`${customer.code} · 建档 ${customer.created}`}
                width={560}
                layout="detail"
                footer={
                    <>
                        {onEdit && (
                            <button
                                type="button"
                                onClick={() => onEdit(customer)}
                                className="min-h-10 rounded-btn border border-line-strong bg-surface px-4 text-14 font-medium text-ink hover:border-primary-border"
                            >
                                编辑档案
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="min-h-10 rounded-btn bg-primary px-4 text-14 font-medium text-white hover:bg-primary-hover"
                        >
                            关闭
                        </button>
                    </>
                }
            >
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3 rounded-panel border border-line bg-linear-to-r from-primary-soft to-surface px-4 py-3">
                        <span
                            className={`flex h-11 w-11 items-center justify-center rounded-full text-16 font-semibold ${AVATAR_TONES[0]}`}
                        >
                            {customer.name.slice(0, 1)}
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="text-14 font-semibold text-ink">{customer.name}</div>
                            <div className="tnum text-13 text-muted">
                                {customer.code} · 建档 {customer.created}
                            </div>
                        </div>
                        <Badge tone={customer.cooperation === "合作中" ? "done" : "pending"}>
                            {customer.cooperation}
                        </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                        <div className="rounded-xl border border-line px-3 py-2.5 text-center">
                            <div className="text-12 text-muted">累计订单</div>
                            <div className="tnum text-20 font-bold text-ink">
                                {orders.length} <i className="text-13 font-normal text-subtle not-italic">单</i>
                            </div>
                        </div>
                        <div className="rounded-xl border border-line px-3 py-2.5 text-center">
                            <div className="text-12 text-muted">已完成订单</div>
                            <div className="tnum text-20 font-bold text-success">
                                {orders.filter(order => order.outbound >= order.qty).length}
                                <i className="ml-1 text-13 font-normal not-italic">单</i>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 text-14">
                        {(
                            [
                                ["客户联系人", customer.contact],
                                ["客户联系电话", customer.phone],
                                ["所在地区", regionText(customer) || "未填写"],
                                ["详细地址", cleanAddressPart(customer.address) || "未填写"],
                                ["付款方式", customer.payTerms || "—"],
                                ["客户负责人", customer.owner],
                                ["待交付数量", `${pendingQty.toLocaleString("zh-CN")} 个`],
                            ] as Array<[string, ReactNode]>
                        ).map(([label, value]) => (
                            <div
                                key={label}
                                className="flex items-center justify-between gap-4 border-b border-line/70 pb-1.5"
                            >
                                <span className="text-muted">{label}</span>
                                <span className="tnum font-medium text-ink">{value}</span>
                            </div>
                        ))}
                    </div>
                    <div>
                        <div className="mb-2 text-13 font-semibold text-ink">最近订单</div>
                        <ol className="flex flex-col gap-2.5 border-l border-line pl-4">
                            {timeline.length === 0 && <li className="text-13 text-subtle">暂无订单记录。</li>}
                            {timeline.map(order => {
                                const archived = order.lifecycleStatus === "archived";
                                const inactive = archived;
                                const status = orderStatusOf(snap, order);
                                return (
                                    <li key={order.orderNo} className="relative">
                                        <span
                                            className={`absolute top-1.5 -left-5.25 h-2 w-2 rounded-full ${inactive ? "bg-subtle" : "bg-primary"}`}
                                        />
                                        {/* 整行可点保证触屏命中区，订单号 hover 出下划线 */}
                                        <button
                                            type="button"
                                            onClick={() => setOrderNo(order.orderNo)}
                                            aria-label={`查看订单 ${order.orderNo} 详情`}
                                            className="group -mx-2 flex flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-row-hover"
                                        >
                                            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                                <span
                                                    className={`tnum text-13 font-semibold underline-offset-2 group-hover:underline ${
                                                        inactive ? "text-td-strong" : "text-primary-strong"
                                                    }`}
                                                >
                                                    {order.orderNo}
                                                </span>
                                                <span className="text-13 text-muted">
                                                    · {order.qty.toLocaleString("zh-CN")} 个
                                                </span>
                                                <StatusBadge status={status.key} />
                                            </span>
                                            <span className="tnum text-12 text-muted">{order.orderDate}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ol>
                        {orders.length > 3 && (
                            <button
                                type="button"
                                onClick={() => setExpanded(value => !value)}
                                aria-expanded={expanded}
                                className="mt-3 inline-flex min-h-9 items-center gap-1 text-13 font-medium text-primary-strong transition hover:underline"
                            >
                                {expanded ? "收起" : `查看全部 ${orders.length} 笔订单`}
                                <Icon name={expanded ? "chevron-up" : "chevron-down"} size={14} />
                            </button>
                        )}
                    </div>
                </div>
            </Modal>
            {orderDetail && <OrderDetailModal order={orderDetail} snap={snap} onClose={() => setOrderNo(null)} />}
        </>
    );
}

export function CustomersPage() {
    const { can } = useApp();
    const { data, isLoading, isFetching } = useWbSnapshot();
    const { refresh } = useWbRefresh();
    // 首载出替换式占位,后台刷新出保留式遮罩(200ms 内完成不闪现)
    const overlay = useDelayedFlag(isFetching && !isLoading);
    const [searchParams, setSearchParams] = useSearchParams();
    const [statusFilter, setStatusFilter] = useState("全部状态");
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    // 列排序默认升序：默认按最近下单
    const [sort, setSort] = useState<SortState<CustomerSortKey>>({ key: "lastOrderDate", dir: "asc" });
    const [formTarget, setFormTarget] = useState<Customer | "new" | null>(null);
    const [detail, setDetail] = useState<Customer | null>(null);

    const snap = data ?? EMPTY_SNAPSHOT;
    const customers = snap.customers;
    const orders = snap.orders;

    const rows = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return customers
            .filter(customer => {
                if (statusFilter !== "全部状态" && customer.cooperation !== statusFilter) return false;
                if (kw && !`${customer.name} ${customer.code}`.toLowerCase().includes(kw)) return false;
                return true;
            })
            .map(customer => {
                const own = orders.filter(order => order.customerCode === customer.code);
                const pendingQty = own.reduce((sum, order) => sum + remainingOf(order), 0);
                const lastOrderDate =
                    own
                        .map(order => order.orderDate)
                        .sort()
                        .at(-1) ?? "—";
                return {
                    customer,
                    orderCount: own.length,
                    pendingQty,
                    lastOrderDate,
                };
            });
    }, [customers, orders, statusFilter, keyword]);

    // 列排序：从未下单（—）的客户固定排在最后，同值以客户编码稳定排序
    const sortedRows = useMemo(() => {
        const factor = sort.dir === "asc" ? 1 : -1;
        const byCode = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
            a.customer.code.localeCompare(b.customer.code);
        return [...rows].sort((a, b) => {
            if (sort.key === "orderCount") return (a.orderCount - b.orderCount) * factor || byCode(a, b);
            if (sort.key === "pendingQty") return (a.pendingQty - b.pendingQty) * factor || byCode(a, b);
            if (a.lastOrderDate === "—" || b.lastOrderDate === "—") {
                if (a.lastOrderDate === b.lastOrderDate) return byCode(a, b);
                return a.lastOrderDate === "—" ? 1 : -1;
            }
            return a.lastOrderDate.localeCompare(b.lastOrderDate) * factor || byCode(a, b);
        });
    }, [rows, sort]);

    const pageRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

    const applySort = (key: CustomerSortKey) => setSort(current => nextSortState(current, key));
    // 排序或翻页后行序变化，滚动区回到顶部，避免误以为排错行
    const tableScrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
    }, [page, sort]);

    useEffect(() => {
        if (searchParams.get("new") === "customer") {
            setFormTarget("new");
            setSearchParams({}, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    // 清空条件只作用于筛选行（搜索/合作状态）；分页由用户自行操作
    const clearFilters = () => {
        setStatusFilter("全部状态");
        setKeyword("");
        setPage(1);
    };
    const filtersActive = !!keyword.trim() || statusFilter !== "全部状态";

    const canCreate = can("customers:create");
    const canEdit = can("customers:edit");

    return (
        <div className="flex flex-col gap-5">
            <h1 className="sr-only">客户档案</h1>

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
                            placeholder="公司名 / BOM"
                            className="w-full bg-transparent text-14 text-ink outline-none placeholder:text-subtle"
                        />
                    </label>
                    <select
                        value={statusFilter}
                        onChange={event => {
                            setStatusFilter(event.target.value);
                            setPage(1);
                        }}
                        aria-label="按合作状态筛选"
                        className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink"
                    >
                        {["全部状态", "合作中", "待跟进"].map(option => (
                            <option key={option}>{option}</option>
                        ))}
                    </select>
                    <MobileSortSelect
                        columns={CUSTOMER_SORT_COLUMNS}
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
                                        "客户档案",
                                        [
                                            "客户编码",
                                            "客户名称",
                                            "客户联系人",
                                            "客户电话",
                                            "地区",
                                            "累计订单",
                                            "待交数量",
                                            "合作状态",
                                        ],
                                        pageRows.map(row => [
                                            row.customer.code,
                                            row.customer.name,
                                            row.customer.contact,
                                            row.customer.phone,
                                            regionText(row.customer),
                                            String(row.orderCount),
                                            String(row.pendingQty),
                                            row.customer.cooperation,
                                        ]),
                                    )
                                }
                            >
                                导出
                            </Button>
                        </ToolbarMore>
                        {canCreate && (
                            <Button icon="plus" onClick={() => setFormTarget("new")}>
                                新建客户
                            </Button>
                        )}
                    </TableHeaderActions>
                </div>

                <div className="mobile-records">
                    <ListState loading={isLoading} empty={!pageRows.length}>
                        {pageRows.map(({ customer, orderCount, pendingQty }) => (
                            <RecordCard
                                key={customer.code}
                                title={customer.name}
                                subtitle={`${customer.code} · ${regionText(customer) || "未填写"}`}
                                badge={
                                    <Badge tone={customer.cooperation === "合作中" ? "success" : "pending"}>
                                        {customer.cooperation}
                                    </Badge>
                                }
                                actions={
                                    <>
                                        <Button onClick={() => setDetail(customer)}>查看档案</Button>
                                    </>
                                }
                            >
                                <p>
                                    {customer.contact} · {customer.phone}
                                </p>
                                <div className="mt-2 flex flex-col gap-1.5">
                                    <CardField label="累计订单" value={`${orderCount} 单`} />
                                    <CardField label="待交" value={`${num(pendingQty)} 个`} strong />
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
                            tableId="customers"
                            defaultWidths={[240, 124, 150, 170, 120, 130, 138, 110, 120]}
                            recordCount={rows.length}
                            identityColumn={0}
                            scrollRef={tableScrollRef}
                        >
                            <thead>
                                <tr className="text-left text-13 text-muted">
                                    <th className="cell-pad-wide">客户信息</th>
                                    <th>客户联系人</th>
                                    <th>电话</th>
                                    <th>所在地</th>
                                    <SortTh
                                        label="累计订单"
                                        active={sort.key === "orderCount"}
                                        dir={sort.dir}
                                        onSort={() => applySort("orderCount")}
                                    />
                                    <SortTh
                                        label="待交数量"
                                        active={sort.key === "pendingQty"}
                                        dir={sort.dir}
                                        onSort={() => applySort("pendingQty")}
                                    />
                                    <SortTh
                                        label="最近下单"
                                        active={sort.key === "lastOrderDate"}
                                        dir={sort.dir}
                                        onSort={() => applySort("lastOrderDate")}
                                    />
                                    <th>合作状态</th>
                                    <th className="cell-pad-wide text-center">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && <EmptyRow colSpan={9} description="没有找到匹配的客户" />}
                                {pageRows.map((row, index) => (
                                    <tr key={row.customer.code}>
                                        <td className="cell-pad-wide">
                                            <div className="flex items-center gap-2.5">
                                                <span
                                                    className={`customer-avatar flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-14 font-semibold ${AVATAR_TONES[index % AVATAR_TONES.length]}`}
                                                >
                                                    {row.customer.name.slice(0, 1)}
                                                </span>
                                                <CustomerCell
                                                    name={row.customer.name}
                                                    note={row.customer.code}
                                                    onClick={() => setDetail(row.customer)}
                                                />
                                            </div>
                                        </td>
                                        <td className="text-14 text-td">{row.customer.contact}</td>
                                        <td className="tnum text-14 text-td">{row.customer.phone}</td>
                                        <td>
                                            <span className="flex items-center gap-1.5 text-14 text-td">
                                                {regionText(row.customer) ? (
                                                    <>
                                                        <Icon name="location" size={14} className="text-subtle" />
                                                        {regionText(row.customer)}
                                                    </>
                                                ) : (
                                                    <span className="text-subtle">未填写</span>
                                                )}
                                            </span>
                                        </td>
                                        <td className="tnum text-14 text-td">{row.orderCount}</td>
                                        <td className="tnum text-14">
                                            <span
                                                className={row.pendingQty > 0 ? "font-medium text-ink" : "text-subtle"}
                                            >
                                                {num(row.pendingQty)}
                                            </span>
                                        </td>
                                        <td className="tnum text-14 text-td">{row.lastOrderDate}</td>
                                        <td>
                                            <Badge tone={row.customer.cooperation === "合作中" ? "done" : "pending"}>
                                                {row.customer.cooperation}
                                            </Badge>
                                        </td>
                                        <td className="cell-pad-wide text-center">
                                            <TableLink onClick={() => setDetail(row.customer)}>查看档案</TableLink>
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
                        total={rows.length}
                        unit="家客户"
                        onPageChange={setPage}
                        onPageSizeChange={size => {
                            setPageSize(size);
                            setPage(1);
                        }}
                    />
                </div>
            </section>

            {formTarget !== null && (formTarget === "new" ? canCreate : canEdit) && (
                <CustomerFormModal
                    customer={formTarget === "new" ? null : formTarget}
                    snap={snap}
                    onClose={() => setFormTarget(null)}
                />
            )}
            <CustomerDetailModal
                customer={detail}
                snap={snap}
                onClose={() => setDetail(null)}
                onEdit={
                    canEdit
                        ? customer => {
                              setDetail(null);
                              setFormTarget(customer);
                          }
                        : undefined
                }
            />
        </div>
    );
}

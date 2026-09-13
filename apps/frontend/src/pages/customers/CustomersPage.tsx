import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, RecordCard } from "@/components/ui/MobileList";
import { EmptyState } from "@/components/ui/EmptyState";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { downloadCsv } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { PageHeading } from "@/components/ui/PageHeading";
import { Pagination } from "@/components/ui/Pagination";
import { Badge, Button, TableLink } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { CustomerCell } from "@/components/ui/cells";
import { SelectField, TextField } from "@/components/ui/Field";
import { RegionCascader, regionText, type RegionValue } from "@/components/ui/RegionCascader";
import { useCreateCustomer, useUpdateCustomer, useWbRefresh, useWbSnapshot } from "@/data/queries";
import { LoadingOverlay, useDelayedFlag } from "@/components/ui/LoadingOverlay";
import { PageLoading } from "@/components/ui/PageLoading";
import { EMPTY_SNAPSHOT } from "@/data/views";
import { useToast } from "@/components/ui/Toast";
import type { Customer, Snapshot } from "@/api";

const AVATAR_TONES = [
    "bg-orange-100 text-orange-700",
    "bg-success-soft text-success",
    "bg-purple-100 text-purple-700",
    "bg-accent-soft text-accent",
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
            ? { province: customer.province, city: customer.city, district: customer.district, town: customer.town }
            : { province: "", city: "", district: "", town: "" },
    );
    const [address, setAddress] = useState(customer?.address ?? "");
    const [payTerms, setPayTerms] = useState(customer?.payTerms ?? "");
    const { user } = useApp();
    const [ownerAccount, setOwnerAccount] = useState(() => {
        if (customer) return customer.ownerAccount;
        return user?.role === "sales" ? user.account : "";
    });
    const [errors, setErrors] = useState<Record<string, string>>({});

    // 在职销售作为客户负责人候选
    const salesOptions = snap.customerOwnerOptions.map(item => ({
        value: item.account,
        label: `${item.name}（${item.account}）`,
    }));

    const submit = () => {
        const nextErrors: Record<string, string> = {};
        if (name.trim().length < 4) nextErrors.name = "请填写公司名称（至少 4 个字）";
        if (!contact.trim()) nextErrors.contact = "请填写联系人";
        // 新建必填手机号；编辑留空 = 不修改，填了才校验格式
        if (!customer || phone) {
            if (!/^1\d{10}$/.test(phone)) nextErrors.phone = "请填写 11 位手机号";
        }
        if (!region.province || !region.city) nextErrors.region = "请选择所在地区";
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
                        className="min-h-10 rounded-btn border border-line-strong bg-white px-4 text-13 font-medium text-ink hover:border-primary-border"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        disabled={pending}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-13 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
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
                    label="联系人"
                    required
                    placeholder="姓名"
                    error={errors.contact}
                    value={contact}
                    onChange={event => setContact(event.target.value)}
                />
                <TextField
                    label="联系电话"
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
                    <option value="">请选择销售</option>
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
                <RegionCascader value={region} onChange={setRegion} error={errors.region} />
                <TextField
                    label="详细地址"
                    placeholder="如 示例街道 88 号"
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
    if (!customer) return null;
    const orders = snap.orders.filter(order => order.customerCode === customer.code);
    const pendingQty = orders.reduce((sum, order) => sum + Math.max(0, order.qty - order.outbound), 0);
    const timeline = [...orders].sort((a, b) => b.orderDate.localeCompare(a.orderDate)).slice(0, 3);

    return (
        <Modal
            open={!!customer}
            onClose={onClose}
            label="客户档案详情"
            title={customer.name}
            subtitle={`${customer.code} · 建档 ${customer.created}`}
            width={560}
            footer={
                <>
                    {onEdit && (
                        <button
                            type="button"
                            onClick={() => onEdit(customer)}
                            className="min-h-10 rounded-btn border border-line-strong bg-white px-4 text-13 font-medium text-ink hover:border-primary-border"
                        >
                            编辑档案
                        </button>
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
                <div className="flex items-center gap-3 rounded-panel border border-line bg-gradient-to-r from-[#f7f7ff] to-white px-4 py-3">
                    <span
                        className={`flex h-11 w-11 items-center justify-center rounded-full text-16 font-semibold ${AVATAR_TONES[0]}`}
                    >
                        {customer.name.slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="text-14 font-semibold text-ink">{customer.name}</div>
                        <div className="tnum text-12 text-muted">
                            {customer.code} · 建档 {customer.created}
                        </div>
                    </div>
                    <Badge tone={customer.cooperation === "合作中" ? "done" : "pending"}>{customer.cooperation}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-xl border border-line px-3 py-2.5 text-center">
                        <div className="text-11.5 text-muted">累计订单</div>
                        <div className="tnum text-20 font-bold text-ink">
                            {orders.length} <i className="text-12 font-normal text-subtle not-italic">单</i>
                        </div>
                    </div>
                    <div className="rounded-xl border border-line px-3 py-2.5 text-center">
                        <div className="text-11.5 text-muted">已完成订单</div>
                        <div className="tnum text-20 font-bold text-success">
                            {orders.filter(order => order.outbound >= order.qty).length}
                            <i className="ml-1 text-12 font-normal not-italic">单</i>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-2 text-13">
                    {[
                        ["联系人", customer.contact],
                        ["联系电话", customer.phone],
                        ["所在地区", regionText(customer)],
                        ["详细地址", customer.address || "—"],
                        ["付款方式", customer.payTerms || "—"],
                        ["客户负责人", customer.owner],
                        ["待交付数量", `${pendingQty.toLocaleString("zh-CN")} 件`],
                    ].map(([label, value]) => (
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
                    <div className="mb-2 text-12.5 font-semibold text-ink">最近动态</div>
                    <ol className="flex flex-col gap-2.5 border-l border-line pl-4">
                        {timeline.length === 0 && <li className="text-12.5 text-subtle">暂无订单动态。</li>}
                        {timeline.map(order => (
                            <li key={order.orderNo} className="relative">
                                <span className="absolute top-1.5 -left-5.25 h-2 w-2 rounded-full bg-primary" />
                                <div className="text-12.5 text-ink">
                                    新建订单{" "}
                                    <span className="tnum font-semibold text-primary-strong">{order.orderNo}</span> ·{" "}
                                    {order.qty.toLocaleString("zh-CN")} 件
                                </div>
                                <div className="tnum text-11.5 text-muted">{order.orderDate}</div>
                            </li>
                        ))}
                    </ol>
                </div>
            </div>
        </Modal>
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
                const pendingQty = own.reduce((sum, order) => sum + Math.max(0, order.qty - order.outbound), 0);
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

    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

    useEffect(() => {
        if (searchParams.get("new") === "customer") {
            setFormTarget("new");
            setSearchParams({}, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const reset = () => {
        setStatusFilter("全部状态");
        setKeyword("");
        setPage(1);
    };

    const canCreate = can("customers:create");
    const canEdit = can("customers:edit");

    return (
        <div className="flex flex-col gap-5">
            <PageHeading
                title="客户档案"
                actions={
                    canCreate ? (
                        <Button icon="plus" onClick={() => setFormTarget("new")}>
                            新建客户
                        </Button>
                    ) : undefined
                }
            />

            <section className="relative overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
                {overlay && <LoadingOverlay />}
                <div className="list-toolbar flex flex-wrap items-center gap-2.5 border-b border-line bg-gradient-to-b from-white to-panel px-5 py-4">
                    <select
                        value={statusFilter}
                        onChange={event => {
                            setStatusFilter(event.target.value);
                            setPage(1);
                        }}
                        className="h-10 rounded-btn border border-line-strong bg-white px-3 text-13 text-ink"
                    >
                        {["全部状态", "合作中", "待跟进"].map(option => (
                            <option key={option}>{option}</option>
                        ))}
                    </select>
                    <label className="flex h-10 min-w-55 flex-1 items-center gap-2 rounded-btn border border-line-strong bg-white px-3 sm:max-w-75">
                        <Icon name="search" size={15} className="text-subtle" />
                        <input
                            value={keyword}
                            onChange={event => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                            placeholder="搜索公司名称或编码"
                            className="w-full bg-transparent text-13 text-ink outline-none placeholder:text-subtle"
                        />
                    </label>

                    <ToolbarMore>
                        <Button variant="secondary" icon="reset" data-low-priority="true" onClick={reset}>
                            重置
                        </Button>
                        <Button variant="secondary" icon="refresh" data-low-priority="true" onClick={refresh}>
                            刷新
                        </Button>
                        <Button
                            variant="secondary"
                            icon="download"
                            data-low-priority="true"
                            onClick={() =>
                                downloadCsv(
                                    "客户档案",
                                    [
                                        "客户编码",
                                        "客户名称",
                                        "联系人",
                                        "电话",
                                        "地区",
                                        "累计订单",
                                        "待交件数",
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
                </div>

                <div className="mobile-records">
                    <ListState loading={isLoading} empty={!pageRows.length}>
                        {pageRows.map(({ customer, orderCount, pendingQty }) => (
                            <RecordCard
                                key={customer.code}
                                title={customer.name}
                                subtitle={`${customer.code} · ${regionText(customer)}`}
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
                                <p className="mt-2">
                                    {orderCount} 笔订单 · 待交 <strong>{pendingQty.toLocaleString("zh-CN")}</strong> 件
                                </p>
                            </RecordCard>
                        ))}
                    </ListState>
                </div>
                <div className="hidden overflow-x-auto lg:block">
                    {isLoading ? (
                        <PageLoading className="py-16" />
                    ) : (
                        <table className="w-full min-w-240 border-collapse">
                            <thead>
                                <tr className="bg-soft text-left text-12 text-muted">
                                    <th className="px-5 py-2.5 font-semibold">客户信息</th>
                                    <th className="px-3 py-2.5 font-semibold">联系人</th>
                                    <th className="px-3 py-2.5 font-semibold">电话</th>
                                    <th className="px-3 py-2.5 font-semibold">所在地</th>
                                    <th className="px-3 py-2.5 font-semibold">累计 / 待交</th>
                                    <th className="px-3 py-2.5 font-semibold">最近下单</th>
                                    <th className="px-3 py-2.5 font-semibold">合作状态</th>
                                    <th className="px-5 py-2.5 text-right font-semibold">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="px-5 py-10 text-center">
                                            <EmptyState description="没有找到匹配的客户" />
                                        </td>
                                    </tr>
                                )}
                                {pageRows.map((row, index) => (
                                    <tr
                                        key={row.customer.code}
                                        className="border-t border-line/70 transition hover:bg-row-hover"
                                    >
                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-2.5">
                                                <span
                                                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-13 font-semibold ${AVATAR_TONES[index % AVATAR_TONES.length]}`}
                                                >
                                                    {row.customer.name.slice(0, 1)}
                                                </span>
                                                <CustomerCell
                                                    name={row.customer.name}
                                                    sub={row.customer.code}
                                                    onClick={() => setDetail(row.customer)}
                                                />
                                            </div>
                                        </td>
                                        <td className="px-3 py-3 text-13 text-td">{row.customer.contact}</td>
                                        <td className="px-3 py-3">
                                            <span className="tnum text-13 text-td">{row.customer.phone}</span>
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className="flex items-center gap-1.5 text-13 text-td">
                                                <Icon name="location" size={14} className="text-subtle" />
                                                {regionText(row.customer)}
                                            </span>
                                        </td>
                                        <td className="px-3 py-3 text-13 text-td tnum">
                                            {row.orderCount} 单
                                            {row.pendingQty > 0 ? (
                                                <span className="text-muted">
                                                    {" "}
                                                    · 待交 {row.pendingQty.toLocaleString("zh-CN")}
                                                </span>
                                            ) : null}
                                        </td>
                                        <td className="px-3 py-3 tnum text-13 text-td">{row.lastOrderDate}</td>
                                        <td className="px-3 py-3">
                                            <Badge tone={row.customer.cooperation === "合作中" ? "done" : "pending"}>
                                                {row.customer.cooperation}
                                            </Badge>
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <TableLink onClick={() => setDetail(row.customer)}>查看档案</TableLink>
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

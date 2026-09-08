import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, RecordCard } from "@/components/ui/MobileList";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { downloadCsv } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { PageHeading } from "@/components/ui/PageHeading";
import { Badge, Button, TableLink } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { CustomerCell } from "@/components/ui/cells";
import { SelectField, TextArea, TextField } from "@/components/ui/Field";
import { useCreateCustomer, useWbSnapshot } from "@/data/queries";
import { EMPTY_SNAPSHOT } from "@/data/views";
import { useToast } from "@/components/ui/Toast";
import type { Customer, Snapshot } from "@/api";

const AVATAR_TONES = [
    "bg-[#ffedd5] text-[#c2410c]",
    "bg-success-soft text-success",
    "bg-[#f3e8ff] text-[#7e22ce]",
    "bg-accent-soft text-accent",
];

function NewCustomerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const createCustomer = useCreateCustomer();
    const toast = useToast();
    const [name, setName] = useState("");
    const [contact, setContact] = useState("");
    const [phone, setPhone] = useState("");
    const [region, setRegion] = useState("华东");
    const [address, setAddress] = useState("");
    const [remark, setRemark] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});

    const reset = () => {
        setName("");
        setContact("");
        setPhone("");
        setRegion("华东");
        setAddress("");
        setRemark("");
        setErrors({});
    };

    const submit = () => {
        const nextErrors: Record<string, string> = {};
        if (name.trim().length < 4) nextErrors.name = "请填写公司名称（至少 4 个字）";
        if (!contact.trim()) nextErrors.contact = "请填写联系人";
        if (!/^1\d{10}$/.test(phone)) nextErrors.phone = "请填写 11 位手机号";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length)
            requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus(),
            );
        if (Object.keys(nextErrors).length > 0) return;
        createCustomer.mutate(
            {
                name: name.trim(),
                contact: contact.trim(),
                phone,
                region,
                address,
                remark,
            },
            {
                onSuccess: customer => {
                    toast(`客户档案 ${customer.code} 已创建`);
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
            title="新建客户档案"
            subtitle="客户编码与名称由档案统一管理，订单从档案选择"
            width={560}
            footer={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        className="min-h-10 rounded-btn border border-line-strong bg-white px-4 text-[13px] font-medium text-ink hover:border-primary-border"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        disabled={createCustomer.isPending}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        保存档案
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
                <TextField label="客户编码" hint="保存后自动生成" disabled value="自动生成" />
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
                    required
                    placeholder="11 位手机号"
                    error={errors.phone}
                    value={phone}
                    onChange={event => setPhone(event.target.value.replace(/\D/g, "").slice(0, 11))}
                />
                <SelectField label="所在地区" value={region} onChange={event => setRegion(event.target.value)}>
                    {["华东", "华南", "华北", "西南"].map(item => (
                        <option key={item}>{item}</option>
                    ))}
                </SelectField>
                <TextField
                    label="详细地址"
                    placeholder="选填"
                    value={address}
                    onChange={event => setAddress(event.target.value)}
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
        </Modal>
    );
}

export function CustomerDetailModal({
    customer,
    snap,
    onClose,
}: {
    customer: Customer | null;
    snap: Snapshot;
    onClose: () => void;
}) {
    const toast = useToast();
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
                <button
                    type="button"
                    onClick={onClose}
                    className="min-h-10 rounded-btn bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-hover"
                >
                    关闭
                </button>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3 rounded-panel border border-line bg-gradient-to-r from-[#f7f7ff] to-white px-4 py-3">
                    <span
                        className={`flex h-11 w-11 items-center justify-center rounded-full text-[16px] font-semibold ${AVATAR_TONES[0]}`}
                    >
                        {customer.name.slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-semibold text-ink">{customer.name}</div>
                        <div className="tnum text-[12px] text-muted">
                            {customer.code} · 建档 {customer.created}
                        </div>
                    </div>
                    <Badge tone={customer.status === "合作中" ? "done" : "pending"}>{customer.status}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-[12px] border border-line px-3 py-2.5 text-center">
                        <div className="text-[11.5px] text-muted">累计订单</div>
                        <div className="tnum text-[20px] font-bold text-ink">
                            {orders.length} <i className="text-[12px] font-normal text-subtle not-italic">单</i>
                        </div>
                    </div>
                    <div className="rounded-[12px] border border-line px-3 py-2.5 text-center">
                        <div className="text-[11.5px] text-muted">已完成订单</div>
                        <div className="tnum text-[20px] font-bold text-success">
                            {orders.filter(order => order.outbound >= order.qty).length}
                            <i className="ml-1 text-[12px] font-normal not-italic">单</i>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-2 text-[13px]">
                    {[
                        ["联系人", customer.contact],
                        ["联系电话", customer.phone],
                        ["所在地区", `${customer.region} · ${customer.city}`],
                        ["详细地址", customer.address || "—"],
                        ["付款方式", customer.payTerms],
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
                    <div className="mb-2 text-[12.5px] font-semibold text-ink">最近动态</div>
                    <ol className="flex flex-col gap-2.5 border-l border-line pl-4">
                        {timeline.length === 0 && <li className="text-[12.5px] text-subtle">暂无订单动态。</li>}
                        {timeline.map(order => (
                            <li key={order.orderNo} className="relative">
                                <span className="absolute top-1.5 -left-5.25 h-2 w-2 rounded-full bg-primary" />
                                <div className="text-[12.5px] text-ink">
                                    新建订单{" "}
                                    <span className="tnum font-semibold text-primary-strong">{order.orderNo}</span> ·{" "}
                                    {order.qty.toLocaleString("zh-CN")} 件
                                </div>
                                <div className="tnum text-[11.5px] text-muted">{order.orderDate}</div>
                            </li>
                        ))}
                    </ol>
                </div>
                <button
                    type="button"
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(customer.phoneFull);
                            toast("完整手机号已复制");
                        } catch {
                            toast("复制失败，请从客户信息中选择号码复制", true);
                        }
                    }}
                    className="self-start rounded-[9px] border border-line-strong px-3 py-2 text-[12.5px] font-medium text-primary-strong hover:border-primary-border"
                >
                    复制完整手机号
                </button>
            </div>
        </Modal>
    );
}

export function CustomersPage() {
    const { can } = useApp();
    const { data, isLoading } = useWbSnapshot();
    const [searchParams, setSearchParams] = useSearchParams();
    const toast = useToast();
    const [statusFilter, setStatusFilter] = useState("全部状态");
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize] = useState(10);
    const [newOpen, setNewOpen] = useState(false);
    const [detail, setDetail] = useState<Customer | null>(null);

    const snap = data ?? EMPTY_SNAPSHOT;
    const customers = snap.customers;
    const orders = snap.orders;

    const rows = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return customers
            .filter(customer => {
                if (statusFilter !== "全部状态" && customer.status !== statusFilter) return false;
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
            setNewOpen(true);
            setSearchParams({}, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const reset = () => {
        setStatusFilter("全部状态");
        setKeyword("");
        setPage(1);
    };

    const canCreate = can("customers:create");

    return (
        <div className="flex flex-col gap-5">
            <PageHeading
                title="客户档案"
                actions={
                    canCreate ? (
                        <Button icon="plus" onClick={() => setNewOpen(true)}>
                            新建客户
                        </Button>
                    ) : undefined
                }
            />

            <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
                <div className="list-toolbar flex flex-wrap items-center gap-2.5 border-b border-line bg-gradient-to-b from-white to-[#fcfcfd] px-5 py-4">
                    <select
                        value={statusFilter}
                        onChange={event => {
                            setStatusFilter(event.target.value);
                            setPage(1);
                        }}
                        className="h-10 rounded-[10px] border border-line-strong bg-white px-3 text-[13px] text-ink"
                    >
                        {["全部状态", "合作中", "待跟进"].map(option => (
                            <option key={option}>{option}</option>
                        ))}
                    </select>
                    <label className="flex h-10 min-w-55 flex-1 items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 sm:max-w-75">
                        <Icon name="search" size={15} className="text-subtle" />
                        <input
                            value={keyword}
                            onChange={event => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                            placeholder="搜索公司名称或编码"
                            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-subtle"
                        />
                    </label>

                    <ToolbarMore>
                        <Button variant="secondary" icon="refresh" data-low-priority="true" onClick={reset}>
                            重置
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
                                        `${row.customer.region} · ${row.customer.city}`,
                                        String(row.orderCount),
                                        String(row.pendingQty),
                                        row.customer.status,
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
                                subtitle={`${customer.code} · ${customer.region} ${customer.city}`}
                                badge={
                                    <Badge tone={customer.status === "合作中" ? "success" : "pending"}>
                                        {customer.status}
                                    </Badge>
                                }
                                actions={
                                    <>
                                        <a
                                            className="inline-flex min-h-11 items-center rounded-btn border border-line px-3 text-primary"
                                            href={`tel:${customer.phoneFull}`}
                                        >
                                            联系客户
                                        </a>
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
                        <div className="py-16 text-center text-[13px] text-subtle">加载中…</div>
                    ) : (
                        <table className="w-full min-w-240 border-collapse">
                            <thead>
                                <tr className="bg-[#f8fafc] text-left text-[12px] text-muted">
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
                                        <td colSpan={8} className="px-5 py-14 text-center text-[13px] text-subtle">
                                            没有找到匹配的客户
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
                                                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${AVATAR_TONES[index % AVATAR_TONES.length]}`}
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
                                        <td className="px-3 py-3 text-[13px] text-td">{row.customer.contact}</td>
                                        <td className="px-3 py-3">
                                            <span className="flex items-center gap-1.5">
                                                <span className="tnum text-[13px] text-td">{row.customer.phone}</span>
                                                <button
                                                    type="button"
                                                    aria-label="复制完整手机号"
                                                    onClick={() => {
                                                        void navigator.clipboard?.writeText(row.customer.phoneFull);
                                                        toast("完整手机号已复制");
                                                    }}
                                                    className="rounded-[6px] p-1 text-subtle transition hover:bg-primary-soft hover:text-primary"
                                                >
                                                    <Icon name="copy" size={13} />
                                                </button>
                                            </span>
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className="flex items-center gap-1.5 text-[13px] text-td">
                                                <Icon name="location" size={14} className="text-subtle" />
                                                {row.customer.region} · {row.customer.city}
                                            </span>
                                        </td>
                                        <td className="px-3 py-3 text-[13px] text-td tnum">
                                            {row.orderCount} 单
                                            {row.pendingQty > 0 ? (
                                                <span className="text-muted">
                                                    {" "}
                                                    · 待交 {row.pendingQty.toLocaleString("zh-CN")}
                                                </span>
                                            ) : null}
                                        </td>
                                        <td className="px-3 py-3 tnum text-[13px] text-td">{row.lastOrderDate}</td>
                                        <td className="px-3 py-3">
                                            <Badge tone={row.customer.status === "合作中" ? "done" : "pending"}>
                                                {row.customer.status}
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

                <div className="border-t border-line px-5 py-3.5 text-[12.5px] text-muted">共 {rows.length} 家客户</div>
            </section>

            {canCreate && <NewCustomerModal open={newOpen} onClose={() => setNewOpen(false)} />}
            <CustomerDetailModal customer={detail} snap={snap} onClose={() => setDetail(null)} />
        </div>
    );
}

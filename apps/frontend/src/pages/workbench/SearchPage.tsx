import { useState } from "react";
import { useSearchParams } from "react-router";
import { useWbSnapshot } from "@/data/queries";
import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useDelayedFlag } from "@/components/ui/useDelayedFlag";
import { useApp } from "@/context/useApp";
import { Button } from "@/components/ui/Badge";
import { ListState, OrderTaskCard, RecordCard } from "@/components/ui/MobileList";
import { PageHeading } from "@/components/ui/PageHeading";
import { Icon } from "@/lib/icons";
import { OrderDetailModal } from "@/pages/orders/OrdersPage";
import { CustomerDetailModal } from "@/pages/customers/CustomersPage";
import { BomDetailModal } from "@/pages/bom/BomPage";
import { OutboundModal } from "@/pages/outbound/OutboundPage";
import { EMPTY_SNAPSHOT, bomByCode } from "@/data/views";

export function SearchPage() {
    const { data, isLoading, isFetching } = useWbSnapshot();
    // 顶栏全局刷新时此处同步出现保留式遮罩(200ms 内完成不闪现)
    const overlay = useDelayedFlag(isFetching && !isLoading);
    const snap = data ?? EMPTY_SNAPSHOT;
    const { can, grant } = useApp();
    const [params, setParams] = useSearchParams();
    const query = params.get("q") ?? "";
    const [category, setCategory] = useState("orders");
    const [limit, setLimit] = useState(10);
    const [selected, setSelected] = useState<{ kind: string; id: string } | null>(null);
    const [ship, setShip] = useState<string | null>(null);
    const keyword = query.trim().toLowerCase();

    // 类目按菜单授权过滤：客户档案等未授权模块不出现在搜索结果
    const categories = [
        { key: "orders", label: "订单", menu: "orders" },
        { key: "customers", label: "客户", menu: "customers" },
        { key: "boms", label: "产品", menu: "bom" },
    ].filter(item => grant.menus.includes(item.menu));
    const effectiveCategory = categories.some(item => item.key === category)
        ? category
        : (categories[0]?.key ?? "orders");

    // 归档单已分流到「归档订单」页，全局搜索不返回（口径与销售订单列表一致）
    const orders = snap.orders.filter(
        order =>
            order.lifecycleStatus !== "archived" &&
            `${order.orderNo} ${order.customer} ${order.customerCode} ${order.bomCode} ${bomByCode(snap, order.bomCode)?.spec}`
                .toLowerCase()
                .includes(keyword),
    );
    const customers = snap.customers.filter(customer =>
        `${customer.name} ${customer.code} ${customer.contact} ${customer.phone} ${customer.province}${customer.city}${customer.district}${customer.town}`
            .toLowerCase()
            .includes(keyword),
    );
    const boms = snap.boms.filter(bom => `${bom.code} ${bom.name} ${bom.spec}`.toLowerCase().includes(keyword));
    const count =
        effectiveCategory === "orders"
            ? orders.length
            : effectiveCategory === "customers"
              ? customers.length
              : boms.length;
    const order = data?.orders.find(item => selected?.kind === "orders" && item.orderNo === selected.id) ?? null;
    return (
        <div className="relative flex flex-col gap-4">
            {overlay && <LoadingOverlay />}
            <PageHeading title="搜索" description="查找订单、客户和成品，直接查看详情或处理。" />
            <label className="flex min-h-12.5 items-center gap-3 rounded-xl border border-line-strong bg-surface px-4">
                <Icon name="search" size={20} />
                <input
                    aria-label="搜索订单、客户、产品"
                    type="search"
                    autoFocus
                    value={query}
                    onChange={event => {
                        setParams(event.target.value ? { q: event.target.value } : {}, {
                            replace: true,
                        });
                        setLimit(10);
                    }}
                    placeholder="订单号、客户名、产品编码或规格"
                    className="min-w-0 flex-1 bg-transparent text-16 outline-none"
                />
            </label>
            {!keyword ? (
                <div className="rounded-panel border border-line bg-surface p-6">
                    <h2 className="text-17 font-semibold">想找什么？</h2>
                    <p className="mt-2 text-muted">输入客户名称、订单号或产品规格。搜索覆盖全部记录。</p>
                </div>
            ) : (
                <>
                    <div className="task-tabs">
                        {categories.map(item => {
                            const itemCount =
                                item.key === "orders"
                                    ? orders.length
                                    : item.key === "customers"
                                      ? customers.length
                                      : boms.length;
                            return (
                                <button
                                    type="button"
                                    key={item.key}
                                    aria-pressed={effectiveCategory === item.key}
                                    onClick={() => {
                                        setCategory(item.key);
                                        setLimit(10);
                                    }}
                                >
                                    {item.label} {itemCount}
                                </button>
                            );
                        })}
                    </div>
                    <p role="status" className="text-13 text-muted">
                        找到 {count} 条{count > limit ? `，当前显示 ${limit} 条` : ""}
                    </p>
                    <div className="grid gap-3 lg:grid-cols-2">
                        <ListState loading={isLoading} empty={!count}>
                            {effectiveCategory === "orders" &&
                                orders
                                    .slice(0, limit)
                                    .map(item => (
                                        <OrderTaskCard
                                            key={item.orderNo}
                                            order={item}
                                            snap={snap}
                                            onDetail={() => setSelected({ kind: "orders", id: item.orderNo })}
                                            onShip={can("outbound:ship") ? () => setShip(item.orderNo) : undefined}
                                        />
                                    ))}
                            {effectiveCategory === "customers" &&
                                customers.slice(0, limit).map(item => (
                                    <RecordCard
                                        key={item.code}
                                        title={item.name}
                                        subtitle={item.code}
                                        actions={
                                            <Button onClick={() => setSelected({ kind: "customers", id: item.code })}>
                                                查看客户
                                            </Button>
                                        }
                                    >
                                        <p>
                                            {item.contact} · {item.phone}
                                        </p>
                                    </RecordCard>
                                ))}
                            {effectiveCategory === "boms" &&
                                boms.slice(0, limit).map(item => (
                                    <RecordCard
                                        key={item.code}
                                        title={item.name}
                                        subtitle={item.code}
                                        actions={
                                            <Button onClick={() => setSelected({ kind: "boms", id: item.code })}>
                                                查看规格
                                            </Button>
                                        }
                                    >
                                        <p>{item.spec}</p>
                                    </RecordCard>
                                ))}
                        </ListState>
                    </div>
                    {count > limit && (
                        <Button variant="secondary" onClick={() => setLimit(value => value + 10)}>
                            加载更多
                        </Button>
                    )}
                </>
            )}
            <OrderDetailModal
                order={order}
                snap={snap}
                onClose={() => setSelected(null)}
                onShip={
                    can("outbound:ship") && order
                        ? () => {
                              setShip(order.orderNo);
                              setSelected(null);
                          }
                        : undefined
                }
            />
            <CustomerDetailModal
                customer={
                    data?.customers.find(item => selected?.kind === "customers" && item.code === selected.id) ?? null
                }
                snap={snap}
                onClose={() => setSelected(null)}
            />
            <BomDetailModal
                categories={snap.bomCategories}
                bom={data?.boms.find(item => selected?.kind === "boms" && item.code === selected.id) ?? null}
                onClose={() => setSelected(null)}
            />
            {ship !== null && <OutboundModal open initialOrderNo={ship} onClose={() => setShip(null)} />}
        </div>
    );
}

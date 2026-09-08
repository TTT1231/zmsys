import { useState } from "react";
import { useSearchParams } from "react-router";
import { useWbSnapshot } from "../../data/queries";
import { useApp } from "../../context/AppContext";
import { Button } from "../../components/ui/Badge";
import {
  ListState,
  OrderTaskCard,
  RecordCard,
} from "../../components/ui/MobileList";
import { PageHeading } from "../../components/ui/PageHeading";
import { Icon } from "../../lib/icons";
import { OrderDetailModal } from "../orders/OrdersPage";
import { CustomerDetailModal } from "../customers/CustomersPage";
import { BomDetailModal } from "../bom/BomPage";
import { OutboundModal } from "../outbound/OutboundPage";
import { store } from "../../data/store";

export function SearchPage() {
  const { data, isLoading } = useWbSnapshot();
  const { can, grant } = useApp();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [category, setCategory] = useState("orders");
  const [limit, setLimit] = useState(10);
  const [selected, setSelected] = useState<{ kind: string; id: string } | null>(
    null,
  );
  const [ship, setShip] = useState<string | null>(null);
  const keyword = query.trim().toLowerCase();

  // 类目按菜单授权过滤：客户档案等未授权模块不出现在搜索结果
  const categories = [
    { key: "orders", label: "订单", menu: "orders" },
    { key: "customers", label: "客户", menu: "customers" },
    { key: "boms", label: "产品", menu: "bom" },
  ].filter((item) => grant.menus.includes(item.menu));
  const effectiveCategory = categories.some((item) => item.key === category)
    ? category
    : (categories[0]?.key ?? "orders");

  const orders = (data?.orders ?? []).filter((order) =>
    `${order.orderNo} ${order.customer} ${order.customerCode} ${order.bomCode} ${store.bomByCode(order.bomCode)?.spec}`
      .toLowerCase()
      .includes(keyword),
  );
  const customers = (data?.customers ?? []).filter((customer) =>
    `${customer.name} ${customer.code} ${customer.contact} ${customer.phoneFull}`
      .toLowerCase()
      .includes(keyword),
  );
  const boms = (data?.boms ?? []).filter((bom) =>
    `${bom.code} ${bom.name} ${bom.spec}`
      .toLowerCase()
      .includes(keyword),
  );
  const count =
    effectiveCategory === "orders"
      ? orders.length
      : effectiveCategory === "customers"
        ? customers.length
        : boms.length;
  const order =
    data?.orders.find(
      (item) => selected?.kind === "orders" && item.orderNo === selected.id,
    ) ?? null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title="搜索"
        description="查找订单、客户和成品，直接查看详情或处理。"
      />
      <label className="flex min-h-[50px] items-center gap-3 rounded-[12px] border border-line-strong bg-white px-4">
        <Icon name="search" size={20} />
        <input
          aria-label="搜索订单、客户、产品"
          type="search"
          autoFocus
          value={query}
          onChange={(event) => {
            setParams(event.target.value ? { q: event.target.value } : {}, {
              replace: true,
            });
            setLimit(10);
          }}
          placeholder="订单号、客户名、产品编码或规格"
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
        />
      </label>
      {!keyword ? (
        <div className="rounded-panel border border-line bg-white p-6">
          <h2 className="text-[17px] font-semibold">想找什么？</h2>
          <p className="mt-2 text-muted">
            输入客户名称、订单号或产品规格。搜索覆盖全部记录。
          </p>
        </div>
      ) : (
        <>
          <div className="task-tabs">
            {categories.map((item) => {
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
          <p role="status" className="text-[13px] text-muted">
            找到 {count} 条{count > limit ? `，当前显示 ${limit} 条` : ""}
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            <ListState loading={isLoading} empty={!count}>
              {effectiveCategory === "orders" &&
                orders
                  .slice(0, limit)
                  .map((item) => (
                    <OrderTaskCard
                      key={item.orderNo}
                      order={item}
                      onDetail={() =>
                        setSelected({ kind: "orders", id: item.orderNo })
                      }
                      onShip={
                        can("outbound:ship")
                          ? () => setShip(item.orderNo)
                          : undefined
                      }
                    />
                  ))}
              {effectiveCategory === "customers" &&
                customers.slice(0, limit).map((item) => (
                  <RecordCard
                    key={item.code}
                    title={item.name}
                    subtitle={item.code}
                    actions={
                      <Button
                        onClick={() =>
                          setSelected({ kind: "customers", id: item.code })
                        }
                      >
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
                boms.slice(0, limit).map((item) => (
                  <RecordCard
                    key={item.code}
                    title={`${item.name} · ${item.seriesLabel}`}
                    subtitle={item.code}
                    actions={
                      <Button
                        onClick={() =>
                          setSelected({ kind: "boms", id: item.code })
                        }
                      >
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
            <Button
              variant="secondary"
              onClick={() => setLimit((value) => value + 10)}
            >
              加载更多
            </Button>
          )}
        </>
      )}
      <OrderDetailModal
        order={order}
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
          data?.customers.find(
            (item) =>
              selected?.kind === "customers" && item.code === selected.id,
          ) ?? null
        }
        onClose={() => setSelected(null)}
      />
      <BomDetailModal
        bom={
          data?.boms.find(
            (item) => selected?.kind === "boms" && item.code === selected.id,
          ) ?? null
        }
        onClose={() => setSelected(null)}
      />
      {ship !== null && (
        <OutboundModal
          open
          initialOrderNo={ship}
          onClose={() => setShip(null)}
        />
      )}
    </div>
  );
}

import { ToolbarMore } from "../../components/ui/ToolbarMore";
import { useApp } from "../../context/AppContext";
import { ListState, OrderTaskCard } from "../../components/ui/MobileList";
import { OutboundModal } from "../outbound/OutboundPage";
import { useState } from "react";
import { Icon } from "../../lib/icons";
import { downloadCsv, num } from "../../lib/format";
import { PageHeading } from "../../components/ui/PageHeading";
import {
  Button,
  ProgressTrack,
  StatusBadge,
  TableLink,
} from "../../components/ui/Badge";
import { Pagination } from "../../components/ui/Pagination";
import { Modal } from "../../components/ui/Modal";
import { CustomerCell, DateCell, QtyCell } from "../../components/ui/cells";
import { useWbSnapshot } from "../../data/queries";
import { maxShipOf, store } from "../../data/store";
import type { Order } from "../../data/types";

const STATUS_OPTIONS = ["全部状态", "待备货", "可发货", "部分发货", "已完成"];

function RequirementModal({
  order,
  onClose,
}: {
  order: Order | null;
  onClose: () => void;
}) {
  if (!order) return null;
  const bom = store.bomByCode(order.bomCode);
  const remaining = store.remainingOf(order);
  return (
    <Modal
      open={!!order}
      onClose={onClose}
      label="制造要求"
      title={order.orderNo}
      subtitle={`${order.customer} · ${order.customerCode}`}
      width={520}
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
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="rounded-[10px] bg-primary-soft/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-primary-strong">
          {bom?.spec}
        </p>
        {[
          ["成品编码", bom?.productCode || ""],
          ["订单数量", `${num(order.qty)} 件`],
          ["累计出库", `${num(order.outbound)} 件`],
          ["剩余待交付", `${num(remaining)} 件`],
          ["下单日期", order.orderDate],
          ["交货日期", order.deliverDate],
          ["订单备注", order.remark || "—"],
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
    </Modal>
  );
}

export function ProductionPage() {
  const { role } = useApp();
  const [ship, setShip] = useState<string | null>(null);
  const { data, isLoading } = useWbSnapshot();
  const [statusFilter, setStatusFilter] = useState(
    role === "warehouse" ? "可发货" : "全部状态",
  );
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [requirement, setRequirement] = useState<Order | null>(null);

  const orders = data?.orders ?? [];

  const filtered = (() => {
    const kw = keyword.trim().toLowerCase();
    return orders
      .filter((order) => {
        if (
          statusFilter === "可发货"
            ? maxShipOf(order.orderNo) <= 0
            : statusFilter !== "全部状态" &&
              store.orderStatusOf(order).label !== statusFilter
        )
          return false;
        if (
          kw &&
          !`${order.orderNo} ${order.customer}`.toLowerCase().includes(kw)
        )
          return false;
        return true;
      })
      .sort((a, b) =>
        role === "warehouse"
          ? a.deliverDate.localeCompare(b.deliverDate) ||
            a.orderNo.localeCompare(b.orderNo)
          : 0,
      );
  })();

  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        title={role === "warehouse" ? "待发货订单" : "生产与交付"}
        description="查看交期与成品规格，按可发数量安排交付。"
      />

      <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
        <div className="list-toolbar flex flex-wrap items-center gap-2.5 border-b border-line bg-gradient-to-b from-white to-[#fcfcfd] px-5 py-4">
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
            className="h-10 rounded-[10px] border border-line-strong bg-white px-3 text-[13px] text-ink"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
          <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 sm:max-w-[300px]">
            <Icon name="search" size={15} className="text-subtle" />
            <input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setPage(1);
              }}
              placeholder="输入订单号或客户名搜索"
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-subtle"
            />
          </label>

          <ToolbarMore>
            <Button
              variant="secondary"
              icon="refresh"
              data-low-priority="true"
              onClick={() => {
                setStatusFilter("全部状态");
                setKeyword("");
                setPage(1);
              }}
            >
              重置
            </Button>
            <Button
              variant="secondary"
              icon="download"
              data-low-priority="true"
              onClick={() =>
                downloadCsv(
                  "生产与交付",
                  ["订单", "客户", "交期", "待交数量", "可发数量"],
                  filtered.map((order) => [
                    order.orderNo,
                    order.customer,
                    order.deliverDate,
                    String(store.remainingOf(order)),
                    String(maxShipOf(order.orderNo)),
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
            {pageRows.map((order) => (
              <OrderTaskCard
                key={order.orderNo}
                order={order}
                onDetail={() => setRequirement(order)}
                onShip={
                  role !== "sales" ? () => setShip(order.orderNo) : undefined
                }
              />
            ))}
          </ListState>
        </div>
        <div className="hidden overflow-x-auto lg:block">
          {isLoading ? (
            <div className="py-16 text-center text-[13px] text-subtle">
              加载中…
            </div>
          ) : (
            <table className="w-full min-w-[1000px] border-collapse">
              <thead>
                <tr className="bg-[#f8fafc] text-left text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-semibold">销售订单号</th>
                  <th className="px-3 py-2.5 font-semibold">客户</th>
                  <th className="px-3 py-2.5 font-semibold">成品方案</th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    订单数量
                  </th>
                  <th className="px-3 py-2.5 font-semibold">交付情况</th>
                  <th className="px-3 py-2.5 font-semibold">交货日期</th>
                  <th className="px-3 py-2.5 font-semibold">交付状态</th>
                  <th className="px-5 py-2.5 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-5 py-14 text-center text-[13px] text-subtle"
                    >
                      没有找到匹配的订单
                    </td>
                  </tr>
                )}
                {pageRows.map((order) => {
                  const bom = store.bomByCode(order.bomCode);
                  const status = store.orderStatusOf(order);
                  const remaining = store.remainingOf(order);
                  const done = remaining === 0;
                  return (
                    <tr
                      key={order.orderNo}
                      className="border-t border-line/70 transition hover:bg-row-hover"
                    >
                      <td className="px-5 py-3">
                        <div className="tnum text-[13px] font-semibold text-[#475467]">
                          {order.orderNo}
                        </div>
                        <div className="tnum mt-0.5 text-[11.5px] text-muted">
                          下单 {order.orderDate}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <CustomerCell
                          name={order.customer}
                          sub={order.customerCode}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <span className="block text-[12.5px] font-medium text-td">
                          {bom?.seriesLabel} {bom?.modelCode} · {bom?.gear}
                        </span>
                        <span className="mt-0.5 block tnum text-[11.5px] text-primary-strong">
                          {bom?.productCode}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <QtyCell value={order.qty} unit="件" />
                      </td>
                      <td className="px-3 py-3">
                        <div className="tnum text-[12.5px] text-td">
                          {num(order.outbound)} / {num(order.qty)} 件
                        </div>
                        <div className="mt-1">
                          <ProgressTrack
                            value={
                              order.qty === 0 ? 0 : order.outbound / order.qty
                            }
                            done={done}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <DateCell
                          date={order.deliverDate}
                          overdue={order.deliverDate < "2026-09-07" && !done}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={status.key} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-3">
                          <TableLink onClick={() => setRequirement(order)}>
                            {done ? "查看详情" : "查看要求"}
                          </TableLink>
                          {role !== "sales" && maxShipOf(order.orderNo) > 0 && (
                            <TableLink onClick={() => setShip(order.orderNo)}>
                              登记发货
                            </TableLink>
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
          />
        </div>
      </section>

      {ship !== null && (
        <OutboundModal
          open
          initialOrderNo={ship}
          onClose={() => setShip(null)}
        />
      )}
      <RequirementModal
        order={requirement}
        onClose={() => setRequirement(null)}
      />
    </div>
  );
}

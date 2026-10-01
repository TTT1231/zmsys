import { DataTable } from "@/components/ui/DataTable";
import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListToolbar } from "@/components/ui/ListToolbar";
import { ToolbarSelect } from "@/components/ui/ToolbarSelect";
import { DateRangeFilter } from "@/components/ui/DateRangeFilter";
import { ListState, OrderTaskCard } from "@/components/ui/MobileList";
import { EmptyRow } from "@/components/ui/EmptyRow";
import { DeliveryCell } from "@/components/business/DeliveryCell";
import { BomCell } from "@/components/bom/BomCell";
import { OrderDetailModal } from "@/pages/orders/OrdersPage";
import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/date";
import { num } from "@/lib/format";
import { useTableControls } from "@/lib/useTableControls";
import { useWbRefresh, useWbView } from "@/data/queries";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { Button, StatusBadge, TableLink } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { CustomerCell, DateCell, QtyCell } from "@/components/ui/cells";
import { SortTh } from "@/components/ui/SortTh";
import { MobileSortSelect } from "@/components/ui/MobileSortSelect";
import { nextSortState, type SortState } from "@/lib/tableSort";
import { SnapProvider } from "@/context/snap";
import { deriveOrders, orderStatusOfMax } from "@/data/views";
import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { PageLoading } from "@/components/ui/PageLoading";
import type { Order } from "@/api";

/* 归档状态筛选：与销售订单口径一致（按 label 全等比较）；归档 = 结案标记，
 * 状态徽章直接展示交付进度（已完成/部分发货），无"取消后归档"等专属形态 */
const STATUS_OPTIONS = ["全部状态", "已完成", "部分发货"];

/* 可排序列：订单号 / 数量 / 交期 / 归档时间；桌面表头与移动端排序下拉共用 */
type ArchivedSortKey = "orderNo" | "qty" | "deliverDate" | "archivedAt";
const SORT_COLUMNS: Array<{ key: ArchivedSortKey; label: string }> = [
    { key: "orderNo", label: "销售订单号" },
    { key: "qty", label: "订单数量" },
    { key: "deliverDate", label: "交货日期" },
    { key: "archivedAt", label: "归档时间" },
];

/** 归档订单：终态存档仅供查询（编辑/发货/取消入口均不提供），归档人与时间见详情 */
export function ArchivedOrdersPage() {
    const { snap, isLoading, refreshing: overlay } = useWbView();
    const { refresh } = useWbRefresh();
    const [statusFilter, setStatusFilter] = useState("全部状态");
    const [dateStart, setDateStart] = useState("");
    const [dateEnd, setDateEnd] = useState("");
    const [sort, setSort] = useState<SortState<ArchivedSortKey>>({ key: "archivedAt", dir: "desc" });
    const { keyword, setKeyword, onKeywordChange, page, setPage, pageSize, onPageSizeChange, tableScrollRef } =
        useTableControls({ resetKey: sort });
    const [detail, setDetail] = useState<Order | null>(null);

    /* 只展示归档单；排序默认按归档时间倒序（近期的在前） */
    const archived = useMemo(() => snap.orders.filter(order => order.lifecycleStatus === "archived"), [snap.orders]);

    /* P2 一次分配：状态筛选/行渲染/卡片与详情弹窗共用页面级派生（归档单 remainingOf=0
     * 不在分配行内，byOrderNo 未命中 → 可发 0，状态回落交付进度口径，与逐单派生完全一致） */
    const derived = useMemo(() => deriveOrders(snap), [snap]);

    const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return archived.filter(order => {
            if (statusFilter !== "全部状态") {
                const status = derived.byOrderNo.get(order.orderNo)?.status ?? orderStatusOfMax(order, 0);
                if (status.label !== statusFilter) return false;
            }
            if (dateStart && order.deliverDate < dateStart) return false;
            if (dateEnd && order.deliverDate > dateEnd) return false;
            if (kw) {
                const bom = derived.bomIndex.get(order.bomCode);
                const text =
                    `${order.orderNo} ${order.customer} ${order.customerCode} ${order.bomCode} ${bom?.spec ?? ""} ${order.archivedBy ?? ""}`.toLowerCase();
                if (!text.includes(kw)) return false;
            }
            return true;
        });
    }, [archived, keyword, statusFilter, dateStart, dateEnd, derived]);

    const sorted = useMemo(() => {
        const factor = sort.dir === "asc" ? 1 : -1;
        return [...filtered].sort((a, b) => {
            const byKey =
                sort.key === "qty"
                    ? a.qty - b.qty
                    : sort.key === "deliverDate"
                      ? a.deliverDate.localeCompare(b.deliverDate)
                      : sort.key === "archivedAt"
                        ? (a.archivedAt ?? "").localeCompare(b.archivedAt ?? "")
                        : a.orderNo.localeCompare(b.orderNo);
            return byKey * factor || a.orderNo.localeCompare(b.orderNo);
        });
    }, [filtered, sort]);

    const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
    const dateFilterActive = !!dateStart || !!dateEnd;
    const filtersActive = dateFilterActive || !!keyword.trim() || statusFilter !== "全部状态";

    const applySort = (key: ArchivedSortKey) => setSort(current => nextSortState(current, key));

    const clearFilters = () => {
        setKeyword("");
        setStatusFilter("全部状态");
        setDateStart("");
        setDateEnd("");
        setPage(1);
    };

    return (
        <SnapProvider snap={snap}>
            <div className="flex flex-col gap-5">
                <h1 className="sr-only">归档订单</h1>

                <section className="relative overflow-hidden rounded-panel border border-line bg-surface/97 shadow-card">
                    {overlay && <LoadingOverlay />}
                    <ListToolbar
                        keyword={keyword}
                        onKeywordChange={onKeywordChange}
                        placeholder="客户名 / 订单号 / BOM / 归档人"
                        onClear={clearFilters}
                        filtersActive={filtersActive}
                        trailing={
                            <>
                                <span className="ml-auto text-13 text-muted">共 {num(filtered.length)} 条归档</span>
                                <TableHeaderActions>
                                    <ToolbarMore>
                                        <Button variant="secondary" icon="refresh" onClick={refresh}>
                                            刷新
                                        </Button>
                                    </ToolbarMore>
                                </TableHeaderActions>
                            </>
                        }
                    >
                        <ToolbarSelect
                            value={statusFilter}
                            onChange={value => {
                                setStatusFilter(value);
                                setPage(1);
                            }}
                            label="按归档前状态筛选"
                            options={STATUS_OPTIONS}
                        />
                        <MobileSortSelect
                            columns={SORT_COLUMNS}
                            value={sort}
                            onChange={next => {
                                if (next) setSort(next);
                            }}
                        />
                        <DateRangeFilter
                            start={dateStart}
                            end={dateEnd}
                            onChange={next => {
                                setDateStart(next.start);
                                setDateEnd(next.end);
                                setPage(1);
                            }}
                        />
                    </ListToolbar>

                    <div className="mobile-records">
                        <ListState loading={isLoading} empty={!pageRows.length}>
                            {pageRows.map(order => (
                                <OrderTaskCard
                                    key={order.orderNo}
                                    order={order}
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
                            <DataTable
                                tableId="archived-orders"
                                defaultWidths={[140, 150, 260, 100, 115, 130, 155, 95, 150, 110, 105]}
                                recordCount={filtered.length}
                                identityColumn={0}
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
                                            width="11%"
                                        />
                                        <th style={{ width: "12%" }}>客户</th>
                                        <th style={{ width: "16%" }}>成品 / BOM</th>
                                        <SortTh
                                            label="订单数量"
                                            active={sort.key === "qty"}
                                            dir={sort.dir}
                                            onSort={() => applySort("qty")}
                                            width="7%"
                                        />
                                        <SortTh
                                            label="交货日期"
                                            active={sort.key === "deliverDate"}
                                            dir={sort.dir}
                                            onSort={() => applySort("deliverDate")}
                                            width="9%"
                                        />
                                        <th style={{ width: "11%" }}>交付情况</th>
                                        <SortTh
                                            label="归档时间"
                                            active={sort.key === "archivedAt"}
                                            dir={sort.dir}
                                            onSort={() => applySort("archivedAt")}
                                            width="11%"
                                        />
                                        <th style={{ width: "7%" }}>归档人</th>
                                        <th style={{ width: "9%" }}>归档备注</th>
                                        <th style={{ width: "8%" }}>状态</th>
                                        <th className="min-w-24 cell-pad-wide text-center" style={{ width: "10%" }}>
                                            操作
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.length === 0 && (
                                        <EmptyRow
                                            colSpan={11}
                                            description="暂无归档订单；在销售订单的编辑弹窗中归档发过货的订单（已完成或部分发货）后，会在这里显示"
                                        />
                                    )}
                                    {pageRows.map(order => {
                                        const bom = derived.bomIndex.get(order.bomCode);
                                        const status =
                                            derived.byOrderNo.get(order.orderNo)?.status ?? orderStatusOfMax(order, 0);
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
                                                    <CustomerCell name={order.customer} note={order.customerCode} />
                                                </td>
                                                <td>
                                                    <BomCell
                                                        categories={snap.bomCategories}
                                                        bom={bom}
                                                        bomCode={order.bomCode}
                                                    />
                                                </td>
                                                <td>
                                                    <QtyCell value={order.qty} />
                                                </td>
                                                <td>
                                                    <DateCell date={order.deliverDate} />
                                                </td>
                                                <DeliveryCell order={order} />
                                                <td>
                                                    <div className="text-13 text-muted">
                                                        {order.archivedAt ? formatDateTime(order.archivedAt) : "—"}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="text-13 text-muted">{order.archivedBy || "—"}</div>
                                                </td>
                                                <td>
                                                    <div
                                                        className="truncate text-13 text-muted"
                                                        title={order.archiveReason || ""}
                                                    >
                                                        {order.archiveReason || "—"}
                                                    </div>
                                                </td>
                                                <td>
                                                    <StatusBadge status={status.key} label={status.label} />
                                                </td>
                                                <td className="min-w-24 cell-pad-wide text-center whitespace-nowrap">
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
                            unit="条归档"
                            onPageChange={setPage}
                            onPageSizeChange={onPageSizeChange}
                        />
                    </div>
                </section>

                <OrderDetailModal
                    order={detail ? (archived.find(order => order.orderNo === detail.orderNo) ?? null) : null}
                    derived={derived}
                    onClose={() => setDetail(null)}
                />
            </div>
        </SnapProvider>
    );
}

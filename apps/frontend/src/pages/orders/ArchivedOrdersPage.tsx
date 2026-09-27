import { DataTable } from "@/components/ui/DataTable";
import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, OrderTaskCard } from "@/components/ui/MobileList";
import { EmptyRow } from "@/components/ui/EmptyRow";
import { BomCell } from "@/components/bom/BomCell";
import { OrderDetailModal } from "@/pages/orders/OrdersPage";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icons";
import { downloadCsv, num } from "@/lib/format";
import { useWbRefresh, useWbSnapshot } from "@/data/queries";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { Button, ProgressTrack, StatusBadge, TableLink } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { CustomerCell, DateCell, QtyCell } from "@/components/ui/cells";
import { SortTh } from "@/components/ui/SortTh";
import { MobileSortSelect } from "@/components/ui/MobileSortSelect";
import { nextSortState, type SortState } from "@/lib/tableSort";
import { Field } from "@/components/ui/Field";
import { EMPTY_SNAPSHOT, bomByCode, orderStatusOf, remainingOf } from "@/data/views";
import { formatDateTime } from "@/lib/date";
import { useDelayedFlag } from "@/components/ui/useDelayedFlag";
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

/* 交期筛选激活时在按钮上回显的简写日期（MM/DD） */
const shortDate = (isoDate: string) => `${isoDate.slice(5, 7)}/${isoDate.slice(8, 10)}`;

const datetimeOf = (iso: string) => new Date(iso).toLocaleString();

/** 归档订单：终态存档仅供查询（编辑/发货/取消入口均不提供），归档人与时间见详情 */
export function ArchivedOrdersPage() {
    const { data, isLoading, isFetching } = useWbSnapshot();
    const { refresh } = useWbRefresh();
    // 首载出替换式占位,后台刷新出保留式遮罩(200ms 内完成不闪现)
    const overlay = useDelayedFlag(isFetching && !isLoading);
    const snap = data ?? EMPTY_SNAPSHOT;
    const [keyword, setKeyword] = useState("");
    const [statusFilter, setStatusFilter] = useState("全部状态");
    const [dateStart, setDateStart] = useState("");
    const [dateEnd, setDateEnd] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [sort, setSort] = useState<SortState<ArchivedSortKey>>({ key: "archivedAt", dir: "desc" });
    const [detail, setDetail] = useState<Order | null>(null);

    /* 只展示归档单；排序默认按归档时间倒序（近期的在前） */
    const archived = useMemo(() => snap.orders.filter(order => order.lifecycleStatus === "archived"), [snap.orders]);

    const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return archived.filter(order => {
            if (statusFilter !== "全部状态" && orderStatusOf(snap, order).label !== statusFilter) return false;
            if (dateStart && order.deliverDate < dateStart) return false;
            if (dateEnd && order.deliverDate > dateEnd) return false;
            if (kw) {
                const bom = bomByCode(snap, order.bomCode);
                const text =
                    `${order.orderNo} ${order.customer} ${order.customerCode} ${order.bomCode} ${bom?.spec ?? ""} ${order.archivedBy ?? ""}`.toLowerCase();
                if (!text.includes(kw)) return false;
            }
            return true;
        });
    }, [archived, keyword, statusFilter, dateStart, dateEnd, snap]);

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
    const dateLabel =
        dateStart && dateEnd
            ? `交期：${shortDate(dateStart)}–${shortDate(dateEnd)}`
            : dateStart
              ? `交期：${shortDate(dateStart)} 起`
              : dateEnd
                ? `交期：至 ${shortDate(dateEnd)}`
                : "交期";

    const applySort = (key: ArchivedSortKey) => setSort(current => nextSortState(current, key));
    // 排序或翻页后行序变化，滚动区回到顶部，避免误以为排错行
    const tableScrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
    }, [page, sort]);

    const clearFilters = () => {
        setKeyword("");
        setStatusFilter("全部状态");
        setDateStart("");
        setDateEnd("");
        setPage(1);
    };

    return (
        <div className="flex flex-col gap-5">
            <h1 className="sr-only">归档订单</h1>

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
                            placeholder="客户名 / 订单号 / BOM / 归档人"
                            className="w-full bg-transparent text-14 text-ink outline-none placeholder:text-subtle"
                        />
                    </label>
                    <select
                        value={statusFilter}
                        onChange={event => {
                            setStatusFilter(event.target.value);
                            setPage(1);
                        }}
                        aria-label="按归档前状态筛选"
                        className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink"
                    >
                        {STATUS_OPTIONS.map(option => (
                            <option key={option}>{option}</option>
                        ))}
                    </select>
                    <MobileSortSelect
                        columns={SORT_COLUMNS}
                        value={sort}
                        onChange={next => {
                            if (next) setSort(next);
                        }}
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
                        {/* 移动端贴底弹层（同 Modal：scrim 关闭 + 顶圆角），宽屏锚定按钮右侧下拉 */}
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
                            <Field label="开始">
                                <input
                                    type="date"
                                    value={dateStart}
                                    onChange={event => {
                                        setDateStart(event.target.value);
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
                                        setPage(1);
                                    }}
                                    className="w-full rounded-input border border-line-strong px-2.5 py-2 text-14"
                                />
                            </Field>
                            <div className="flex gap-2">
                                {dateFilterActive && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDateStart("");
                                            setDateEnd("");
                                            setPage(1);
                                        }}
                                        className="min-h-10 flex-1 rounded-btn border border-line-strong bg-surface px-4 text-14 font-medium text-ink hover:border-primary-border"
                                    >
                                        清除
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}
                                    className="min-h-10 flex-1 rounded-btn bg-primary px-4 text-14 font-medium text-white hover:bg-primary-hover"
                                >
                                    完成筛选
                                </button>
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
                    <span className="ml-auto text-13 text-muted">共 {num(filtered.length)} 条归档</span>
                    <TableHeaderActions>
                        <ToolbarMore>
                            <Button variant="secondary" icon="refresh" onClick={refresh}>
                                刷新
                            </Button>
                            <Button
                                variant="secondary"
                                icon="download"
                                onClick={() =>
                                    downloadCsv(
                                        "归档订单",
                                        [
                                            "销售订单号",
                                            "客户",
                                            "客户编码",
                                            "BOM 编码",
                                            "订单数量",
                                            "交货日期",
                                            "累计出库",
                                            "创建人",
                                            "创建时间",
                                            "归档时间",
                                            "归档人",
                                            "归档备注",
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
                                            order.createdBy,
                                            formatDateTime(order.createdAt),
                                            order.archivedAt ? datetimeOf(order.archivedAt) : "",
                                            order.archivedBy ?? "",
                                            order.archiveReason ?? "",
                                            orderStatusOf(snap, order).label,
                                        ]),
                                    )
                                }
                            >
                                导出
                            </Button>
                        </ToolbarMore>
                    </TableHeaderActions>
                </div>

                <div className="mobile-records">
                    <ListState loading={isLoading} empty={!pageRows.length}>
                        {pageRows.map(order => (
                            <OrderTaskCard
                                key={order.orderNo}
                                order={order}
                                snap={snap}
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
                                    const bom = bomByCode(snap, order.bomCode);
                                    const status = orderStatusOf(snap, order);
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
                                            <td className="delivery-cell">
                                                {/* 已全部交付只留绿色满条（悬停 title 兜底语义），有欠量才展开明细 */}
                                                {order.outbound >= order.qty ? (
                                                    <div className="delivery-track" title="已全部交付">
                                                        <ProgressTrack value={1} done />
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="text-13 text-muted">
                                                            待交 <QtyCell value={remainingOf(order)} />
                                                        </div>
                                                        <div className="delivery-shipped tnum mt-0.5 text-12 text-muted">
                                                            已发 {num(order.outbound)} / {num(order.qty)}
                                                        </div>
                                                        <div className="delivery-track mt-1.5">
                                                            <ProgressTrack
                                                                value={order.qty === 0 ? 0 : order.outbound / order.qty}
                                                            />
                                                        </div>
                                                    </>
                                                )}
                                            </td>
                                            <td>
                                                <div className="text-13 text-muted">
                                                    {order.archivedAt ? datetimeOf(order.archivedAt) : "—"}
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
                        onPageSizeChange={size => {
                            setPageSize(size);
                            setPage(1);
                        }}
                    />
                </div>
            </section>

            <OrderDetailModal
                order={detail ? (archived.find(order => order.orderNo === detail.orderNo) ?? null) : null}
                snap={snap}
                onClose={() => setDetail(null)}
            />
        </div>
    );
}

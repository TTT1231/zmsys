import { DataTable } from "@/components/ui/DataTable";
import { ListToolbar } from "@/components/ui/ListToolbar";
import { ToolbarSelect } from "@/components/ui/ToolbarSelect";
import { SortTh } from "@/components/ui/SortTh";
import { nextSortState, type SortState } from "@/lib/tableSort";
import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, RecordCard, CardField } from "@/components/ui/MobileList";
import { EmptyRow } from "@/components/ui/EmptyRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { useMemo, useState } from "react";
import { num } from "@/lib/format";
import { useTableControls } from "@/lib/useTableControls";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { Button, TableLink } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { BomCell } from "@/components/bom/BomCell";
import { RemarkCell } from "@/components/ui/RemarkCell";
import { BomSpecs } from "@/components/bom/BomSpecs";
import { BomRemarkNote } from "@/components/bom/BomRemarkNote";
import { useBomCategories, useBomRefresh, useBomStockLedger, useBomStocks, useBoms } from "@/data/queries";
import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useDelayedFlag } from "@/components/ui/useDelayedFlag";
import { PageLoading } from "@/components/ui/PageLoading";
import type { Bom, BomCategory, StockFlowRow } from "@/api";

/* 可排序列：BOM 编码 / 库存数量；默认不排序，保持「有流水在前、后端新建置顶」的对齐顺序 */
type StockSortKey = "code" | "stock";

/** 库存行：BOM 建档快照（品类/备注/物料）+ v_bom_stock 余量 */
interface StockRow {
    code: string;
    name: string;
    remark: string;
    stock: number;
    bom: Bom;
}

const EMPTY_ROWS: StockRow[] = [];

/** BOM 备注：同构成不同备注 = 不同 BOM，沿用警示色突出工艺差异（同成品入库台账） */
function BomRemarkText({ remark }: { remark?: string }) {
    const text = remark?.trim();
    return text ? (
        <span className="wrap-break-word font-medium text-warning" title={text}>
            {text}
        </span>
    ) : (
        <span className="text-subtle">—</span>
    );
}

const FLOW_TYPE_LABEL: Record<StockFlowRow["type"], string> = {
    in: "入库",
    out: "出库",
    adjust: "调整",
};

/** 流水类型标签：入库绿 / 出库红 / 调整蓝，与数量列的正负配色同向 */
function FlowTypeTag({ type }: { type: StockFlowRow["type"] }) {
    const tone =
        type === "in"
            ? "bg-success-soft text-success"
            : type === "out"
              ? "bg-danger-soft text-danger"
              : "bg-accent-soft text-accent";
    return (
        <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-13 font-medium ${tone}`}>
            {FLOW_TYPE_LABEL[type]}
        </span>
    );
}

/** 库存流水详情：BOM 详情（凭证同款 record 版式）+ 备注警示条 + 统计卡 + 倒序流水（内部滚动、表头吸附），
 * 结余由后端逐笔累计；出库行客户名挂在单号下方，入库/调整没有客户不渲染占位 */
function StockLedgerModal({
    bom,
    categories,
    onClose,
}: {
    bom: Bom | null;
    categories?: BomCategory[];
    onClose: () => void;
}) {
    const ledgerQuery = useBomStockLedger(bom?.code ?? null);
    const ledger = ledgerQuery.data;
    /* 后端按业务日升序返回（结余正推），展示倒序：最新变动在上 */
    const flows = useMemo(() => (ledger ? [...ledger.flows].reverse() : []), [ledger]);
    const totalIn = useMemo(
        () => ledger?.flows.filter(flow => flow.type === "in").reduce((sum, flow) => sum + flow.qty, 0) ?? 0,
        [ledger],
    );
    const totalOut = useMemo(
        () => -(ledger?.flows.filter(flow => flow.type === "out").reduce((sum, flow) => sum + flow.qty, 0) ?? 0),
        [ledger],
    );
    /* 调整合计仅在非零时展示为第四张卡，避免大多数 BOM 出现无意义的 0 调整 */
    const totalAdjust = useMemo(
        () => ledger?.flows.filter(flow => flow.type === "adjust").reduce((sum, flow) => sum + flow.qty, 0) ?? 0,
        [ledger],
    );
    if (!bom) return null;
    return (
        <Modal
            open
            onClose={onClose}
            label="库存流水"
            title={bom.code}
            subtitle={bom.name}
            width={960}
            footer={
                <Button size="sm" variant="secondary" onClick={onClose}>
                    关闭
                </Button>
            }
        >
            <div className="flex flex-col gap-4">
                {/* 区块 1+2：BOM 详情（同入库凭证 record 版式）+ 备注警示条 */}
                <section aria-label="BOM 详情" className="min-w-0">
                    <h3 className="mb-2 text-14 font-semibold text-ink">BOM 详情</h3>
                    <BomSpecs bom={bom} layout="record" categories={categories} />
                    <BomRemarkNote remark={bom.remark} className="mt-3" />
                </section>
                <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: `repeat(${totalAdjust ? 4 : 3}, minmax(0, 1fr))` }}
                >
                    {/* 零值不带符号：-(0) 的负零经 toLocaleString 会渲染成 "-0"，拼出 "−-0" */}
                    <div className="rounded-btn border border-line bg-panel px-4.5 py-3.5">
                        <p className="text-14 text-muted">累计入库</p>
                        <p className="tnum mt-1 text-26 font-bold text-success">
                            {totalIn === 0 ? "0" : `+${num(totalIn)}`}
                        </p>
                    </div>
                    <div className="rounded-btn border border-line bg-panel px-4.5 py-3.5">
                        <p className="text-14 text-muted">累计出库</p>
                        <p className="tnum mt-1 text-26 font-bold text-danger">
                            {totalOut === 0 ? "0" : `−${num(Math.abs(totalOut))}`}
                        </p>
                    </div>
                    {totalAdjust !== 0 && (
                        <div className="rounded-btn border border-line bg-panel px-4.5 py-3.5">
                            <p className="text-14 text-muted">库存调整</p>
                            <p className="tnum mt-1 text-26 font-bold text-accent">
                                {totalAdjust > 0 ? "+" : "−"}
                                {num(Math.abs(totalAdjust))}
                            </p>
                        </div>
                    )}
                    <div className="rounded-btn border border-primary-border bg-primary-soft px-4.5 py-3.5">
                        <p className="text-14 text-muted">当前库存</p>
                        <p className="tnum mt-1 text-26 font-bold text-primary-strong">{num(ledger?.stockQty ?? 0)}</p>
                    </div>
                </div>
                {ledgerQuery.isError ? (
                    <EmptyState description="流水加载失败，请稍后重试" />
                ) : ledgerQuery.isLoading || !ledger ? (
                    <PageLoading className="py-10" />
                ) : flows.length === 0 ? (
                    <EmptyState description="暂无有效出入库流水" />
                ) : (
                    /* max-h + 内部滚动：流水多时不撑高弹窗，表头吸附在滚动区顶部；
                       窄屏横向滚动，列宽不被挤压 */
                    <section aria-label="库存流水" className="min-w-0">
                        <h3 className="text-14 font-semibold text-ink">有效库存流水</h3>
                        <p className="mb-2 mt-1 text-13 text-muted">已作废单据不计入库存，可在出入库台账查看。</p>
                        <div className="max-h-120 overflow-auto rounded-xl border border-line">
                            <table className="data-table w-full min-w-[780px] table-fixed border-separate border-spacing-0">
                                <thead>
                                    <tr className="text-left text-13 text-muted">
                                        <th style={{ width: "72px" }}>类型</th>
                                        <th style={{ width: "190px" }}>单号</th>
                                        <th style={{ width: "100px" }}>日期</th>
                                        <th style={{ width: "96px" }}>数量（个）</th>
                                        <th style={{ width: "96px" }}>库存（个）</th>
                                        <th style={{ width: "80px" }}>操作人</th>
                                        <th>备注</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {flows.map(flow => (
                                        <tr key={`${flow.type}-${flow.no}`}>
                                            <td>
                                                <FlowTypeTag type={flow.type} />
                                            </td>
                                            <td>
                                                {/* 单号 + 客户同行（baseline 对齐）：出库行不再两行堆叠抬高行高；
                                                    超长客户名截断，全文走 title */}
                                                <span className="flex min-w-0 items-baseline gap-2">
                                                    <span className="tnum shrink-0 text-14 font-medium text-td">
                                                        {flow.no}
                                                    </span>
                                                    {flow.type === "out" && flow.customer && (
                                                        <span
                                                            className="min-w-0 truncate text-13 text-muted"
                                                            title={flow.customer}
                                                        >
                                                            {flow.customer}
                                                        </span>
                                                    )}
                                                </span>
                                            </td>
                                            <td className="tnum text-14 text-muted">{flow.date}</td>
                                            <td
                                                className={`tnum text-14 font-semibold ${flow.qty >= 0 ? "text-success" : "text-danger"}`}
                                            >
                                                {flow.qty >= 0 ? "+" : "−"}
                                                {num(Math.abs(flow.qty))}
                                            </td>
                                            <td className="tnum text-14 font-semibold text-ink">{num(flow.balance)}</td>
                                            <td className="text-14 text-td">{flow.operator}</td>
                                            <td className="text-14 text-muted">{flow.remark || "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}
            </div>
        </Modal>
    );
}

export function StockPage() {
    const bomsQuery = useBoms();
    const categoriesQuery = useBomCategories();
    const stocksQuery = useBomStocks();
    const { refresh } = useBomRefresh();
    const isLoading = bomsQuery.isLoading || stocksQuery.isLoading;
    const isFetching = bomsQuery.isFetching || stocksQuery.isFetching;
    // 首载出替换式占位,后台刷新出保留式遮罩(200ms 内完成不闪现)
    const overlay = useDelayedFlag(isFetching && !isLoading);
    const [category, setCategory] = useState("全部品类");
    /* 已用完 = 余量为 0，未用完 = 余量不为 0 */
    const [statusFilter, setStatusFilter] = useState("全部状态");
    const [sort, setSort] = useState<SortState<StockSortKey> | null>(null);
    const { keyword, setKeyword, onKeywordChange, page, setPage, pageSize, onPageSizeChange, tableScrollRef } =
        useTableControls({ resetKey: sort });
    const [detail, setDetail] = useState<Bom | null>(null);

    const boms = bomsQuery.data;
    const bomByCode = useMemo(() => new Map((boms ?? []).map(bom => [bom.code, bom])), [boms]);

    /* 行 = 存在流水的 BOM（v_bom_stock 余量 map）；品类/备注/物料取建档快照 */
    const rows = useMemo<StockRow[]>(() => {
        const stockMap = stocksQuery.data;
        if (!stockMap) return EMPTY_ROWS;
        return Object.entries(stockMap).flatMap(([code, stock]) => {
            const bom = bomByCode.get(code);
            return bom ? [{ code, name: bom.name, remark: bom.remark, stock, bom }] : [];
        });
    }, [bomByCode, stocksQuery.data]);

    /* 品类选项取自当前有流水的行，不列无库存的品类，避免筛出空结果 */
    const categories = useMemo(() => [...new Set(rows.map(row => row.name))], [rows]);

    const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return rows.filter(
            row =>
                (category === "全部品类" || row.name === category) &&
                (statusFilter === "全部状态" || (row.stock === 0) === (statusFilter === "已用完")) &&
                (!kw || `${row.code} ${row.name} ${row.remark}`.toLowerCase().includes(kw)),
        );
    }, [rows, keyword, category, statusFilter]);

    const sorted = useMemo(() => {
        if (!sort) return filtered;
        const factor = sort.dir === "asc" ? 1 : -1;
        return [...filtered].sort((a, b) =>
            sort.key === "code" ? a.code.localeCompare(b.code) * factor : (a.stock - b.stock) * factor,
        );
    }, [filtered, sort]);
    const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);

    const clearFilters = () => {
        setKeyword("");
        setCategory("全部品类");
        setStatusFilter("全部状态");
        setPage(1);
    };
    const filtersActive = !!keyword.trim() || category !== "全部品类" || statusFilter !== "全部状态";

    return (
        <div className="flex flex-col gap-5">
            <h1 className="sr-only">库存</h1>

            <section className="relative overflow-hidden rounded-panel border border-line bg-surface/97 shadow-card">
                {overlay && <LoadingOverlay />}
                <ListToolbar
                    keyword={keyword}
                    onKeywordChange={onKeywordChange}
                    placeholder="BOM 编码 / 品类 / 备注"
                    onClear={clearFilters}
                    filtersActive={filtersActive}
                    trailing={
                        <TableHeaderActions className="ml-auto">
                            <ToolbarMore>
                                <Button variant="secondary" icon="refresh" onClick={refresh}>
                                    刷新
                                </Button>
                            </ToolbarMore>
                        </TableHeaderActions>
                    }
                >
                    <ToolbarSelect
                        value={category}
                        onChange={value => {
                            setCategory(value);
                            setPage(1);
                        }}
                        label="按品类筛选"
                        options={["全部品类", ...categories]}
                    />
                    <ToolbarSelect
                        value={statusFilter}
                        onChange={value => {
                            setStatusFilter(value);
                            setPage(1);
                        }}
                        label="按库存状态筛选"
                        options={["全部状态", "已用完", "未用完"]}
                    />
                </ListToolbar>

                <div className="mobile-records">
                    <ListState loading={isLoading} empty={!pageRows.length}>
                        {pageRows.map(row => (
                            <RecordCard
                                key={row.code}
                                title={row.code}
                                subtitle={row.name}
                                actions={
                                    <Button variant="secondary" onClick={() => setDetail(row.bom)}>
                                        查看详情
                                    </Button>
                                }
                            >
                                <div className="grid grid-cols-2 gap-2">
                                    <CardField label="BOM 备注" value={<BomRemarkText remark={row.remark} />} />
                                    <CardField label="当前库存" value={`${num(row.stock)} 个`} strong />
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
                            tableId="stock"
                            defaultWidths={[64, 110, 370, 330, 150, 104]}
                            recordCount={filtered.length}
                            identityColumn={2}
                            scrollRef={tableScrollRef}
                        >
                            <thead>
                                <tr className="text-left text-13 text-muted">
                                    <th className="cell-pad-wide">序号</th>
                                    <th>品类</th>
                                    <SortTh
                                        label="BOM 编码"
                                        active={sort?.key === "code"}
                                        dir={sort?.dir ?? "asc"}
                                        onSort={() =>
                                            setSort(current =>
                                                current ? nextSortState(current, "code") : { key: "code", dir: "asc" },
                                            )
                                        }
                                    />
                                    <th>BOM 备注</th>
                                    <SortTh
                                        label="库存数量（个）"
                                        active={sort?.key === "stock"}
                                        dir={sort?.dir ?? "asc"}
                                        onSort={() =>
                                            setSort(current =>
                                                current
                                                    ? nextSortState(current, "stock")
                                                    : { key: "stock", dir: "asc" },
                                            )
                                        }
                                    />
                                    <th className="cell-pad-wide text-center">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && (
                                    <EmptyRow
                                        colSpan={6}
                                        description={
                                            statusFilter === "全部状态"
                                                ? "暂无库存记录"
                                                : `没有${statusFilter}的库存记录`
                                        }
                                    />
                                )}
                                {pageRows.map((row, index) => (
                                    <tr key={row.code}>
                                        <td className="tnum cell-pad-wide text-14 text-muted">
                                            {(page - 1) * pageSize + index + 1}
                                        </td>
                                        <td className="text-14 text-td">{row.name}</td>
                                        <td>
                                            <BomCell
                                                categories={categoriesQuery.data}
                                                bom={row.bom}
                                                bomCode={row.code}
                                                showName={false}
                                            />
                                        </td>
                                        <td>
                                            <RemarkCell remark={row.remark} variant="warning" />
                                        </td>
                                        <td
                                            className={`tnum text-14 font-semibold ${row.stock === 0 ? "text-muted" : "text-ink"}`}
                                        >
                                            {num(row.stock)}
                                        </td>
                                        <td className="cell-pad-wide text-center">
                                            <TableLink onClick={() => setDetail(row.bom)}>查看详情</TableLink>
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
                        total={filtered.length}
                        unit="条 BOM"
                        onPageChange={setPage}
                        onPageSizeChange={onPageSizeChange}
                    />
                </div>
            </section>

            <StockLedgerModal bom={detail} categories={categoriesQuery.data} onClose={() => setDetail(null)} />
        </div>
    );
}

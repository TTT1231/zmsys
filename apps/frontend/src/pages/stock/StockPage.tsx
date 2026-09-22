import { DataTable } from "@/components/ui/DataTable";
import { SortTh } from "@/components/ui/SortTh";
import { nextSortState, type SortState } from "@/lib/tableSort";
import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, RecordCard, CardField } from "@/components/ui/MobileList";
import { EmptyState } from "@/components/ui/EmptyState";
import { useMemo, useRef, useState, useEffect } from "react";
import { Icon } from "@/lib/icons";
import { downloadCsv, num } from "@/lib/format";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { Button, TableLink } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { useBomRefresh, useBomStockLedger, useBomStocks, useBoms } from "@/data/queries";
import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useDelayedFlag } from "@/components/ui/useDelayedFlag";
import { PageLoading } from "@/components/ui/PageLoading";
import type { Bom, StockFlowRow } from "@/api";

/* 可排序列：BOM 编码 / 库存数量；默认不排序，保持「有流水在前、后端新建置顶」的对齐顺序 */
type StockSortKey = "code" | "stock";

/** 库存行：BOM 元数据（品类/备注）取建档快照，stock 为 v_bom_stock 余量 */
interface StockRow {
    code: string;
    name: string;
    remark: string;
    stock: number;
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
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-12 font-medium ${tone}`}>
            {FLOW_TYPE_LABEL[type]}
        </span>
    );
}

/** 库存流水详情：摘要卡 + 倒序流水（内部滚动、表头吸附），结余由后端逐笔累计 */
function StockLedgerModal({ bom, onClose }: { bom: Bom | null; onClose: () => void }) {
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
                <Button variant="secondary" onClick={onClose}>
                    关闭
                </Button>
            }
        >
            <div className="flex flex-col gap-4">
                <section
                    aria-label="BOM 备注"
                    className="rounded-input border border-dashed border-line-strong px-3.5 py-2.5"
                >
                    <span className="text-12 text-muted">BOM 备注：</span>
                    <BomRemarkText remark={bom.remark} />
                </section>
                <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: `repeat(${totalAdjust ? 4 : 3}, minmax(0, 1fr))` }}
                >
                    <div className="rounded-btn border border-line bg-panel px-4.5 py-3.5">
                        <p className="text-13 text-muted">累计入库</p>
                        <p className="tnum mt-1 text-26 font-bold text-success">+{num(totalIn)}</p>
                    </div>
                    <div className="rounded-btn border border-line bg-panel px-4.5 py-3.5">
                        <p className="text-13 text-muted">累计出库</p>
                        <p className="tnum mt-1 text-26 font-bold text-danger">−{num(totalOut)}</p>
                    </div>
                    {totalAdjust !== 0 && (
                        <div className="rounded-btn border border-line bg-panel px-4.5 py-3.5">
                            <p className="text-13 text-muted">库存调整</p>
                            <p className="tnum mt-1 text-26 font-bold text-accent">
                                {totalAdjust > 0 ? "+" : "−"}
                                {num(Math.abs(totalAdjust))}
                            </p>
                        </div>
                    )}
                    <div className="rounded-btn border border-primary-border bg-primary-soft px-4.5 py-3.5">
                        <p className="text-13 text-muted">当前库存</p>
                        <p className="tnum mt-1 text-26 font-bold text-primary-strong">{num(ledger?.stockQty ?? 0)}</p>
                    </div>
                </div>
                {ledgerQuery.isError ? (
                    <EmptyState description="流水加载失败，请稍后重试" />
                ) : ledgerQuery.isLoading || !ledger ? (
                    <PageLoading className="py-10" />
                ) : flows.length === 0 ? (
                    <EmptyState description="暂无出入库流水" />
                ) : (
                    /* max-h + 内部滚动：流水多时不撑高弹窗，表头吸附在滚动区顶部 */
                    <div className="max-h-105 overflow-y-auto rounded-input border border-line">
                        <table className="w-full table-fixed border-separate border-spacing-0">
                            <thead>
                                <tr className="sticky top-0 z-1 bg-soft text-left text-12.5 font-semibold text-muted shadow-[inset_0_-1px_0_var(--color-line-strong)]">
                                    <th className="px-3.5 py-2.5" style={{ width: "76px" }}>
                                        类型
                                    </th>
                                    <th className="px-3 py-2.5" style={{ width: "130px" }}>
                                        单号
                                    </th>
                                    <th className="px-3 py-2.5" style={{ width: "104px" }}>
                                        日期
                                    </th>
                                    <th className="px-3 py-2.5 text-right" style={{ width: "100px" }}>
                                        数量（个）
                                    </th>
                                    <th className="px-3 py-2.5 text-right" style={{ width: "100px" }}>
                                        结余（个）
                                    </th>
                                    <th className="px-3 py-2.5" style={{ width: "104px" }}>
                                        操作人
                                    </th>
                                    <th className="px-3.5 py-2.5">备注</th>
                                </tr>
                            </thead>
                            <tbody>
                                {flows.map(flow => (
                                    <tr
                                        key={`${flow.type}-${flow.no}`}
                                        className="border-b border-line last:border-b-0"
                                    >
                                        <td className="px-3.5 py-3.5">
                                            <FlowTypeTag type={flow.type} />
                                        </td>
                                        <td className="tnum px-3 py-3.5 text-14 font-medium text-td">{flow.no}</td>
                                        <td className="tnum px-3 py-3.5 text-14 text-muted">{flow.date}</td>
                                        <td
                                            className={`tnum px-3 py-3.5 text-right text-14 font-semibold ${flow.qty >= 0 ? "text-success" : "text-danger"}`}
                                        >
                                            {flow.qty >= 0 ? "+" : "−"}
                                            {num(Math.abs(flow.qty))}
                                        </td>
                                        <td className="tnum px-3 py-3.5 text-right text-14 font-semibold text-ink">
                                            {num(flow.balance)}
                                        </td>
                                        <td className="px-3 py-3.5 text-14 text-td">{flow.operator}</td>
                                        <td className="px-3.5 py-3.5 text-13 text-muted">{flow.remark || "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </Modal>
    );
}

export function StockPage() {
    const bomsQuery = useBoms();
    const stocksQuery = useBomStocks();
    const { refresh } = useBomRefresh();
    const isLoading = bomsQuery.isLoading || stocksQuery.isLoading;
    const isFetching = bomsQuery.isFetching || stocksQuery.isFetching;
    // 首载出替换式占位,后台刷新出保留式遮罩(200ms 内完成不闪现)
    const overlay = useDelayedFlag(isFetching && !isLoading);
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("全部品类");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [sort, setSort] = useState<SortState<StockSortKey> | null>(null);
    const [detail, setDetail] = useState<Bom | null>(null);

    /* 行 = 存在流水的 BOM（v_bom_stock 余量 map）；品类/备注取建档快照 */
    const rows = useMemo<StockRow[]>(() => {
        const stockMap = stocksQuery.data;
        if (!stockMap) return EMPTY_ROWS;
        const bomByCode = new Map((bomsQuery.data ?? []).map(bom => [bom.code, bom]));
        return Object.entries(stockMap).flatMap(([code, stock]) => {
            const bom = bomByCode.get(code);
            return bom ? [{ code, name: bom.name, remark: bom.remark, stock }] : [];
        });
    }, [bomsQuery.data, stocksQuery.data]);

    /* 品类选项取自当前有流水的行，不列无库存的品类，避免筛出空结果 */
    const categories = useMemo(() => [...new Set(rows.map(row => row.name))], [rows]);

    const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return rows.filter(
            row =>
                (category === "全部品类" || row.name === category) &&
                (!kw || `${row.code} ${row.name} ${row.remark}`.toLowerCase().includes(kw)),
        );
    }, [rows, keyword, category]);

    const sorted = useMemo(() => {
        if (!sort) return filtered;
        const factor = sort.dir === "asc" ? 1 : -1;
        return [...filtered].sort((a, b) =>
            sort.key === "code" ? a.code.localeCompare(b.code) * factor : (a.stock - b.stock) * factor,
        );
    }, [filtered, sort]);
    const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);

    // 排序或翻页后行序变化，滚动区回到顶部
    const tableScrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
    }, [page, sort]);

    const clearFilters = () => {
        setKeyword("");
        setCategory("全部品类");
        setPage(1);
    };
    const filtersActive = !!keyword.trim() || category !== "全部品类";

    return (
        <div className="flex flex-col gap-5">
            <h1 className="sr-only">库存</h1>

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
                            placeholder="BOM 编码 / 品类 / 备注"
                            className="w-full bg-transparent text-13 text-ink outline-none placeholder:text-subtle"
                        />
                    </label>
                    <select
                        value={category}
                        onChange={event => {
                            setCategory(event.target.value);
                            setPage(1);
                        }}
                        className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-13 text-ink"
                        aria-label="按品类筛选"
                    >
                        <option>全部品类</option>
                        {categories.map(item => (
                            <option key={item}>{item}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={clearFilters}
                        disabled={!filtersActive}
                        className="min-h-10 px-1 text-13 font-medium text-muted transition hover:text-primary-strong disabled:cursor-not-allowed disabled:text-subtle disabled:hover:text-subtle"
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
                                        "库存",
                                        ["序号", "BOM编码", "品类", "BOM备注", "当前库存（个）"],
                                        pageRows.map((row, index) => [
                                            String((page - 1) * pageSize + index + 1),
                                            row.code,
                                            row.name,
                                            row.remark.trim() || "—",
                                            String(row.stock),
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
                        {pageRows.map(row => (
                            <RecordCard
                                key={row.code}
                                title={row.code}
                                subtitle={row.name}
                                actions={
                                    <Button
                                        variant="secondary"
                                        onClick={() => setDetail(rowBom(bomsQuery.data, row.code) ?? null)}
                                    >
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
                            defaultWidths={[64, 240, 360, 150, 104]}
                            recordCount={filtered.length}
                            identityColumn={1}
                            scrollRef={tableScrollRef}
                        >
                            <thead>
                                <tr className="text-left text-12 text-muted">
                                    <th className="px-5 py-2.5 font-semibold" style={{ width: "5%" }}>
                                        序号
                                    </th>
                                    <SortTh
                                        label="BOM 编码"
                                        active={sort?.key === "code"}
                                        dir={sort?.dir ?? "asc"}
                                        onSort={() =>
                                            setSort(current =>
                                                current ? nextSortState(current, "code") : { key: "code", dir: "asc" },
                                            )
                                        }
                                        className="px-3"
                                        width="18%"
                                    />
                                    <th className="px-3 py-2.5 font-semibold">BOM 备注</th>
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
                                        className="px-3"
                                        width="12%"
                                    />
                                    <th className="px-5 py-2.5 text-center font-semibold" style={{ width: "8%" }}>
                                        操作
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-5 py-10 text-center">
                                            <EmptyState description="暂无库存记录" />
                                        </td>
                                    </tr>
                                )}
                                {pageRows.map((row, index) => (
                                    <tr key={row.code} className="border-t border-line transition hover:bg-row-hover">
                                        <td className="tnum px-5 py-3 text-13 text-muted">
                                            {(page - 1) * pageSize + index + 1}
                                        </td>
                                        <td className="px-3 py-3">
                                            <button
                                                type="button"
                                                onClick={() => setDetail(rowBom(bomsQuery.data, row.code) ?? null)}
                                                className="tnum text-13 font-semibold whitespace-nowrap text-primary-strong underline-offset-2 hover:underline"
                                            >
                                                {row.code}
                                            </button>
                                            <span className="ml-2 text-12 text-muted">{row.name}</span>
                                        </td>
                                        <td className="px-3 py-3 text-13 leading-5 text-td">
                                            <span
                                                className="line-clamp-2 whitespace-pre-line"
                                                title={row.remark || undefined}
                                            >
                                                <BomRemarkText remark={row.remark} />
                                            </span>
                                        </td>
                                        <td
                                            className={`tnum px-3 py-3 text-13 font-semibold ${row.stock === 0 ? "text-muted" : "text-ink"}`}
                                        >
                                            {num(row.stock)}
                                        </td>
                                        <td className="px-5 py-3 text-center">
                                            <TableLink
                                                onClick={() => setDetail(rowBom(bomsQuery.data, row.code) ?? null)}
                                            >
                                                查看详情
                                            </TableLink>
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
                        onPageSizeChange={size => {
                            setPageSize(size);
                            setPage(1);
                        }}
                    />
                </div>
            </section>

            <StockLedgerModal bom={detail} onClose={() => setDetail(null)} />
        </div>
    );
}

/** 从档案列表取完整 Bom（详情弹窗需要 items 等完整快照） */
function rowBom(boms: Bom[] | undefined, code: string): Bom | undefined {
    return boms?.find(bom => bom.code === code);
}

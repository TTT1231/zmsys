import type { ReactNode } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, RecordCard, CardField } from "@/components/ui/MobileList";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordFields, RecordProduct, RecordSummary } from "@/components/business/RecordDetails";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { downloadCsv, num } from "@/lib/format";
import { useApp } from "@/context/useApp";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { Badge, Button } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { QtyCell } from "@/components/ui/cells";
import { SortTh } from "@/components/ui/SortTh";
import { MobileSortSelect } from "@/components/ui/MobileSortSelect";
import { nextSortState, type SortState } from "@/lib/tableSort";
import { TextArea, TextField } from "@/components/ui/Field";
import { SelectMenuField } from "@/components/ui/SelectMenuField";
import { useCreateInbound, useUpdateInbound, useVoidInbound, useWbRefresh, useWbSnapshot } from "@/data/queries";
import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useDelayedFlag } from "@/components/ui/useDelayedFlag";
import { PageLoading } from "@/components/ui/PageLoading";
import { EMPTY_SNAPSHOT, bomByCode } from "@/data/views";
import { todayIso } from "@/lib/date";
import { useToast } from "@/components/ui/toastContexts";

import { BomCell } from "@/components/bom/BomCell";
import { RemarkCell } from "@/components/ui/RemarkCell";
import { BomPicker } from "@/components/bom/BomPicker";
import { BomRemarkNote } from "@/components/bom/BomRemarkNote";
import type { InboundRow, Snapshot } from "@/api";

/* 可排序列：入库单号 / BOM 编码 / 入库数量 / 入库日期；桌面表头与移动端排序下拉共用 */
type LedgerSortKey = "no" | "bomCode" | "qty" | "date";
const LEDGER_SORT_COLUMNS: Array<{ key: LedgerSortKey; label: string }> = [
    { key: "no", label: "入库单号" },
    { key: "bomCode", label: "BOM 编码" },
    { key: "qty", label: "入库数量" },
    { key: "date", label: "入库日期" },
];

/**
 * BOM 备注（同构成不同备注 = 不同 BOM）：台账里直接看到入库的是哪个 BOM，
 * 沿用警示色突出工艺差异；空值显示占位，避免误以为遗漏字段。
 */
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

/**
 * 成品选择（入库建档用）：品类 → 按编码 / 物料关键字搜索 + 列表点选；
 * 点选即回填 bomCode。
 */
function InboundBomPicker({
    boms,
    value,
    onChange,
    error,
}: {
    boms: Snapshot["boms"];
    value: string;
    onChange: (bomCode: string) => void;
    error?: string;
}) {
    const currentBom = boms.find(bom => bom.code === value);
    const [category, setCategory] = useState(currentBom?.name ?? "");

    const categoryNames = useMemo(() => [...new Set(boms.map(bom => bom.name))], [boms]);
    const categoryBoms = useMemo(() => (category ? boms.filter(bom => bom.name === category) : []), [boms, category]);

    return (
        <div className="col-span-full flex flex-col gap-3">
            <SelectMenuField
                label="品类"
                required
                error={error}
                value={category}
                placeholder="请选择品类"
                options={categoryNames.map(item => ({ value: item, label: item }))}
                onValueChange={setCategory}
            />
            {category && <BomPicker boms={categoryBoms} selected={currentBom} onSelect={bom => onChange(bom.code)} />}
            {currentBom && currentBom.name === category && (
                <div
                    className="rounded-btn border border-primary-border bg-primary-soft/70 px-3.5 py-3"
                    aria-live="polite"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="tnum text-14 font-semibold text-primary-strong">{currentBom.code}</span>
                        <span className="rounded-full bg-surface px-2 py-1 text-12 font-medium text-success">
                            已选择
                        </span>
                    </div>
                    <p className="mt-1 text-13 text-td">{currentBom.name}</p>
                    <p className="mt-1 wrap-break-word text-12 text-muted">{currentBom.spec}</p>
                    {/* 工艺差异独立警示条：检验入库时需核对的差异 */}
                    <BomRemarkNote remark={currentBom.remark} className="mt-2" />
                </div>
            )}
        </div>
    );
}

export function InboundModal({
    open,
    onClose,
    initialBomCode = "",
}: {
    open: boolean;
    onClose: () => void;
    initialBomCode?: string;
}) {
    const { data } = useWbSnapshot();
    const snap = data ?? EMPTY_SNAPSHOT;
    const createInbound = useCreateInbound();
    const toast = useToast();
    const boms = snap.boms;
    const stock = snap.stock;
    // 检验登记人 = 当前登录用户（服务端落账，不经请求体）

    const [bomCode, setBomCode] = useState(initialBomCode);
    const [qty, setQty] = useState("");
    const [remark, setRemark] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});

    const selectedBom = boms.find(bom => bom.code === bomCode);
    const currentStock = stock[bomCode] || 0;
    const previewQty = Number(qty) || 0;

    /* 用户改动某字段即清除该字段的报错，避免补填后验证词残留 */
    const clearError = (key: string) => setErrors(current => ({ ...current, [key]: "" }));

    const reset = () => {
        setBomCode("");
        setQty("");
        setRemark("");
        setErrors({});
    };

    const submit = () => {
        if (createInbound.isPending) return;
        const nextErrors: Record<string, string> = {};
        if (!bomCode) nextErrors.bomCode = "请选择成品";
        if (!qty) nextErrors.qty = "请填写入库数量";
        else if (Number(qty) <= 0) nextErrors.qty = "入库数量必须大于 0";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length)
            requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus(),
            );
        if (Object.keys(nextErrors).length > 0) return;
        createInbound.mutate(
            // 入库日期固定为当天（当天录入当天入库，杜绝误选日期）
            { bomCode, qty: Number(qty), date: todayIso(), remark },
            {
                onError: error => toast(error.message, true),
                onSuccess: row => {
                    toast(`入库单 ${row.no} 已登记`);
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
            title="检验成品入库"
            subtitle="登记检验合格并可用的成品"
            width={600}
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
                        disabled={createInbound.isPending}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-14 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        {createInbound.isPending ? "正在登记…" : "确认入库"}
                    </button>
                </>
            }
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <InboundBomPicker
                    boms={boms}
                    value={bomCode}
                    onChange={code => {
                        setBomCode(code);
                        clearError("bomCode");
                    }}
                    error={errors.bomCode}
                />
                <TextField
                    label="入库数量（个）"
                    required
                    inputMode="numeric"
                    placeholder="如 1600"
                    error={errors.qty}
                    value={qty}
                    onChange={event => {
                        setQty(event.target.value.replace(/\D/g, ""));
                        clearError("qty");
                    }}
                />
                <div className="[&_input]:cursor-default [&_input]:bg-soft">
                    <TextField label="入库日期（固定为今天）" value={todayIso()} readOnly tabIndex={-1} />
                </div>
                <div className="sm:col-span-2">
                    <TextArea
                        label="备注"
                        placeholder="选填"
                        value={remark}
                        onChange={event => setRemark(event.target.value)}
                    />
                </div>
                {selectedBom && (
                    <div className="rounded-xl border border-line bg-panel px-3.5 py-3 text-13 sm:col-span-2">
                        <div className="font-semibold text-ink">{selectedBom.code}</div>
                        <div className="mt-1 text-muted">{selectedBom.spec}</div>
                        <div className="tnum mt-1.5 font-medium text-primary-strong">
                            当前库存 {num(currentStock)} 个 · 入库后 {num(currentStock + previewQty)} 个
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}

export function VoucherModal({
    row,
    snap,
    onClose,
    actions,
}: {
    row: InboundRow | null;
    snap: Snapshot;
    onClose: () => void;
    actions?: ReactNode;
}) {
    if (!row) return null;
    const bom = bomByCode(snap, row.bomCode);
    return (
        <Modal
            open={!!row}
            onClose={onClose}
            label="入库凭证"
            title={row.no}
            width={560}
            layout="detail"
            footer={
                <>
                    {actions}
                    <Button variant="secondary" onClick={onClose}>
                        关闭
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <RecordSummary
                    metrics={[{ label: "入库数量", value: row.qty }]}
                    status={
                        <Badge tone={row.status === "voided" ? "danger" : "progress"}>
                            {row.status === "voided" ? "已作废" : "已入库"}
                        </Badge>
                    }
                    note={row.status === "voided" ? "此记录已作废，以上数量不再计入库存。" : undefined}
                />
                <RecordProduct categories={snap.bomCategories} bom={bom} bomCode={row.bomCode} />
                <RecordFields
                    title="入库信息"
                    items={[
                        { label: "入库日期", value: row.date },
                        { label: "检验登记人", value: row.inspector },
                        { label: "登记时间", value: row.time },
                        { label: "备注", value: row.remark || "—", fullWidth: true },
                    ]}
                />
            </div>
        </Modal>
    );
}

function EditInboundModal({ row, onClose }: { row: InboundRow; onClose: () => void }) {
    const { data } = useWbSnapshot();
    const snap = data ?? EMPTY_SNAPSHOT;
    const updateInbound = useUpdateInbound();
    const toast = useToast();
    const [bomCode, setBomCode] = useState(row.bomCode);
    const [qty, setQty] = useState(String(row.qty));
    const [remark, setRemark] = useState(row.remark ?? "");
    const [reason, setReason] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});

    /* 用户改动某字段即清除该字段的报错，避免补填后验证词残留 */
    const clearError = (key: string) => setErrors(current => ({ ...current, [key]: "" }));

    const submit = () => {
        if (updateInbound.isPending) return;
        const nextErrors: Record<string, string> = {};
        if (!bomCode) nextErrors.bomCode = "请选择成品";
        if (!qty) nextErrors.qty = "请填写入库数量";
        else if (Number(qty) <= 0) nextErrors.qty = "入库数量必须大于 0";
        if (reason.trim().length < 2) nextErrors.reason = "请填写修正原因（至少 2 个字）";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length)
            requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus(),
            );
        if (Object.keys(nextErrors).length > 0) return;
        updateInbound.mutate(
            {
                no: row.no,
                expectedVersion: row.version,
                bomCode,
                qty: Number(qty),
                // 入库日期固定为当天（仅当天记录可修正，日期不再可改）
                date: todayIso(),
                remark,
                reason: reason.trim(),
            },
            {
                onError: error => toast(error.message, true),
                onSuccess: updated => {
                    toast(`入库单 ${updated.no} 已修正`);
                    onClose();
                },
            },
        );
    };

    return (
        <Modal
            open
            onClose={onClose}
            title="修正入库记录"
            subtitle={`${row.no} · 今天登记的入库`}
            label="修正入库记录"
            width={600}
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
                        disabled={updateInbound.isPending}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-14 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        {updateInbound.isPending ? "正在保存…" : "确认修正"}
                    </button>
                </>
            }
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <InboundBomPicker
                    boms={snap.boms}
                    value={bomCode}
                    onChange={code => {
                        setBomCode(code);
                        clearError("bomCode");
                    }}
                    error={errors.bomCode}
                />
                <TextField
                    label="入库数量（个）"
                    required
                    inputMode="numeric"
                    placeholder="如 1600"
                    error={errors.qty}
                    value={qty}
                    onChange={event => {
                        setQty(event.target.value.replace(/\D/g, ""));
                        clearError("qty");
                    }}
                />
                <div className="rounded-btn border border-line bg-panel px-3.5 py-2.5">
                    <p className="text-12 text-muted">入库日期（固定为今天）</p>
                    <p className="tnum text-14 font-medium text-ink">{todayIso()}</p>
                </div>
                <TextArea
                    label="备注"
                    placeholder="选填"
                    value={remark}
                    onChange={event => setRemark(event.target.value)}
                />
                <TextArea
                    label="修正原因"
                    required
                    placeholder="例如：实际入库数量少记了 200 个"
                    error={errors.reason}
                    value={reason}
                    onChange={event => {
                        setReason(event.target.value);
                        clearError("reason");
                    }}
                />
                <p className="text-13 text-muted sm:col-span-2">
                    今天登记的记录可以直接修改；发现还有错可以再改，也可以作废。
                </p>
            </div>
        </Modal>
    );
}

function VoidInboundModal({
    row,
    pending,
    onClose,
    onConfirm,
}: {
    row: InboundRow;
    pending: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => void;
}) {
    const [reason, setReason] = useState("");
    const [error, setError] = useState("");
    const formId = `void-inbound-${row.no}`;
    const submit = (event: FormEvent) => {
        event.preventDefault();
        const value = reason.trim();
        if (value.length < 2) {
            setError("请填写作废原因（至少 2 个字）");
            return;
        }
        setError("");
        onConfirm(value);
    };
    const close = () => {
        if (!pending) onClose();
    };

    return (
        <Modal
            open
            onClose={close}
            title="作废入库记录"
            subtitle={`${row.no} · 今天登记的入库`}
            label="作废入库记录"
            width={440}
            footer={
                <>
                    <Button variant="secondary" type="button" disabled={pending} onClick={close}>
                        取消
                    </Button>
                    <Button type="submit" form={formId} disabled={pending}>
                        {pending ? "正在作废…" : "确认作废"}
                    </Button>
                </>
            }
        >
            <form id={formId} onSubmit={submit} aria-busy={pending}>
                <TextArea
                    label="作废原因"
                    required
                    value={reason}
                    error={error}
                    placeholder="例如：登记了错误数量 / 入库了错误型号"
                    onChange={event => setReason(event.target.value)}
                />
                <p className="mt-2 text-13 text-muted">
                    作废后这批数量会自动退回库存；记录保留作凭证，重新登记一条正确的就行。
                </p>
            </form>
        </Modal>
    );
}

export function InboundPage() {
    const { can } = useApp();
    const { data, isLoading, isFetching } = useWbSnapshot();
    const { refresh } = useWbRefresh();
    // 首载出替换式占位,后台刷新出保留式遮罩(200ms 内完成不闪现)
    const overlay = useDelayedFlag(isFetching && !isLoading);
    const snap = data ?? EMPTY_SNAPSHOT;
    const voidRequest = useVoidInbound();
    const toast = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("全部品类");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    // 列排序默认升序：默认按入库日期（同日以单号稳定排序）
    const [sort, setSort] = useState<SortState<LedgerSortKey>>({ key: "date", dir: "asc" });
    const [newOpen, setNewOpen] = useState(false);
    const [voucher, setVoucher] = useState<InboundRow | null>(null);
    const currentVoucher = voucher ? (snap.inboundLedger.find(row => row.no === voucher.no) ?? null) : null;
    const [voidTarget, setVoidTarget] = useState<InboundRow | null>(null);
    const [editTarget, setEditTarget] = useState<InboundRow | null>(null);

    const rows = snap.inboundLedger;
    const boms = snap.boms;
    const bomCategory = new Map(boms.map(bom => [bom.code, bom.name]));
    const categories = [...new Set(boms.map(bom => bom.name))];

    const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return rows.filter(row => {
            if (category !== "全部品类" && bomCategory.get(row.bomCode) !== category) return false;
            return !kw || `${row.no} ${row.bomCode} ${row.inspector}`.toLowerCase().includes(kw);
        });
    }, [rows, keyword, category, bomCategory]);

    const sorted = useMemo(() => {
        const factor = sort.dir === "asc" ? 1 : -1;
        return [...filtered].sort((a, b) => {
            const byKey =
                sort.key === "no"
                    ? a.no.localeCompare(b.no)
                    : sort.key === "bomCode"
                      ? a.bomCode.localeCompare(b.bomCode)
                      : sort.key === "qty"
                        ? a.qty - b.qty
                        : a.date.localeCompare(b.date);
            return byKey * factor || a.no.localeCompare(b.no);
        });
    }, [filtered, sort]);
    const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
    const canRegister = can("inbound:register");
    const canVoidToday = can("inbound:edit");
    const applySort = (key: LedgerSortKey) => setSort(current => nextSortState(current, key));
    // 排序或翻页后行序变化，滚动区回到顶部，避免误以为排错行
    const tableScrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
    }, [page, sort]);
    // 当天（北京时间）录入且未作废的记录才允许当天作废；跨日只能走库存调整
    const voidable = (row: InboundRow) => canVoidToday && row.status === "active" && row.date === todayIso();

    useEffect(() => {
        if (searchParams.get("new") === "inbound") {
            setNewOpen(true);
            setSearchParams({}, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    // 清空条件只作用于筛选行（搜索/品类）；分页由用户自行操作
    const clearFilters = () => {
        setKeyword("");
        setCategory("全部品类");
        setPage(1);
    };
    const filtersActive = !!keyword.trim() || category !== "全部品类";

    return (
        <div className="flex flex-col gap-5">
            <h1 className="sr-only">成品入库</h1>

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
                            placeholder="单号 / BOM / 登记人"
                            className="w-full bg-transparent text-14 text-ink outline-none placeholder:text-subtle"
                        />
                    </label>
                    <select
                        value={category}
                        onChange={event => {
                            setCategory(event.target.value);
                            setPage(1);
                        }}
                        aria-label="按品类筛选"
                        className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink"
                    >
                        <option>全部品类</option>
                        {categories.map(item => (
                            <option key={item}>{item}</option>
                        ))}
                    </select>
                    <MobileSortSelect columns={LEDGER_SORT_COLUMNS} value={sort} onChange={setSort} />
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
                                        "成品入库",
                                        [
                                            "入库单号",
                                            "BOM 编码",
                                            "BOM 备注",
                                            "入库数量",
                                            "入库日期",
                                            "检验登记人",
                                            "状态",
                                        ],
                                        pageRows.map(row => [
                                            row.no,
                                            row.bomCode,
                                            bomByCode(snap, row.bomCode)?.remark.trim() || "—",
                                            String(row.qty),
                                            row.date,
                                            row.inspector,
                                            row.status === "active" ? "有效" : "已作废",
                                        ]),
                                    )
                                }
                            >
                                导出
                            </Button>
                        </ToolbarMore>
                        {canRegister && (
                            <Button icon="inbound" onClick={() => setNewOpen(true)}>
                                检验入库
                            </Button>
                        )}
                    </TableHeaderActions>
                </div>

                <div className="mobile-records">
                    <ListState loading={isLoading} empty={!pageRows.length}>
                        {pageRows.map(row => {
                            const bom = bomByCode(snap, row.bomCode);
                            return (
                                <RecordCard
                                    key={row.no}
                                    title={row.no}
                                    subtitle={row.date}
                                    voided={row.status === "voided"}
                                    badge={
                                        <Badge tone={row.status === "voided" ? "danger" : "success"}>
                                            {row.status === "voided" ? "已作废" : "已入库"}
                                        </Badge>
                                    }
                                    actions={
                                        <Button variant="secondary" onClick={() => setVoucher(row)}>
                                            查看凭证
                                        </Button>
                                    }
                                >
                                    <BomCell categories={snap.bomCategories} bom={bom} bomCode={row.bomCode} />
                                    <div className="mt-2 flex flex-col gap-1.5">
                                        <CardField label="BOM 备注" value={<BomRemarkText remark={bom?.remark} />} />
                                        <CardField label="入库数量" value={`${num(row.qty)} 个`} strong />
                                        <CardField label="登记人" value={row.inspector} />
                                    </div>
                                </RecordCard>
                            );
                        })}
                    </ListState>
                </div>
                <div className="hidden lg:block">
                    {isLoading ? (
                        <PageLoading className="py-16" />
                    ) : (
                        <DataTable
                            tableId="inbound"
                            defaultWidths={[166, 370, 150, 132, 138, 130, 120]}
                            recordCount={filtered.length}
                            identityColumn={0}
                            pinnedStart={[0, 1, 2]}
                            scrollRef={tableScrollRef}
                        >
                            <thead>
                                <tr className="text-left text-13 text-muted">
                                    <SortTh
                                        label="入库单号"
                                        active={sort.key === "no"}
                                        dir={sort.dir}
                                        onSort={() => applySort("no")}
                                        className="px-5"
                                    />
                                    <SortTh
                                        label="BOM 编码"
                                        active={sort.key === "bomCode"}
                                        dir={sort.dir}
                                        onSort={() => applySort("bomCode")}
                                        className="px-3"
                                    />
                                    <th className="px-3 py-2.5 font-semibold">BOM 备注</th>
                                    <SortTh
                                        label="入库数量（个）"
                                        active={sort.key === "qty"}
                                        dir={sort.dir}
                                        onSort={() => applySort("qty")}
                                        className="px-3"
                                    />
                                    <SortTh
                                        label="入库日期"
                                        active={sort.key === "date"}
                                        dir={sort.dir}
                                        onSort={() => applySort("date")}
                                        className="px-3"
                                    />
                                    <th className="px-3 py-2.5 font-semibold">检验登记人</th>
                                    <th className="px-5 py-2.5 text-center font-semibold">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-5 py-10 text-center">
                                            <EmptyState description="没有找到匹配的入库记录" />
                                        </td>
                                    </tr>
                                )}
                                {pageRows.map(row => {
                                    const bom = bomByCode(snap, row.bomCode);
                                    const voided = row.status === "voided";
                                    return (
                                        <tr
                                            key={row.no}
                                            className={
                                                voided
                                                    ? "row-voided border-t border-line"
                                                    : "border-t border-line transition hover:bg-row-hover"
                                            }
                                        >
                                            <td className="px-5 py-3 tnum text-14 font-semibold text-td-strong">
                                                {/* 作废单号加删除线；内联小徽章兜底（颜色不是唯一指示器），
                                                    紧凑账本档经 .void-flag 收纳，识别交给不占空间的底色/竖条/删除线 */}
                                                <span className="inline-flex items-center gap-2">
                                                    <span
                                                        className={
                                                            voided ? "line-through decoration-danger/50" : undefined
                                                        }
                                                    >
                                                        {row.no}
                                                    </span>
                                                    {voided && (
                                                        <span className="void-flag">
                                                            <Badge tone="danger">已作废</Badge>
                                                        </span>
                                                    )}
                                                </span>
                                            </td>
                                            <td className="px-3 py-4">
                                                <BomCell
                                                    categories={snap.bomCategories}
                                                    bom={bom}
                                                    bomCode={row.bomCode}
                                                />
                                            </td>
                                            <td className="px-3 py-3">
                                                <RemarkCell remark={bom?.remark} variant="warning" />
                                            </td>
                                            <td className="px-3 py-3">
                                                <QtyCell value={row.qty} />
                                            </td>
                                            <td className="px-3 py-3 tnum text-14 text-td">{row.date}</td>
                                            <td className="px-3 py-3 text-14 text-td">{row.inspector}</td>
                                            <td className="px-5 py-3 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => setVoucher(row)}
                                                    className="text-14 font-medium text-primary-strong underline-offset-2 hover:underline"
                                                >
                                                    查看凭证
                                                </button>
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
                        unit="条入库记录"
                        onPageChange={setPage}
                        onPageSizeChange={size => {
                            setPageSize(size);
                            setPage(1);
                        }}
                    />
                </div>
            </section>

            {canRegister && <InboundModal open={newOpen} onClose={() => setNewOpen(false)} />}
            <VoucherModal
                row={currentVoucher}
                snap={snap}
                onClose={() => setVoucher(null)}
                actions={
                    currentVoucher &&
                    voidable(currentVoucher) && (
                        <>
                            <button
                                type="button"
                                disabled={voidRequest.isPending}
                                onClick={() => setVoidTarget(currentVoucher)}
                                className="min-h-10 rounded-btn border border-danger/30 bg-danger-soft px-4 text-14 font-medium text-danger disabled:opacity-50"
                            >
                                作废
                            </button>
                            <Button
                                variant="secondary"
                                disabled={voidRequest.isPending}
                                onClick={() => setEditTarget(currentVoucher)}
                            >
                                修正
                            </Button>
                        </>
                    )
                }
            />
            {editTarget && <EditInboundModal row={editTarget} onClose={() => setEditTarget(null)} />}
            {voidTarget && (
                <VoidInboundModal
                    row={voidTarget}
                    pending={voidRequest.isPending}
                    onClose={() => setVoidTarget(null)}
                    onConfirm={reason =>
                        voidRequest.mutate(
                            { no: voidTarget.no, expectedVersion: voidTarget.version, reason },
                            {
                                onError: error => toast(error.message, true),
                                onSuccess: updated => {
                                    setVoidTarget(null);
                                    toast(`入库记录 ${updated.no} 已作废，库存已扣回`);
                                },
                            },
                        )
                    }
                />
            )}
        </div>
    );
}

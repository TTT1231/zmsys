import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, RecordCard, CardField } from "@/components/ui/MobileList";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordFields, RecordProduct, RecordSummary } from "@/components/business/RecordDetails";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { downloadCsv, num } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { PageHeading } from "@/components/ui/PageHeading";
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
import { LoadingOverlay, useDelayedFlag } from "@/components/ui/LoadingOverlay";
import { PageLoading } from "@/components/ui/PageLoading";
import { EMPTY_SNAPSHOT, bomByCode } from "@/data/views";
import { todayIso } from "@/lib/date";
import { useToast } from "@/components/ui/Toast";

import { bomSelectorOptionLabel, buildBomSelectorSchema, resolveBomSelection } from "@/data/bomSelection";
import type { InboundRow, Snapshot } from "@/api";

/* 可排序列：入库日期 / 入库数量；桌面表头与移动端排序下拉共用 */
type LedgerSortKey = "date" | "qty";
const LEDGER_SORT_COLUMNS: Array<{ key: LedgerSortKey; label: string }> = [
    { key: "date", label: "入库日期" },
    { key: "qty", label: "入库数量" },
];

/**
 * 成品选择（与销售订单新建弹窗同一套逐维收敛模式）：品类 → 逐维下拉 →
 * 候选收敛到唯一 BOM 时自动生效。避免一次性渲染全部 BOM 选项造成卡顿。
 */
function InboundBomPicker({
    boms,
    categories,
    value,
    onChange,
    error,
}: {
    boms: Snapshot["boms"];
    categories: Snapshot["bomCategories"];
    value: string;
    onChange: (bomCode: string) => void;
    error?: string;
}) {
    const currentBom = boms.find(bom => bom.code === value);
    const [category, setCategory] = useState(currentBom?.name ?? "");
    const [bomSelections, setBomSelections] = useState<Record<string, string>>({});

    const categoryNames = useMemo(() => [...new Set(boms.map(bom => bom.name))], [boms]);
    const categoryBoms = useMemo(() => (category ? boms.filter(bom => bom.name === category) : []), [boms, category]);
    const selectorSchema = useMemo(
        () =>
            buildBomSelectorSchema(
                categoryBoms,
                categories.find(item => item.name === category)?.fields.map(field => field.key),
            ),
        [categoryBoms, category, categories],
    );
    const resolution = useMemo(
        () => resolveBomSelection(categoryBoms, selectorSchema.fields, bomSelections),
        [categoryBoms, selectorSchema.fields, bomSelections],
    );
    const selectedBom =
        !resolution.pending && resolution.candidates.length === 1 ? resolution.candidates[0] : undefined;

    const onChangeRef = useRef(onChange);
    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);
    useEffect(() => {
        if (selectedBom && selectedBom.code !== value) onChangeRef.current(selectedBom.code);
    }, [selectedBom, value]);

    const pickCategory = (nextCategory: string) => {
        setCategory(nextCategory);
        setBomSelections({});
    };
    const pickBomDimension = (fieldId: string, nextValue: string) => {
        const fieldIndex = selectorSchema.fields.findIndex(field => field.id === fieldId);
        setBomSelections(current => {
            const next: Record<string, string> = {};
            selectorSchema.fields.slice(0, fieldIndex).forEach(field => {
                if (current[field.id]) next[field.id] = current[field.id];
            });
            if (nextValue) next[fieldId] = nextValue;
            return next;
        });
    };

    const effectiveBom = selectedBom ?? currentBom;
    return (
        <div className="col-span-full flex flex-col gap-3">
            <SelectMenuField
                label="品类"
                required
                error={error}
                value={category}
                placeholder="请选择品类"
                options={categoryNames.map(item => ({ value: item, label: item }))}
                onValueChange={pickCategory}
            />
            {resolution.steps.map(step => (
                <SelectMenuField
                    key={step.field.id}
                    label={step.field.label}
                    required
                    value={bomSelections[step.field.id] ?? ""}
                    placeholder={`请选择${step.field.label}`}
                    options={step.options.map(option => ({
                        value: option,
                        label: bomSelectorOptionLabel(option),
                    }))}
                    onValueChange={value => pickBomDimension(step.field.id, value)}
                />
            ))}
            {category && selectorSchema.fixedSpecs.length > 0 && (
                <div className="rounded-btn border border-line bg-panel px-3 py-2.5">
                    <p className="text-11.5 font-semibold text-td">固定规格（无需选择）</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {selectorSchema.fixedSpecs.map(item => (
                            <span
                                key={item.key}
                                className="rounded-md bg-white px-2 py-1 text-11.5 text-muted shadow-xs"
                            >
                                {item.key}：{item.value}
                            </span>
                        ))}
                    </div>
                </div>
            )}
            {category && !selectedBom && categoryBoms.length > 0 && (
                <p className="text-12 text-muted" aria-live="polite">
                    当前匹配 {num(resolution.candidates.length)} 条 BOM，继续选择下一项即可自动定位。
                </p>
            )}
            {effectiveBom && (
                <div
                    className="rounded-btn border border-primary-border bg-primary-soft/70 px-3.5 py-3"
                    aria-live="polite"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="tnum text-14 font-semibold text-primary-strong">{effectiveBom.code}</span>
                        <span className="rounded-full bg-white px-2 py-1 text-11 font-medium text-success">
                            {selectedBom ? "已匹配" : "当前成品"}
                        </span>
                    </div>
                    <p className="mt-1 text-12.5 text-td">
                        {effectiveBom.name} · {effectiveBom.modelCode}
                    </p>
                    <p className="mt-1 break-words text-11.5 text-muted">{effectiveBom.spec}</p>
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
        if (!qty || Number(qty) <= 0) nextErrors.qty = "请填写入库数量";
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
                        className="min-h-10 rounded-btn border border-line-strong bg-white px-4 text-13 font-medium text-ink hover:border-primary-border"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        disabled={createInbound.isPending}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-13 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        {createInbound.isPending ? "正在登记…" : "确认入库"}
                    </button>
                </>
            }
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <InboundBomPicker
                    boms={boms}
                    categories={snap.bomCategories}
                    value={bomCode}
                    onChange={setBomCode}
                    error={errors.bomCode}
                />
                <TextField
                    label="入库数量（件）"
                    required
                    inputMode="numeric"
                    placeholder="如 1600"
                    error={errors.qty}
                    value={qty}
                    onChange={event => setQty(event.target.value.replace(/\D/g, ""))}
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
                    <div className="rounded-xl border border-line bg-panel px-3.5 py-3 text-12.5 sm:col-span-2">
                        <div className="font-semibold text-ink">{selectedBom.code}</div>
                        <div className="mt-1 text-muted">{selectedBom.spec}</div>
                        <div className="tnum mt-1.5 font-medium text-primary-strong">
                            当前库存 {num(currentStock)} 件 · 入库后 {num(currentStock + previewQty)} 件
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}

export function VoucherModal({ row, snap, onClose }: { row: InboundRow | null; snap: Snapshot; onClose: () => void }) {
    if (!row) return null;
    const bom = bomByCode(snap, row.bomCode);
    return (
        <Modal
            open={!!row}
            onClose={onClose}
            label="入库凭证"
            title={row.no}
            width={560}
            footer={
                <button
                    type="button"
                    onClick={onClose}
                    className="min-h-10 rounded-btn bg-primary px-4 text-13 font-medium text-white hover:bg-primary-hover"
                >
                    关闭
                </button>
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
                <RecordProduct bom={bom} bomCode={row.bomCode} categories={snap.bomCategories} />
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

    const submit = () => {
        if (updateInbound.isPending) return;
        const nextErrors: Record<string, string> = {};
        if (!bomCode) nextErrors.bomCode = "请选择成品";
        if (!qty || Number(qty) <= 0) nextErrors.qty = "请填写入库数量";
        if (reason.trim().length < 2) nextErrors.reason = "请填写修正原因（至少 2 个字）";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) return;
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
                        className="min-h-10 rounded-btn border border-line-strong bg-white px-4 text-13 font-medium text-ink hover:border-primary-border"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        disabled={updateInbound.isPending}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-13 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        {updateInbound.isPending ? "正在保存…" : "确认修正"}
                    </button>
                </>
            }
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <InboundBomPicker
                    boms={snap.boms}
                    categories={snap.bomCategories}
                    value={bomCode}
                    onChange={setBomCode}
                    error={errors.bomCode}
                />
                <TextField
                    label="入库数量（件）"
                    required
                    inputMode="numeric"
                    placeholder="如 1600"
                    error={errors.qty}
                    value={qty}
                    onChange={event => setQty(event.target.value.replace(/\D/g, ""))}
                />
                <div className="rounded-btn border border-line bg-panel px-3.5 py-2.5">
                    <p className="text-11.5 text-muted">入库日期（固定为今天）</p>
                    <p className="tnum text-13.5 font-medium text-ink">{todayIso()}</p>
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
                    placeholder="例如：实际入库数量少记了 200 件"
                    error={errors.reason}
                    value={reason}
                    onChange={event => setReason(event.target.value)}
                />
                <p className="text-12 text-muted sm:col-span-2">
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
                <p className="mt-2 text-12 text-muted">
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
            const byKey = sort.key === "qty" ? a.qty - b.qty : a.date.localeCompare(b.date);
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
            <PageHeading
                title="成品入库"
                description="登记已确认可用的成品。"
                actions={
                    canRegister ? (
                        <Button icon="inbound" onClick={() => setNewOpen(true)}>
                            检验入库
                        </Button>
                    ) : undefined
                }
            />

            <section className="relative overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
                {overlay && <LoadingOverlay />}
                <div className="list-toolbar flex flex-wrap items-center border-b border-line bg-gradient-to-b from-white to-panel px-5 py-4 lg:gap-2.5">
                    <label className="flex h-10 items-center gap-2 rounded-btn border border-line-strong bg-white px-3 lg:w-70">
                        <Icon name="search" size={15} className="text-subtle" />
                        <input
                            value={keyword}
                            onChange={event => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                            placeholder="搜索单号、BOM 编码或登记人"
                            className="w-full bg-transparent text-13 text-ink outline-none placeholder:text-subtle"
                        />
                    </label>
                    <select
                        value={category}
                        onChange={event => {
                            setCategory(event.target.value);
                            setPage(1);
                        }}
                        aria-label="按品类筛选"
                        className="h-10 rounded-btn border border-line-strong bg-white px-3 text-13 text-ink"
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
                        className="min-h-10 px-1 text-13 font-medium text-muted transition hover:text-primary-strong disabled:cursor-not-allowed disabled:text-subtle disabled:hover:text-subtle"
                    >
                        清空条件
                    </button>
                    <div className="ml-auto">
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
                                        ["入库单号", "BOM 编码", "入库数量", "入库日期", "检验登记人", "状态"],
                                        pageRows.map(row => [
                                            row.no,
                                            row.bomCode,
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
                    </div>
                </div>

                <div className="mobile-records">
                    <ListState loading={isLoading} empty={!pageRows.length}>
                        {pageRows.map(row => (
                            <RecordCard
                                key={row.no}
                                title={row.bomCode}
                                subtitle={row.no}
                                badge={<strong className="text-success">+{num(row.qty)} 件</strong>}
                                actions={
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant="secondary" onClick={() => setVoucher(row)}>
                                            查看凭证
                                        </Button>
                                        {voidable(row) && (
                                            <>
                                                <Button
                                                    variant="secondary"
                                                    disabled={voidRequest.isPending}
                                                    onClick={() => setEditTarget(row)}
                                                >
                                                    修正
                                                </Button>
                                                <Button
                                                    variant="secondary"
                                                    disabled={voidRequest.isPending}
                                                    onClick={() => setVoidTarget(row)}
                                                >
                                                    作废
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                }
                            >
                                <p>{bomByCode(snap, row.bomCode)?.spec}</p>
                                <div className="mt-2 flex flex-col gap-1.5">
                                    <CardField label="入库日期" value={row.date} />
                                    <CardField label="登记人" value={row.inspector} />
                                </div>
                            </RecordCard>
                        ))}
                    </ListState>
                </div>
                <div
                    ref={tableScrollRef}
                    className="hidden overflow-auto lg:block lg:max-h-[calc(100dvh-23rem)] lg:min-h-[18.75rem]"
                >
                    {isLoading ? (
                        <PageLoading className="py-16" />
                    ) : (
                        <table className="data-table w-full min-w-215 border-collapse">
                            <thead>
                                <tr className="text-left text-12 text-muted">
                                    <th className="px-5 py-2.5 font-semibold">入库单号</th>
                                    <th className="px-3 py-2.5 font-semibold">BOM 编码</th>
                                    <SortTh
                                        label="入库数量（件）"
                                        align="right"
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
                                    <th className="px-5 py-2.5 text-right font-semibold">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-5 py-10 text-center">
                                            <EmptyState description="没有找到匹配的入库记录" />
                                        </td>
                                    </tr>
                                )}
                                {pageRows.map(row => (
                                    <tr key={row.no} className="border-t border-line transition hover:bg-row-hover">
                                        <td className="px-5 py-3 tnum text-13 font-semibold text-td-strong">
                                            {row.no}
                                        </td>
                                        <td className="px-3 py-3 tnum text-12.5 font-medium text-primary-strong">
                                            {row.bomCode}
                                        </td>
                                        <td className="px-3 py-3 text-right">
                                            <QtyCell value={row.qty} />
                                        </td>
                                        <td className="px-3 py-3 tnum text-13 text-td">{row.date}</td>
                                        <td className="px-3 py-3 text-13 text-td">{row.inspector}</td>
                                        <td className="px-5 py-3 text-right">
                                            <div className="flex items-center justify-end gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => setVoucher(row)}
                                                    className="text-13 font-medium text-primary-strong underline-offset-2 hover:underline"
                                                >
                                                    查看凭证
                                                </button>
                                                {voidable(row) && (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() => setEditTarget(row)}
                                                            className="text-13 font-medium text-primary-strong underline-offset-2 hover:underline"
                                                        >
                                                            修正
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={voidRequest.isPending}
                                                            onClick={() => setVoidTarget(row)}
                                                            className="text-13 font-medium text-primary-strong underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                                        >
                                                            {voidRequest.isPending &&
                                                            voidRequest.variables?.no === row.no
                                                                ? "处理中…"
                                                                : "作废"}
                                                        </button>
                                                    </>
                                                )}
                                            </div>
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
            <VoucherModal row={voucher} snap={snap} onClose={() => setVoucher(null)} />
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

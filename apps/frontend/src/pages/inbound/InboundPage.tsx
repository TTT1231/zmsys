import type { ReactNode } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListToolbar } from "@/components/ui/ListToolbar";
import { ToolbarSelect } from "@/components/ui/ToolbarSelect";
import { ListState, RecordCard, CardField } from "@/components/ui/MobileList";
import { EmptyRow } from "@/components/ui/EmptyRow";
import { RecordFields, RecordProduct, RecordSummary } from "@/components/business/RecordDetails";
import { DangerNote } from "@/components/business/DangerNote";
import { VoidReasonModal } from "@/components/business/VoidReasonModal";
import { useMemo, useState } from "react";
import { Icon } from "@/lib/icons";
import { num } from "@/lib/format";
import { focusFirstInvalid } from "@/lib/formFocus";
import { useApp } from "@/context/useApp";
import { useTableControls } from "@/lib/useTableControls";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { Badge, TableLink } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { QtyCell } from "@/components/ui/cells";
import { SortTh } from "@/components/ui/SortTh";
import { MobileSortSelect } from "@/components/ui/MobileSortSelect";
import { makeLedgerSort, nextSortState, type LedgerSortKey, type SortState } from "@/lib/tableSort";
import { TextArea, TextField } from "@/components/ui/Field";
import { SelectMenuField } from "@/components/ui/SelectMenuField";
import {
    useCreateInbound,
    useDeleteInbound,
    useUpdateInbound,
    useVoidInbound,
    useWbRefresh,
    useWbView,
} from "@/data/queries";
import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { PageLoading } from "@/components/ui/PageLoading";
import { SnapProvider } from "@/context/snap";
import { useSnap } from "@/context/useSnap";
import { bomByCode, bomIndexOf } from "@/data/views";
import { beijingDateOf, beijingTodayIso, todayIso } from "@/lib/date";
import { useToast } from "@/components/ui/toastContexts";

import { BomCell } from "@/components/bom/BomCell";
import { RemarkCell } from "@/components/ui/RemarkCell";
import { BomPicker } from "@/components/bom/BomPicker";
import { BomRemarkNote } from "@/components/bom/BomRemarkNote";
import type { InboundRow, Snapshot } from "@/api";

/* 台账排序：单号/编码/数量/日期四列，文案按入库前缀差异化（桌面表头与移动端排序下拉共用） */
const ledgerSort = makeLedgerSort<InboundRow>({ no: "入库单号", qty: "入库数量", date: "入库日期" });

/* 状态 → 文案/徽章色单一来源（详情、筛选比较、移动卡共用） */
const inboundStateLabel = (row: InboundRow) => (row.status === "voided" ? "已作废" : "已入库");

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
    const snap = useSnap();
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
        if (Object.keys(nextErrors).length > 0) {
            focusFirstInvalid();
            return;
        }
        createInbound.mutate(
            // 入库日期固定为当天（当天录入当天入库，杜绝误选日期）
            { bomCode, qty: Number(qty), date: todayIso(), remark },
            {
                onSuccess: row => {
                    toast.success(`入库单 ${row.no} 已登记`);
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
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" disabled={createInbound.isPending} onClick={submit}>
                        {createInbound.isPending ? "正在登记…" : "确认入库"}
                    </Button>
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
    onClose,
    actions,
}: {
    row: InboundRow | null;
    onClose: () => void;
    actions?: ReactNode;
}) {
    const snap = useSnap();
    if (!row) return null;
    const bom = bomByCode(snap, row.bomCode);
    return (
        <Modal
            open={!!row}
            onClose={onClose}
            label="入库详情"
            title={row.no}
            width={560}
            layout="detail"
            footer={
                <>
                    {actions}
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        关闭
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <RecordSummary
                    metrics={[{ label: "入库数量", value: row.qty }]}
                    status={
                        <Badge tone={row.status === "voided" ? "danger" : "success"}>{inboundStateLabel(row)}</Badge>
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
    const snap = useSnap();
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
        if (Object.keys(nextErrors).length > 0) {
            focusFirstInvalid();
            return;
        }
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
                onSuccess: updated => {
                    toast.success(`入库单 ${updated.no} 已修正`);
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
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" disabled={updateInbound.isPending} onClick={submit}>
                        {updateInbound.isPending ? "正在保存…" : "确认修正"}
                    </Button>
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

/** 删除已作废入库的二次确认：软删除（7 天后悔期后系统物理清理），动作记入系统日志 */
function DeleteInboundModal({
    row,
    pending,
    onClose,
    onConfirm,
}: {
    row: InboundRow;
    pending: boolean;
    onClose: () => void;
    onConfirm: () => void;
}) {
    return (
        <Modal
            open
            onClose={onClose}
            title="删除入库单"
            subtitle={`${row.no} · 已作废`}
            width={440}
            footer={
                <>
                    <Button size="sm" variant="secondary" type="button" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" variant="danger" type="button" disabled={pending} onClick={onConfirm}>
                        {pending ? "正在删除…" : "确认删除"}
                    </Button>
                </>
            }
        >
            <DangerNote
                impact="删除后，这笔入库单会从列表移除"
                note={`已作废的 ${num(row.qty)} 个不再计入库存。删除后无恢复入口，记录由系统保留 7 天供审计，随后永久删除；操作日志始终保留。`}
            />
        </Modal>
    );
}

export function InboundPage() {
    const { can } = useApp();
    const { snap, isLoading, refreshing: overlay } = useWbView();
    const { refresh } = useWbRefresh();
    const voidRequest = useVoidInbound();
    const deleteRequest = useDeleteInbound();
    const toast = useToast();
    const [category, setCategory] = useState("全部品类");
    const [statusFilter, setStatusFilter] = useState("全部状态");
    // 按检验登记人筛：看单个人的全部入库记录（选项来自台账里实际出现过的登记人）
    const [inspectorFilter, setInspectorFilter] = useState("全部登记人");
    // 列排序默认升序：默认按入库日期（同日以单号稳定排序）
    const [sort, setSort] = useState<SortState<LedgerSortKey>>({ key: "date", dir: "asc" });
    const {
        keyword,
        setKeyword,
        onKeywordChange,
        page,
        setPage,
        pageSize,
        onPageSizeChange,
        tableScrollRef,
        newOpen,
        setNewOpen,
    } = useTableControls({
        deepLinkNew: "inbound",
        resetKey: sort,
    });
    const [voucher, setVoucher] = useState<InboundRow | null>(null);
    const currentVoucher = voucher ? (snap.inboundLedger.find(row => row.no === voucher.no) ?? null) : null;
    const [voidTarget, setVoidTarget] = useState<InboundRow | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<InboundRow | null>(null);
    const [editTarget, setEditTarget] = useState<InboundRow | null>(null);

    const rows = snap.inboundLedger;
    const inspectors = useMemo(() => [...new Set(rows.map(row => row.inspector))], [rows]);
    const boms = snap.boms;
    const bomCategory = useMemo(() => new Map(boms.map(bom => [bom.code, bom.name])), [boms]);
    /* 行渲染 BOM 档案走索引，替代逐行线性查找（VoucherModal 单点仍用 bomByCode） */
    const bomIndex = useMemo(() => bomIndexOf(snap), [snap]);
    const categories = useMemo(() => [...new Set(boms.map(bom => bom.name))], [boms]);

    const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return rows.filter(row => {
            if (statusFilter !== "全部状态" && inboundStateLabel(row) !== statusFilter) return false;
            if (category !== "全部品类" && bomCategory.get(row.bomCode) !== category) return false;
            if (inspectorFilter !== "全部登记人" && row.inspector !== inspectorFilter) return false;
            return !kw || `${row.no} ${row.bomCode} ${row.inspector}`.toLowerCase().includes(kw);
        });
    }, [rows, keyword, category, statusFilter, inspectorFilter, bomCategory]);

    const sorted = useMemo(() => ledgerSort.sortRows(filtered, sort), [filtered, sort]);
    const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
    const canRegister = can("inbound:register");
    const canVoidToday = can("inbound:edit");
    const canDeleteVoided = can("inbound:delete");
    const canVoidAnyDay = can("inbound:void-any-day");
    const applySort = (key: LedgerSortKey) => setSort(current => nextSortState(current, key));

    // "当天"按 created_at 的北京日期判定（与后端 beijing-day 窗口同口径，todayIso 是
    // 浏览器本地时区，非北京时区会错位）；补录历史业务日期的记录当天仍可纠错
    const isToday = (row: InboundRow) => beijingDateOf(new Date(row.createdAt)) === beijingTodayIso();
    // 修正：仅当天录入且未作废（跨天修正一律走库存调整，超管也不例外）
    const editableToday = (row: InboundRow) => canVoidToday && row.status === "active" && isToday(row);
    // 作废：当天记录人人（有 inbound:edit）可作废；非当天记录需持跨天作废权限（超管）
    const voidableNow = (row: InboundRow) => canVoidToday && row.status === "active" && (isToday(row) || canVoidAnyDay);

    // 清空条件只作用于筛选行（搜索/状态/品类/登记人）；分页由用户自行操作
    const clearFilters = () => {
        setKeyword("");
        setCategory("全部品类");
        setStatusFilter("全部状态");
        setInspectorFilter("全部登记人");
        setPage(1);
    };
    const filtersActive =
        !!keyword.trim() || statusFilter !== "全部状态" || category !== "全部品类" || inspectorFilter !== "全部登记人";

    return (
        <SnapProvider snap={snap}>
            <div className="flex flex-col gap-5">
                <h1 className="sr-only">成品入库</h1>

                <section className="relative overflow-hidden rounded-panel border border-line bg-surface/97 shadow-card">
                    {overlay && <LoadingOverlay />}
                    <ListToolbar
                        keyword={keyword}
                        onKeywordChange={onKeywordChange}
                        placeholder="单号 / BOM / 登记人"
                        onClear={clearFilters}
                        filtersActive={filtersActive}
                        trailing={
                            <TableHeaderActions className="ml-auto">
                                <ToolbarMore>
                                    <Button variant="secondary" icon="refresh" onClick={refresh}>
                                        刷新
                                    </Button>
                                </ToolbarMore>
                                {canRegister && (
                                    <Button icon="inbound" onClick={() => setNewOpen(true)}>
                                        检验入库
                                    </Button>
                                )}
                            </TableHeaderActions>
                        }
                    >
                        <ToolbarSelect
                            value={statusFilter}
                            onChange={value => {
                                setStatusFilter(value);
                                setPage(1);
                            }}
                            label="按状态筛选"
                            options={["全部状态", "已入库", "已作废"]}
                        />
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
                            value={inspectorFilter}
                            onChange={value => {
                                setInspectorFilter(value);
                                setPage(1);
                            }}
                            label="按登记人筛选"
                            options={["全部登记人", ...inspectors]}
                        />
                        <MobileSortSelect
                            columns={ledgerSort.columns}
                            value={sort}
                            onChange={next => {
                                if (next) setSort(next);
                            }}
                        />
                    </ListToolbar>

                    <div className="mobile-records">
                        <ListState loading={isLoading} empty={!pageRows.length}>
                            {pageRows.map(row => {
                                const bom = bomIndex.get(row.bomCode);
                                return (
                                    <RecordCard
                                        key={row.no}
                                        title={row.no}
                                        subtitle={row.date}
                                        voided={row.status === "voided"}
                                        badge={
                                            <Badge tone={row.status === "voided" ? "danger" : "success"}>
                                                {inboundStateLabel(row)}
                                            </Badge>
                                        }
                                        actions={
                                            <Button variant="secondary" onClick={() => setVoucher(row)}>
                                                查看详情
                                            </Button>
                                        }
                                    >
                                        <BomCell categories={snap.bomCategories} bom={bom} bomCode={row.bomCode} />
                                        {/* 有工艺差异才挂警示条，与桌面表格「空值低调、非空警示」一致 */}
                                        {!!bom?.remark?.trim() && (
                                            <BomRemarkNote remark={bom.remark} className="mt-2" />
                                        )}
                                        <div className="mt-2 flex flex-col gap-1.5">
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
                                            className="cell-pad-wide"
                                        />
                                        <SortTh
                                            label="BOM 编码"
                                            active={sort.key === "bomCode"}
                                            dir={sort.dir}
                                            onSort={() => applySort("bomCode")}
                                        />
                                        <th>BOM 备注</th>
                                        <SortTh
                                            label="入库数量（个）"
                                            active={sort.key === "qty"}
                                            dir={sort.dir}
                                            onSort={() => applySort("qty")}
                                        />
                                        <SortTh
                                            label="入库日期"
                                            active={sort.key === "date"}
                                            dir={sort.dir}
                                            onSort={() => applySort("date")}
                                        />
                                        <th>检验登记人</th>
                                        <th className="cell-pad-wide text-center">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.length === 0 && (
                                        <EmptyRow colSpan={7} description="没有找到匹配的入库记录" />
                                    )}
                                    {pageRows.map(row => {
                                        const bom = bomIndex.get(row.bomCode);
                                        const voided = row.status === "voided";
                                        return (
                                            <tr key={row.no} className={voided ? "row-voided" : undefined}>
                                                <td className="cell-pad-wide tnum text-14 font-semibold text-td-strong">
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
                                                <td>
                                                    <BomCell
                                                        categories={snap.bomCategories}
                                                        bom={bom}
                                                        bomCode={row.bomCode}
                                                    />
                                                </td>
                                                <td>
                                                    <RemarkCell remark={bom?.remark} variant="warning" />
                                                </td>
                                                <td>
                                                    <QtyCell value={row.qty} />
                                                </td>
                                                <td className="tnum text-14 text-td">{row.date}</td>
                                                <td className="text-14 text-td">{row.inspector}</td>
                                                <td className="cell-pad-wide text-center">
                                                    <TableLink onClick={() => setVoucher(row)}>查看详情</TableLink>
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
                            onPageSizeChange={onPageSizeChange}
                        />
                    </div>
                </section>

                {canRegister && <InboundModal open={newOpen} onClose={() => setNewOpen(false)} />}
                <VoucherModal
                    row={currentVoucher}
                    onClose={() => setVoucher(null)}
                    actions={
                        currentVoucher && (
                            <>
                                {voidableNow(currentVoucher) && (
                                    <Button
                                        size="sm"
                                        variant="danger-soft"
                                        disabled={voidRequest.isPending}
                                        onClick={() => setVoidTarget(currentVoucher)}
                                    >
                                        作废
                                    </Button>
                                )}
                                {editableToday(currentVoucher) && (
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={voidRequest.isPending}
                                        onClick={() => setEditTarget(currentVoucher)}
                                    >
                                        修正
                                    </Button>
                                )}
                                {/* 已作废记录的清理入口：软删除（7 天后悔期），仅持有删除权限者可见 */}
                                {canDeleteVoided && currentVoucher.status === "voided" && (
                                    <Button
                                        size="sm"
                                        variant="danger-soft"
                                        disabled={deleteRequest.isPending}
                                        onClick={() => setDeleteTarget(currentVoucher)}
                                    >
                                        删除
                                    </Button>
                                )}
                            </>
                        )
                    }
                />
                {editTarget && <EditInboundModal row={editTarget} onClose={() => setEditTarget(null)} />}
                {voidTarget && (
                    <VoidReasonModal
                        title="作废入库单"
                        subtitle={`${voidTarget.no} · ${voidTarget.bomCode}`}
                        formId={`void-inbound-${voidTarget.no}`}
                        pending={voidRequest.isPending}
                        confirmLabel={isToday(voidTarget) ? "确认作废" : "确认跨天作废"}
                        placeholder="例如：入库数量登记错误"
                        onClose={() => setVoidTarget(null)}
                        onConfirm={reason =>
                            voidRequest.mutate(
                                { no: voidTarget.no, expectedVersion: voidTarget.version, reason },
                                {
                                    onSuccess: updated => {
                                        setVoidTarget(null);
                                        toast.success(
                                            `${updated.no} 已作废，${updated.bomCode} 库存减少 ${num(updated.qty)} 个`,
                                        );
                                    },
                                },
                            )
                        }
                    >
                        <DangerNote
                            className="mb-4"
                            impact={`作废后，${voidTarget.bomCode} 库存减少 ${num(voidTarget.qty)} 个`}
                            note="若成品已出库、库存不够扣"
                            action="需先作废相关出库单，才能作废本单"
                        />
                        {/* 跨天作废（持 inbound:void-any-day 超管对非当天记录的操作）：加二次确认警示 */}
                        {!isToday(voidTarget) && (
                            <p className="mb-4 flex items-start gap-2 text-13 leading-5 text-warning">
                                <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                                这笔记录不是今天登记的，作废会改动历史库存统计。
                            </p>
                        )}
                    </VoidReasonModal>
                )}
                {deleteTarget && (
                    <DeleteInboundModal
                        row={deleteTarget}
                        pending={deleteRequest.isPending}
                        onClose={() => setDeleteTarget(null)}
                        onConfirm={() =>
                            deleteRequest.mutate(
                                { no: deleteTarget.no, expectedVersion: deleteTarget.version },
                                {
                                    onSuccess: () => {
                                        setDeleteTarget(null);
                                        setVoucher(null);
                                        toast.success(`入库单 ${deleteTarget.no} 已删除`);
                                    },
                                },
                            )
                        }
                    />
                )}
            </div>
        </SnapProvider>
    );
}

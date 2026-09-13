import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, RecordCard } from "@/components/ui/MobileList";
import { EmptyState } from "@/components/ui/EmptyState";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { downloadCsv, num } from "@/lib/format";
import { useApp } from "@/context/AppContext";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button, TableLink } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { SelectField, TextField } from "@/components/ui/Field";
import { SelectMenuField } from "@/components/ui/SelectMenuField";
import { useCreateBom, useWbRefresh, useWbSnapshot } from "@/data/queries";
import { LoadingOverlay, useDelayedFlag } from "@/components/ui/LoadingOverlay";
import { PageLoading } from "@/components/ui/PageLoading";
import { useToast } from "@/components/ui/Toast";
import { BOM_CATEGORIES, categoryOf, defaultsOf, nextBomCode } from "@/data/categories";
import {
    bomFieldOptions,
    bomSelectorOptionLabel,
    buildBomSelectorSchema,
    filterBomsBySelections,
} from "@/data/bomSelection";
import type { Bom } from "@/api";

const EMPTY_BOMS: Bom[] = [];

/* BOM 规格行：品类 + 型号 + 各品类规格键值对 */
function specLines(bom: Bom) {
    return [
        ["品类", bom.name],
        ["型号", bom.modelCode],
        ...Object.entries(bom.specs).map(([key, value]) => [key, value || "—"] as [string, string]),
    ];
}

export function BomDetailModal({ bom, onClose }: { bom: Bom | null; onClose: () => void }) {
    if (!bom) return null;
    return (
        <Modal
            open={!!bom}
            onClose={onClose}
            label="BOM 详情"
            title={bom.code}
            subtitle={`${bom.name} · ${bom.modelCode}`}
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
            <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {specLines(bom).map(([label, value]) => (
                        <div key={label} className="rounded-btn border border-line px-3 py-2">
                            <div className="text-11 text-muted">{label}</div>
                            <div className="truncate text-13 font-medium text-ink">{value}</div>
                        </div>
                    ))}
                </div>
                <div className="rounded-btn bg-primary-soft/70 px-3 py-2 text-12.5 text-primary-strong">{bom.spec}</div>
            </div>
        </Modal>
    );
}

/* 新建弹窗各品类型号输入示例 */
const MODEL_PLACEHOLDERS: Record<string, string> = {
    旋转开关: "如 2-1",
    XK3: "如 XK3",
    新微动: "如 KW-1",
    老微动: "如 KW16",
    琴键开关: "如 KQ-1",
};

interface SpecRow {
    id: number;
    key: string;
    value: string;
}

const blankSpecRow = (id: number): SpecRow => ({ id, key: "", value: "" });
const RESERVED_SPEC_KEYS = new Set(["品类", "型号", "BOM编码", "BOM 编码"].map(key => key.toLocaleLowerCase()));

function NewBomModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { data } = useWbSnapshot();
    const createBom = useCreateBom();
    const toast = useToast();
    const [name, setName] = useState("");
    const [modelCode, setModelCode] = useState("");
    const [specRows, setSpecRows] = useState<SpecRow[]>([blankSpecRow(0)]);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const nextRowId = useRef(1);

    const boms = data?.boms ?? EMPTY_BOMS;
    const category = categoryOf(name);
    const fixedSpecs = useMemo(() => (category ? defaultsOf(category) : {}), [category]);
    const customSpecs = useMemo(
        () =>
            Object.fromEntries(
                specRows
                    .filter(row => row.key.trim() && row.value.trim())
                    .map(row => [row.key.trim(), row.value.trim()]),
            ),
        [specRows],
    );
    const previewSpecs = useMemo(() => ({ ...fixedSpecs, ...customSpecs }), [fixedSpecs, customSpecs]);

    const nextCode = useMemo(() => (category ? nextBomCode(name, boms) : "—"), [category, name, boms]);

    const pickCategory = (next: string) => {
        setName(next);
        setModelCode("");
        nextRowId.current = 1;
        setSpecRows([blankSpecRow(0)]);
        setErrors({});
    };

    const updateSpecRow = (id: number, patch: Partial<Pick<SpecRow, "key" | "value">>) => {
        setSpecRows(current => current.map(row => (row.id === id ? { ...row, ...patch } : row)));
        setErrors(current => ({ ...current, specs: "", [`spec-key-${id}`]: "", [`spec-value-${id}`]: "" }));
    };

    const addSpecRow = () => {
        setSpecRows(current => [...current, blankSpecRow(nextRowId.current++)]);
    };

    const removeSpecRow = (id: number) => {
        setSpecRows(current =>
            current.length === 1 ? [blankSpecRow(current[0]!.id)] : current.filter(row => row.id !== id),
        );
        setErrors(current => ({ ...current, specs: "", [`spec-key-${id}`]: "", [`spec-value-${id}`]: "" }));
    };

    const submit = () => {
        const nextErrors: Record<string, string> = {};
        if (!category) nextErrors.name = "请选择产品品类";
        if (!modelCode.trim()) nextErrors.modelCode = "请填写型号";
        const activeRows = specRows.filter(row => row.key.trim() || row.value.trim());
        if (activeRows.length === 0) {
            nextErrors.specs = "请至少添加一项规格";
            nextErrors[`spec-key-${specRows[0]!.id}`] = "请填写规格名称";
        }

        const fixedKeys = new Set(Object.keys(fixedSpecs).map(key => key.toLocaleLowerCase()));
        const usedKeys = new Set<string>();
        activeRows.forEach(row => {
            const key = row.key.trim();
            const normalizedKey = key.toLocaleLowerCase();
            if (!key) nextErrors[`spec-key-${row.id}`] = "请填写规格名称";
            if (!row.value.trim()) nextErrors[`spec-value-${row.id}`] = "请填写规格值";
            if (key && RESERVED_SPEC_KEYS.has(normalizedKey))
                nextErrors[`spec-key-${row.id}`] = "该名称为系统字段，请换一个名称";
            else if (key && fixedKeys.has(normalizedKey))
                nextErrors[`spec-key-${row.id}`] = "该规格已由品类固定，无需重复添加";
            else if (key && usedKeys.has(normalizedKey)) nextErrors[`spec-key-${row.id}`] = "规格名称不能重复";
            if (key) usedKeys.add(normalizedKey);
        });
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length)
            requestAnimationFrame(() =>
                document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus(),
            );
        if (Object.keys(nextErrors).length > 0) return;
        createBom.mutate(
            { name, modelCode: modelCode.trim(), specs: { ...fixedSpecs, ...customSpecs } },
            {
                onError: error => toast(error.message, true),
                onSuccess: bom => {
                    toast(`BOM ${bom.code} 已创建`);
                    onClose();
                    pickCategory("");
                },
            },
        );
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="新建 BOM"
            subtitle="规格名称和值按实际物料自由添加，不受预设格式限制"
            width={680}
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
                        disabled={createBom.isPending}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-primary px-4 text-13 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                    >
                        {createBom.isPending ? "正在保存…" : "保存 BOM"}
                    </button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField
                        label="① 产品品类"
                        required
                        error={errors.name}
                        value={name}
                        onChange={event => pickCategory(event.target.value)}
                    >
                        <option value="">请选择</option>
                        {BOM_CATEGORIES.map(item => (
                            <option key={item.name}>{item.name}</option>
                        ))}
                    </SelectField>
                    <TextField
                        label={category?.name === "旋转开关" ? "② 型号 · 触点面" : "② 型号"}
                        required
                        placeholder={(category && MODEL_PLACEHOLDERS[category.name]) || "请先选择品类"}
                        error={errors.modelCode}
                        value={modelCode}
                        onChange={event => setModelCode(event.target.value)}
                    />
                </div>

                {Object.keys(fixedSpecs).length > 0 && (
                    <div className="rounded-btn border border-line bg-panel px-3.5 py-3">
                        <p className="text-11.5 font-semibold text-td">品类固定规格（保存时自动带入）</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {Object.entries(fixedSpecs).map(([key, value]) => (
                                <span
                                    key={key}
                                    className="rounded-md bg-white px-2 py-1 text-11.5 text-muted shadow-xs"
                                >
                                    {key}：{value}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                <fieldset className="rounded-panel border border-line p-4">
                    <legend className="px-1.5 text-12.5 font-semibold text-primary">③ 自定义规格</legend>
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                        <p className="max-w-105 text-12 text-muted">
                            规格名称与规格值均可自由填写，例如“底座 / 带 CB”。
                        </p>
                        <Button variant="secondary" icon="plus" onClick={addSpecRow}>
                            添加规格
                        </Button>
                    </div>
                    <div className="flex flex-col gap-2.5">
                        {specRows.map((row, index) => (
                            <div
                                key={row.id}
                                className="grid gap-2 rounded-btn border border-line bg-panel/50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]"
                            >
                                <TextField
                                    label={`规格 ${index + 1} 名称`}
                                    required={index === 0 || Boolean(row.key || row.value)}
                                    placeholder="如 底座"
                                    error={errors[`spec-key-${row.id}`]}
                                    value={row.key}
                                    onChange={event => updateSpecRow(row.id, { key: event.target.value })}
                                />
                                <TextField
                                    label="规格值"
                                    required={index === 0 || Boolean(row.key || row.value)}
                                    placeholder="如 带 CB"
                                    error={errors[`spec-value-${row.id}`]}
                                    value={row.value}
                                    onChange={event => updateSpecRow(row.id, { value: event.target.value })}
                                />
                                <div className="flex items-end">
                                    <button
                                        type="button"
                                        aria-label={`删除规格 ${index + 1}`}
                                        onClick={() => removeSpecRow(row.id)}
                                        className="min-h-10 w-full rounded-btn border border-line-strong bg-white px-3 text-12.5 font-medium text-muted transition hover:border-danger hover:text-danger sm:w-auto"
                                    >
                                        删除
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                    {errors.specs && (
                        <p role="alert" className="mt-2 text-12 text-danger">
                            {errors.specs}
                        </p>
                    )}
                </fieldset>

                <div className="rounded-xl border border-line bg-panel px-3.5 py-3 text-12.5">
                    <div className="mb-1 font-semibold text-ink">预览</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted sm:grid-cols-3">
                        <span>品类：{name || "—"}</span>
                        <span className="tnum">BOM 编码：{nextCode}</span>
                        <span>型号：{modelCode.trim() || "—"}</span>
                        {Object.entries(previewSpecs).map(([key, value]) => (
                            <span key={key} className="break-words">
                                {key}：{value}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </Modal>
    );
}

/* 快速查找：品类选定后，规格选项一次全展示、选项池固定，匹配结果实时列出（不下钻、不跳变） */
function QuickFindModal({
    open,
    onClose,
    onDetail,
}: {
    open: boolean;
    onClose: () => void;
    onDetail: (bom: Bom) => void;
}) {
    const { data } = useWbSnapshot();
    const [category, setCategory] = useState("");
    const [selections, setSelections] = useState<Record<string, string>>({});
    const boms = data?.boms ?? EMPTY_BOMS;
    const categories = useMemo(() => [...new Set(boms.map(bom => bom.name))], [boms]);
    const categoryBoms = useMemo(() => (category ? boms.filter(bom => bom.name === category) : []), [boms, category]);
    const selectorSchema = useMemo(
        () =>
            buildBomSelectorSchema(
                categoryBoms,
                categoryOf(category)?.fields.map(field => field.key),
            ),
        [categoryBoms, category],
    );
    const specFields = useMemo(
        () => selectorSchema.fields.filter(field => field.kind === "spec"),
        [selectorSchema.fields],
    );
    const fieldOptions = useMemo(
        () => specFields.map(field => ({ field, options: bomFieldOptions(categoryBoms, field) })),
        [specFields, categoryBoms],
    );
    const matches = useMemo(
        () => filterBomsBySelections(categoryBoms, specFields, selections),
        [categoryBoms, specFields, selections],
    );
    const hasSelection = specFields.some(field => selections[field.id]);

    const pickCategory = (next: string) => {
        setCategory(next);
        setSelections({});
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="快速查找 BOM"
            subtitle="品类与规格选项一次全部展示，匹配结果实时收窄"
            width={560}
            footer={
                <button
                    type="button"
                    onClick={onClose}
                    className="min-h-10 rounded-btn border border-line-strong bg-white px-4 text-13 font-medium text-ink hover:border-primary-border"
                >
                    关闭
                </button>
            }
        >
            <div className="flex flex-col gap-3">
                <SelectMenuField
                    label="品类"
                    value={category}
                    placeholder="请选择品类"
                    options={categories.map(item => ({ value: item, label: item }))}
                    onValueChange={pickCategory}
                />

                {!category && <p className="py-6 text-center text-12.5 text-subtle">请先选择品类，再按规格缩小范围</p>}

                {category && (
                    <>
                        {fieldOptions.length > 0 && (
                            <div className="grid gap-3 sm:grid-cols-2">
                                {fieldOptions.map(({ field, options }) => (
                                    <SelectMenuField
                                        key={field.id}
                                        label={field.label}
                                        value={selections[field.id] ?? ""}
                                        placeholder={`全部${field.label}`}
                                        options={options.map(option => ({
                                            value: option,
                                            label: bomSelectorOptionLabel(option),
                                        }))}
                                        onValueChange={value =>
                                            setSelections(current => ({ ...current, [field.id]: value }))
                                        }
                                    />
                                ))}
                            </div>
                        )}

                        {selectorSchema.fixedSpecs.length > 0 && (
                            <div className="rounded-btn border border-line bg-panel px-3.5 py-3">
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

                        <div>
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <p className="text-12 text-muted" aria-live="polite">
                                    匹配 {num(matches.length)} 条 BOM
                                </p>
                                {hasSelection && (
                                    <button
                                        type="button"
                                        onClick={() => setSelections({})}
                                        className="min-h-10 cursor-pointer rounded-btn border border-line-strong bg-white px-3 text-12 font-medium text-muted transition hover:border-primary-border hover:text-primary"
                                    >
                                        清空选择
                                    </button>
                                )}
                            </div>
                            <div className="flex max-h-70 flex-col gap-1.5 overflow-y-auto">
                                {matches.length === 0 && (
                                    <p className="py-3 text-center text-12.5 text-subtle">没有匹配的 BOM，请调整选择</p>
                                )}
                                {matches.map(bom => (
                                    <button
                                        key={bom.code}
                                        type="button"
                                        onClick={() => onDetail(bom)}
                                        className={`cursor-pointer rounded-btn border px-3 py-2 text-left transition hover:border-primary-border hover:bg-primary-soft/40 ${
                                            matches.length === 1
                                                ? "border-primary-border bg-primary-soft/50"
                                                : "border-line"
                                        }`}
                                    >
                                        <span className="text-11.5 font-medium text-muted">
                                            {bom.name} · {bom.modelCode}
                                        </span>
                                        <span className="tnum ml-2 text-12.5 font-semibold text-primary-strong">
                                            {bom.code}
                                        </span>
                                        {matches.length === 1 && (
                                            <span className="ml-2 rounded-full bg-white px-1.5 py-0.5 text-10.5 font-medium text-success">
                                                已定位
                                            </span>
                                        )}
                                        <span className="mt-0.5 block truncate text-11.5 text-muted">{bom.spec}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}

export function BomPage() {
    const { can } = useApp();
    const { data, isLoading, isFetching } = useWbSnapshot();
    const { refresh } = useWbRefresh();
    // 首载出替换式占位,后台刷新出保留式遮罩(200ms 内完成不闪现)
    const overlay = useDelayedFlag(isFetching && !isLoading);
    const [searchParams, setSearchParams] = useSearchParams();
    const toast = useToast();
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("全部品类");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [newOpen, setNewOpen] = useState(false);
    const [quickOpen, setQuickOpen] = useState(false);
    const [detail, setDetail] = useState<Bom | null>(null);

    const boms = data?.boms ?? EMPTY_BOMS;
    const categories = useMemo(() => [...new Set(boms.map(bom => bom.name))], [boms]);

    const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return boms
            .filter(bom => category === "全部品类" || bom.name === category)
            .filter(bom => !kw || `${bom.code} ${bom.name} ${bom.modelCode} ${bom.spec}`.toLowerCase().includes(kw));
    }, [boms, keyword, category]);

    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
    const canCreate = can("bom:create");

    useEffect(() => {
        if (searchParams.get("new") === "bom") {
            setNewOpen(true);
            setSearchParams({}, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    return (
        <div className="flex flex-col gap-5">
            <PageHeading
                title="物料与 BOM"
                actions={
                    canCreate ? (
                        <>
                            <Button variant="secondary" icon="search" onClick={() => setQuickOpen(true)}>
                                快速查找 BOM
                            </Button>
                            <Button icon="plus" onClick={() => setNewOpen(true)}>
                                新建 BOM
                            </Button>
                        </>
                    ) : (
                        <Button variant="secondary" icon="search" onClick={() => setQuickOpen(true)}>
                            快速查找 BOM
                        </Button>
                    )
                }
            />

            <section className="relative overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
                {overlay && <LoadingOverlay />}
                <div className="list-toolbar flex flex-wrap items-center justify-between gap-2.5 border-b border-line bg-gradient-to-b from-white to-panel px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2.5">
                        <label className="flex h-10 min-w-55 items-center gap-2 rounded-btn border border-line-strong bg-white px-3 sm:w-75">
                            <Icon name="search" size={15} className="text-subtle" />
                            <input
                                value={keyword}
                                onChange={event => {
                                    setKeyword(event.target.value);
                                    setPage(1);
                                }}
                                placeholder="搜索编码 / 品类 / 型号 / 规格"
                                className="w-full bg-transparent text-13 text-ink outline-none placeholder:text-subtle"
                            />
                        </label>
                        <select
                            value={category}
                            onChange={event => {
                                setCategory(event.target.value);
                                setPage(1);
                            }}
                            className="h-10 rounded-btn border border-line-strong bg-white px-3 text-13 text-ink"
                            aria-label="按品类筛选"
                        >
                            <option>全部品类</option>
                            {categories.map(item => (
                                <option key={item}>{item}</option>
                            ))}
                        </select>
                    </div>
                    <ToolbarMore>
                        <Button
                            variant="secondary"
                            icon="reset"
                            data-low-priority="true"
                            onClick={() => {
                                setKeyword("");
                                setCategory("全部品类");
                                setPage(1);
                            }}
                        >
                            重置
                        </Button>
                        <Button variant="secondary" icon="refresh" data-low-priority="true" onClick={refresh}>
                            刷新
                        </Button>
                        <Button
                            variant="secondary"
                            icon="download"
                            data-low-priority="true"
                            onClick={() =>
                                downloadCsv(
                                    "BOM",
                                    ["序号", "BOM编码", "品类", "型号", "单位", "规格"],
                                    pageRows.map((bom, index) => [
                                        String((page - 1) * pageSize + index + 1),
                                        bom.code,
                                        bom.name,
                                        bom.modelCode,
                                        bom.unit,
                                        bom.spec,
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
                        {pageRows.map(bom => (
                            <RecordCard
                                key={bom.code}
                                title={`${bom.name} · ${bom.modelCode}`}
                                subtitle={bom.code}
                                actions={<Button onClick={() => setDetail(bom)}>查看规格</Button>}
                            >
                                <p>{bom.spec}</p>
                                <p className="mt-2 text-13 text-muted">库存 {num(data?.stock[bom.code] ?? 0)} 件</p>
                            </RecordCard>
                        ))}
                    </ListState>
                </div>
                <div className="hidden overflow-x-auto lg:block">
                    {isLoading ? (
                        <PageLoading className="py-16" />
                    ) : (
                        <table className="w-full min-w-230 border-collapse">
                            <thead>
                                <tr className="bg-soft text-left text-12 text-muted">
                                    <th className="px-5 py-2.5 font-semibold" style={{ width: "6%" }}>
                                        序号
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "16%" }}>
                                        BOM 编码
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "10%" }}>
                                        品类
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "8%" }}>
                                        型号
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "9%" }}>
                                        单位（个）
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold">规格</th>
                                    <th className="px-5 py-2.5 text-right font-semibold" style={{ width: "10%" }}>
                                        操作
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-5 py-10 text-center">
                                            <EmptyState description="暂无 BOM" />
                                        </td>
                                    </tr>
                                )}
                                {pageRows.map((bom, index) => (
                                    <tr
                                        key={bom.code}
                                        className="border-t border-line/70 transition hover:bg-row-hover"
                                    >
                                        <td className="px-5 py-3 tnum text-13 text-muted">
                                            {(page - 1) * pageSize + index + 1}
                                        </td>
                                        <td className="px-3 py-3">
                                            <button
                                                type="button"
                                                onClick={() => setDetail(bom)}
                                                className="tnum text-13 font-semibold text-primary-strong underline-offset-2 hover:underline"
                                            >
                                                {bom.code}
                                            </button>
                                        </td>
                                        <td className="px-3 py-3 text-13 text-td">{bom.name}</td>
                                        <td className="px-3 py-3">
                                            <span className="inline-block rounded-md border border-indigo-100 bg-primary-soft px-1.5 py-0.5 text-11.5 font-medium text-primary-strong">
                                                {bom.modelCode}
                                            </span>
                                        </td>
                                        <td className="px-3 py-3 tnum text-13 text-td">1</td>
                                        <td className="px-3 py-3">
                                            <span
                                                className="block max-w-90 truncate text-12.5 text-td"
                                                title={bom.spec}
                                            >
                                                {bom.spec}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <TableLink onClick={() => setDetail(bom)}>查看详情</TableLink>
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
                        unit="条 BOM"
                        onPageChange={setPage}
                        onPageSizeChange={size => {
                            setPageSize(size);
                            setPage(1);
                        }}
                    />
                </div>
            </section>

            {canCreate && <NewBomModal open={newOpen} onClose={() => setNewOpen(false)} />}
            <QuickFindModal
                open={quickOpen}
                onClose={() => setQuickOpen(false)}
                onDetail={bom => {
                    setQuickOpen(false);
                    setDetail(bom);
                    toast(`已定位到 ${bom.code}`);
                }}
            />
            <BomDetailModal bom={detail} onClose={() => setDetail(null)} />
        </div>
    );
}

import { BomCell } from "@/components/bom/BomCell";
import { RemarkCell } from "@/components/ui/RemarkCell";
import { DataTable } from "@/components/ui/DataTable";
import { SortTh } from "@/components/ui/SortTh";
import { nextSortState, type SortState } from "@/lib/tableSort";
import { ToolbarMore } from "@/components/ui/ToolbarMore";
import { ListState, RecordCard, CardField } from "@/components/ui/MobileList";
import { EmptyState } from "@/components/ui/EmptyState";
import { BomSpecs } from "@/components/bom/BomSpecs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "@/lib/icons";
import { downloadCsv, num } from "@/lib/format";
import { formatDateTime } from "@/lib/date";
import { copyText } from "@/lib/clipboard";
import { useApp } from "@/context/useApp";
import { isApiError } from "@/http";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { Button, TableLink } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { SelectField } from "@/components/ui/Field";
import {
    useBomCategories,
    useBomRefresh,
    useBomStocks,
    useBomUsage,
    useBoms,
    useCreateBom,
    useDeleteBom,
} from "@/data/queries";
import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useDelayedFlag } from "@/components/ui/useDelayedFlag";
import { PageLoading } from "@/components/ui/PageLoading";
import { useToast } from "@/components/ui/toastContexts";
import { catalogRowsOf } from "@/data/categories";
import type { Bom, BomCatalogNode, BomCategory } from "@/api";
import { cn } from "@/lib/utils";

const EMPTY_BOMS: Bom[] = [];

export function BomDetailModal({
    bom,
    onClose,
    categories,
    onDelete,
}: {
    bom: Bom | null;
    onClose: () => void;
    categories?: BomCategory[];
    onDelete?: () => void;
}) {
    const toast = useToast();
    if (!bom) return null;
    const copyCode = async () => {
        if (await copyText(bom.code)) toast(`已复制 ${bom.code}`);
    };
    return (
        <Modal
            open={!!bom}
            onClose={onClose}
            label="BOM 详情"
            title={bom.code}
            titleExtra={
                <button
                    type="button"
                    onClick={copyCode}
                    aria-label="复制 BOM 编号"
                    title="复制 BOM 编号"
                    className="flex min-h-7 min-w-7 items-center justify-center rounded-md text-muted transition hover:bg-primary-soft hover:text-primary"
                >
                    <Icon name="copy" size={14} />
                </button>
            }
            width={560}
            layout="detail"
            footer={
                <>
                    {onDelete && (
                        <button
                            type="button"
                            onClick={onDelete}
                            className="mr-auto min-h-10 rounded-btn border border-danger/30 bg-danger-soft px-4 text-14 font-medium text-danger"
                        >
                            删除 BOM
                        </button>
                    )}
                    <Button variant="secondary" onClick={onClose}>
                        关闭
                    </Button>
                </>
            }
        >
            <BomSpecs bom={bom} categories={categories} />
            <section
                aria-label="BOM 备注"
                className="mt-4 rounded-input border border-dashed border-line-strong bg-warning-soft/40 p-3.5"
            >
                <h3 className="text-13 font-medium text-muted">BOM 备注</h3>
                <p className="mt-1.5 whitespace-pre-wrap text-14 leading-6 text-td wrap-anywhere">
                    {bom.remark || "—"}
                </p>
            </section>
            <p className="mt-3 text-13 text-muted">
                创建人 {bom.creator} · {formatDateTime(bom.created)}
            </p>
        </Modal>
    );
}

/* 目录树块：按接口下发的顺序分块——顶级节点（分区与根分组）依序穿插，
 * 分组的物料挂在前面最近的分区下；触点等后置分区自然排在末尾 */
interface CatalogBlock {
    section: BomCatalogNode | null;
    groups: BomCatalogNode[];
}

const catalogBlocksOf = (category: { groups: BomCatalogNode[] }): CatalogBlock[] => {
    const blocks: CatalogBlock[] = [];
    for (const node of category.groups) {
        if (node.kind === "section") {
            blocks.push({ section: node, groups: [] });
        } else if (node.parentId === null) {
            blocks.push({ section: null, groups: [node] });
        } else {
            blocks.at(-1)?.groups.push(node);
        }
    }
    return blocks;
};

/* 删除 BOM 二次确认（仅超级管理员）：只服务"手误建档后无法清理"场景，
 * 入口仅对未被销售订单引用且无库存余量的档案显示；后端仍独立校验引用 */
function DeleteBomModal({ bom, onClose }: { bom: Bom | null; onClose: () => void }) {
    const deleteBom = useDeleteBom();
    const toast = useToast();
    if (!bom) return null;
    const submit = () => {
        if (deleteBom.isPending) return;
        deleteBom.mutate(bom.code, {
            onSuccess: () => {
                toast(`BOM ${bom.code} 已删除`);
                onClose();
            },
            onError: error => toast(error.message, true),
        });
    };
    return (
        <Modal
            open
            onClose={onClose}
            label="危险操作"
            title="删除 BOM"
            subtitle={bom.code}
            width={440}
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
                        disabled={deleteBom.isPending}
                        onClick={submit}
                        className="min-h-10 rounded-btn bg-danger px-4 text-14 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
                    >
                        {deleteBom.isPending ? "正在删除…" : "确认删除"}
                    </button>
                </>
            }
        >
            <div className="flex items-start gap-3 rounded-panel border border-[#fecdca] bg-danger-soft/60 p-4">
                <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-danger" />
                <div className="text-14 leading-6 text-td">
                    即将删除 BOM <span className="tnum font-semibold text-ink">{bom.code}</span>（{bom.name}
                    ）。该 BOM 未被任何销售订单引用。
                    <p className="mt-1 font-medium text-danger">
                        删除后该档案将从系统永久移除，不可恢复。请确认它是手误创建的档案。
                    </p>
                </div>
            </div>
        </Modal>
    );
}

/* 新建 BOM：品类 →（品类子选，跌倒开关选微动类型）→ 左框树状目录勾选（无搜索）→ 右框已选 → 保存 */
export function NewBomModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { data: bomCategories } = useBomCategories();
    const createBom = useCreateBom();
    const toast = useToast();
    const [name, setName] = useState("");
    const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
    const [childCategoryKey, setChildCategoryKey] = useState("");
    const [pendingChange, setPendingChange] = useState<{ kind: "category" | "child"; value: string } | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    /* 建档备注（工艺差异，参与判重）；保存命中重复时展示已有编码 */
    const [remark, setRemark] = useState("");
    const [duplicateCode, setDuplicateCode] = useState<string | null>(null);

    const category = bomCategories?.find(item => item.name === name);
    const childCategory = bomCategories?.find(item => item.key === childCategoryKey);
    /* 子选标签：旋转XK3 的变体是接线工艺（焊线/插线），其余为跌倒开关的微动类型 */
    const childLabel = category?.key === "rotary-xk3" ? "接线工艺" : "微动开关类型";
    /* 合并树：本品类目录 + 子品类目录（跌倒开关 = 跌倒盖/底/钢球/翘板 + 微动开关物料嵌套在"微动开关"大类下） */
    const tipoverBlocks = useMemo(() => (category ? catalogBlocksOf(category) : []), [category]);
    const childBlocks = useMemo(() => (childCategory ? catalogBlocksOf(childCategory) : []), [childCategory]);
    const catalogRows = useMemo(() => {
        const rows = [
            ...(category ? catalogRowsOf(category) : []),
            ...(childCategory ? catalogRowsOf(childCategory) : []),
        ];
        return rows;
    }, [category, childCategory]);
    const selectedRows = useMemo(() => catalogRows.filter(row => selectedIds.has(row.id)), [catalogRows, selectedIds]);
    /* 数量分组（qty=true）的物料 id 集：这些行在建档时携带 1-99 数量 */
    const qtyItemIds = useMemo(() => {
        const ids = new Set<string>();
        for (const catalog of [category, childCategory]) {
            for (const node of catalog?.groups ?? []) {
                if (node.kind === "group" && node.qty) {
                    node.items.forEach(item => ids.add(item.id));
                }
            }
        }
        return ids;
    }, [category, childCategory]);
    /* 右框按组分节：组名只出现一次，行内纯物料名（同名物料跨组时的消歧靠小节标题） */
    const selectedSections = useMemo(() => {
        const sections: Array<{ groupName: string; rows: typeof selectedRows }> = [];
        for (const row of selectedRows) {
            const last = sections.at(-1);
            if (last && last.groupName === row.groupName) {
                last.rows.push(row);
            } else {
                sections.push({ groupName: row.groupName, rows: [row] });
            }
        }
        return sections;
    }, [selectedRows]);

    const pickCategory = (next: string) => {
        setName(next);
        setSelectedIds(new Set());
        setQuantities({});
        setCollapsed(new Set());
        setChildCategoryKey("");
        setRemark("");
        setErrors({});
    };

    const pickChildCategory = (key: string) => {
        setChildCategoryKey(key);
        setSelectedIds(new Set());
        setQuantities({});
        setCollapsed(new Set());
        setRemark("");
        setErrors({});
    };

    /* 单选组：换选替换旧项、可再点取消；多选组：自由勾选；
     * 数量分组勾选时初始化数量为 1，取消时清掉数量 */
    const toggleItem = (node: BomCatalogNode, itemId: string) => {
        setSelectedIds(current => {
            const wasSelected = current.has(itemId);
            if (wasSelected) {
                const next = new Set(current);
                next.delete(itemId);
                return next;
            }
            const next = node.multi
                ? new Set(current)
                : new Set([...current].filter(id => !node.items.some(item => item.id === id)));
            next.add(itemId);
            return next;
        });
        setQuantities(current => {
            const next = { ...current };
            if (node.qty && !(itemId in next)) {
                next[itemId] = 1;
            } else {
                delete next[itemId];
            }
            return next;
        });
        setErrors(current => ({ ...current, materials: "" }));
    };

    /* 数量分组步进器：1-99 与后端校验同口径 */
    const changeQty = (itemId: string, delta: number) => {
        setQuantities(current => ({
            ...current,
            [itemId]: Math.min(99, Math.max(1, (current[itemId] ?? 1) + delta)),
        }));
    };

    const removeSelected = (itemId: string) => {
        setSelectedIds(current => {
            const next = new Set(current);
            next.delete(itemId);
            return next;
        });
        setQuantities(current => {
            const next = { ...current };
            delete next[itemId];
            return next;
        });
    };

    /* 仅多选组提供全选/清空（半选态由选中数量推断渲染） */
    const toggleGroupAll = (node: BomCatalogNode) => {
        const ids = node.items.map(item => item.id);
        const allSelected = ids.length > 0 && ids.every(id => selectedIds.has(id));
        setSelectedIds(current => {
            const next = new Set(current);
            for (const id of ids) {
                if (allSelected) {
                    next.delete(id);
                } else {
                    next.add(id);
                }
            }
            return next;
        });
    };

    const toggleCollapse = (nodeId: string) => {
        setCollapsed(current => {
            const next = new Set(current);
            if (next.has(nodeId)) {
                next.delete(nodeId);
            } else {
                next.add(nodeId);
            }
            return next;
        });
    };

    const submit = () => {
        const nextErrors: Record<string, string> = {};
        if (!category) nextErrors.name = "请选择产品品类";
        if ((category?.childCategories?.length ?? 0) > 0 && !childCategory) {
            nextErrors.childCategory = `请选择${childLabel}`;
        }
        if (selectedIds.size === 0) nextErrors.materials = "请至少选择一项物料";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;
        /* 仅数量分组的选中项携带数量；普通分组恒 1（后端同口径） */
        const quantitiesPayload: Record<string, number> = {};
        for (const id of selectedIds) {
            if (qtyItemIds.has(id)) {
                quantitiesPayload[id] = quantities[id] ?? 1;
            }
        }
        createBom.mutate(
            {
                name,
                materialItemIds: [...selectedIds],
                ...(Object.keys(quantitiesPayload).length > 0 ? { quantities: quantitiesPayload } : {}),
                ...(childCategory ? { childCategory: childCategory.key } : {}),
                ...(remark.trim() ? { remark: remark.trim() } : {}),
            },
            {
                /* 判重命中（品类+构成+备注 完全一致）：数据库未插入新档案，
                 * 弹层展示已有编码供复制，直接复用该编码下订单 */
                onError: error => {
                    if (isApiError(error) && error.code === 409) {
                        const code = error.message.match(/BOM 已存在：(\S+)/)?.[1];
                        if (code) {
                            setDuplicateCode(code);
                            return;
                        }
                    }
                    toast(error.message, true);
                },
                onSuccess: bom => {
                    toast(`BOM ${bom.code} 已创建`);
                    onClose();
                    pickCategory("");
                },
            },
        );
    };

    const renderChildBlock = ({ section, groups }: { section: BomCatalogNode | null; groups: BomCatalogNode[] }) => {
        const sectionCollapsed = section ? collapsed.has(section.id) : false;
        return (
            <div key={section?.id ?? groups[0]?.id ?? "child-root"}>
                {section && (
                    <button
                        type="button"
                        onClick={() => toggleCollapse(section.id)}
                        aria-expanded={!sectionCollapsed}
                        className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-13 font-semibold text-muted transition hover:text-td"
                    >
                        <Icon name={sectionCollapsed ? "chevron-right" : "chevron-down"} size={14} />
                        {section.name}
                    </button>
                )}
                <div className={cn("space-y-2", section && "mt-1.5 pl-4")}>
                    {!sectionCollapsed && groups.map(renderGroup)}
                </div>
            </div>
        );
    };

    const renderGroup = (node: BomCatalogNode) => {
        const selectedCount = node.items.filter(item => selectedIds.has(item.id)).length;
        const allSelected = node.items.length > 0 && selectedCount === node.items.length;
        const nodeCollapsed = collapsed.has(node.id);
        const selectedQtyItem = node.qty ? node.items.find(item => selectedIds.has(item.id)) : undefined;
        const selectedQty = selectedQtyItem ? (quantities[selectedQtyItem.id] ?? 1) : 1;
        return (
            <div key={node.id} className="rounded-btn border border-line bg-panel/60">
                <div className="flex min-h-9 items-center gap-1.5 px-2.5 py-1.5">
                    <button
                        type="button"
                        onClick={() => toggleCollapse(node.id)}
                        aria-expanded={!nodeCollapsed}
                        aria-label={`${nodeCollapsed ? "展开" : "折叠"}${node.name}`}
                        className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-md text-subtle transition hover:bg-row-hover hover:text-td"
                    >
                        <Icon name={nodeCollapsed ? "chevron-right" : "chevron-down"} size={13} />
                    </button>
                    <button
                        type="button"
                        onClick={() => toggleCollapse(node.id)}
                        className="flex-1 cursor-pointer text-left text-13 font-semibold text-td"
                    >
                        {node.name}
                    </button>
                    {nodeCollapsed && selectedCount > 0 && (
                        <span className="tnum shrink-0 rounded-full bg-primary-soft px-1.5 py-0.5 text-11 font-medium text-primary-strong">
                            {node.multi ? `已选 ${selectedCount}` : node.qty ? `已选 · ×${selectedQty}` : "已选"}
                        </span>
                    )}
                    {node.multi && node.items.length > 0 && (
                        <input
                            type="checkbox"
                            aria-label={`全选${node.name}`}
                            className="accent-primary"
                            checked={allSelected}
                            ref={input => {
                                if (input) input.indeterminate = selectedCount > 0 && !allSelected;
                            }}
                            onChange={() => toggleGroupAll(node)}
                        />
                    )}
                    {!node.multi &&
                        (node.qty ? (
                            <span className="shrink-0 rounded-full border border-[#fed7aa] bg-warning-soft px-1.5 py-0.5 text-11 font-medium text-[#9a3412]">
                                单选
                            </span>
                        ) : (
                            <span className="shrink-0 text-12 text-subtle">单选</span>
                        ))}
                </div>
                {!nodeCollapsed &&
                    (node.items.length === 0 ? (
                        <p className="border-t border-line px-3 py-1.5 text-13 text-subtle">暂无物料</p>
                    ) : (
                        <ul className="border-t border-line">
                            {node.items.map(item => (
                                <li key={item.id}>
                                    <div className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition hover:bg-row-hover">
                                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                                            <input
                                                type="checkbox"
                                                className="accent-primary"
                                                checked={selectedIds.has(item.id)}
                                                onChange={() => toggleItem(node, item.id)}
                                            />
                                            <span className="text-14 text-td wrap-anywhere">{item.name}</span>
                                        </label>
                                        {node.qty && selectedIds.has(item.id) && (
                                            <div className="flex shrink-0 items-center gap-0.5">
                                                <button
                                                    type="button"
                                                    aria-label={`${item.name} 数量减一`}
                                                    onClick={() => changeQty(item.id, -1)}
                                                    className="grid size-5 place-items-center rounded-md border border-line-strong bg-surface text-14 leading-none text-td transition hover:border-primary-border hover:bg-primary-soft hover:text-primary"
                                                >
                                                    −
                                                </button>
                                                <span className="tnum min-w-6 text-center text-13 font-semibold text-td">
                                                    ×{quantities[item.id] ?? 1}
                                                </span>
                                                <button
                                                    type="button"
                                                    aria-label={`${item.name} 数量加一`}
                                                    onClick={() => changeQty(item.id, 1)}
                                                    className="grid size-5 place-items-center rounded-md border border-line-strong bg-surface text-14 leading-none text-td transition hover:border-primary-border hover:bg-primary-soft hover:text-primary"
                                                >
                                                    +
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ))}
            </div>
        );
    };

    return (
        <>
            <Modal
                open={open}
                onClose={onClose}
                title="新建 BOM"
                width={1180}
                layout="workspace"
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
                            disabled={createBom.isPending}
                            onClick={submit}
                            className="min-h-10 rounded-btn bg-primary px-4 text-14 font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                        >
                            {createBom.isPending ? "正在保存…" : "保存 BOM"}
                        </button>
                    </>
                }
            >
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                    <SelectField
                        label="产品品类"
                        required
                        error={errors.name}
                        value={name}
                        onChange={event =>
                            selectedIds.size
                                ? setPendingChange({ kind: "category", value: event.target.value })
                                : pickCategory(event.target.value)
                        }
                    >
                        <option value="">请选择</option>
                        {(bomCategories ?? [])
                            .filter(item => item.status !== false)
                            .map(item => (
                                <option key={item.key}>{item.name}</option>
                            ))}
                    </SelectField>

                    {(category?.childCategories?.length ?? 0) > 0 && (
                        <fieldset aria-label={childLabel} className="shrink-0">
                            <legend className="mb-1 text-13 font-medium text-td">
                                {childLabel}
                                <span className="ml-1 text-danger">*</span>
                            </legend>
                            <div className="flex flex-wrap gap-3">
                                {category!.childCategories!.map(key => {
                                    const child = bomCategories?.find(item => item.key === key);
                                    return child ? (
                                        <label
                                            key={key}
                                            className={cn(
                                                "flex min-h-11 cursor-pointer items-center gap-2 rounded-input border px-4 text-14",
                                                childCategoryKey === key
                                                    ? "border-primary bg-primary-soft text-primary-strong"
                                                    : "border-line-strong bg-surface",
                                            )}
                                        >
                                            <input
                                                type="radio"
                                                name="bom-child-category"
                                                value={key}
                                                checked={childCategoryKey === key}
                                                aria-invalid={!!errors.childCategory}
                                                aria-describedby={errors.childCategory ? "bom-child-error" : undefined}
                                                onChange={() =>
                                                    selectedIds.size
                                                        ? setPendingChange({ kind: "child", value: key })
                                                        : pickChildCategory(key)
                                                }
                                                className="accent-primary"
                                            />
                                            {child.name}
                                        </label>
                                    ) : null;
                                })}
                            </div>
                            {errors.childCategory && (
                                <p id="bom-child-error" role="alert" className="mt-1 text-13 text-danger">
                                    {errors.childCategory}
                                </p>
                            )}
                        </fieldset>
                    )}

                    {(!category || ((category.childCategories?.length ?? 0) > 0 && !childCategoryKey)) && (
                        <div className="flex min-h-60 flex-1 items-center justify-center rounded-panel border border-dashed border-line-strong bg-panel p-8 text-center">
                            <div>
                                <p className="text-14 font-medium text-td">配置物料</p>
                                <p className="mt-2 text-14 text-muted">
                                    {category ? `请选择${childLabel}，随后配置物料` : "请选择产品品类，随后配置物料"}
                                </p>
                            </div>
                        </div>
                    )}

                    {category && (!category.childCategories?.length || childCategoryKey) && (
                        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,3fr)] lg:grid-rows-[minmax(0,1fr)]">
                            <fieldset className="flex min-h-0 flex-col rounded-panel border border-line bg-surface lg:overflow-hidden">
                                <legend className="px-1.5 text-13 font-semibold text-primary-strong">可选物料</legend>
                                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3">
                                    {/* 本品类物料（跌倒开关：跌倒盖/跌倒底/钢球/翘板） */}
                                    {tipoverBlocks.map(({ section, groups }) => {
                                        const sectionCollapsed = section ? collapsed.has(section.id) : false;
                                        return (
                                            <div key={section?.id ?? groups[0]?.id ?? "root"}>
                                                {section && (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleCollapse(section.id)}
                                                        aria-expanded={!sectionCollapsed}
                                                        className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-13 font-semibold text-muted transition hover:text-td"
                                                    >
                                                        <Icon
                                                            name={sectionCollapsed ? "chevron-right" : "chevron-down"}
                                                            size={14}
                                                        />
                                                        {section.name}
                                                    </button>
                                                )}
                                                <div className={cn("space-y-2", section && "mt-1.5 pl-4")}>
                                                    {!sectionCollapsed && groups.map(renderGroup)}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {/* 子品类物料树：父品类无自有目录（旋转XK3 选完工艺）时直接平铺，
                                     * 有自有目录（跌倒开关）时收进可折叠大类，与父品类物料区分 */}
                                    {childBlocks.length > 0 && tipoverBlocks.length === 0 && (
                                        <div className="space-y-2">{childBlocks.map(renderChildBlock)}</div>
                                    )}
                                    {childBlocks.length > 0 && tipoverBlocks.length > 0 && (
                                        <div className="mt-3 border-t border-line pt-3">
                                            <button
                                                type="button"
                                                onClick={() => toggleCollapse("child-category-wrapper")}
                                                aria-expanded={!collapsed.has("child-category-wrapper")}
                                                className="flex min-h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-13 font-semibold text-primary-strong transition hover:text-primary-strong"
                                            >
                                                <Icon
                                                    name={
                                                        collapsed.has("child-category-wrapper")
                                                            ? "chevron-right"
                                                            : "chevron-down"
                                                    }
                                                    size={14}
                                                />
                                                {childLabel}
                                            </button>
                                            {!collapsed.has("child-category-wrapper") && (
                                                <div className="mt-2 space-y-2">
                                                    {childBlocks.map(renderChildBlock)}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </fieldset>
                            <fieldset className="flex min-h-0 flex-col rounded-panel border border-line bg-panel/40 lg:overflow-hidden">
                                <legend className="px-1.5 text-13 font-semibold text-primary-strong">
                                    已选物料（{selectedRows.length}）
                                </legend>
                                <div
                                    className={cn(
                                        "min-h-0 flex-1 overflow-y-auto overscroll-contain p-3",
                                        selectedRows.length === 0 && "grid place-items-center",
                                    )}
                                >
                                    {selectedRows.length === 0 ? (
                                        <p className="text-center text-13 text-subtle">从左侧勾选物料</p>
                                    ) : (
                                        <div className="space-y-2.5">
                                            {selectedSections.map(section => (
                                                <div key={section.groupName}>
                                                    <p className="px-0.5 text-12 text-muted">{section.groupName}</p>
                                                    <ul className="mt-1 space-y-1.5">
                                                        {section.rows.map(row => (
                                                            <li
                                                                key={row.id}
                                                                className="flex items-center gap-2 rounded-btn border border-line bg-surface px-2.5 py-1.5"
                                                            >
                                                                <span className="min-w-0 flex-1 text-14 text-td wrap-anywhere">
                                                                    {row.name}
                                                                </span>
                                                                {qtyItemIds.has(row.id) && (
                                                                    <span className="tnum shrink-0 rounded-md bg-primary-soft px-2 py-0.5 text-13 font-semibold text-primary-strong">
                                                                        ×{quantities[row.id] ?? 1}
                                                                    </span>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    aria-label={`移除 ${row.name}`}
                                                                    onClick={() => removeSelected(row.id)}
                                                                    className="grid size-6 shrink-0 place-items-center rounded-md text-16 font-medium text-subtle transition hover:bg-danger/10 hover:text-danger"
                                                                >
                                                                    ×
                                                                </button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </fieldset>
                        </div>
                    )}

                    <fieldset className="shrink-0 rounded-panel border border-line bg-panel/40">
                        <legend className="px-1.5 text-13 font-semibold text-primary-strong">备注</legend>
                        <div className="p-2">
                            <textarea
                                value={remark}
                                onChange={event => setRemark(event.target.value)}
                                rows={1}
                                maxLength={500}
                                aria-label="BOM 备注"
                                placeholder="如：杆子白色。最多500字！！"
                                className="min-h-10 w-full resize-y rounded-input border border-line-strong bg-surface px-3 py-1.5 text-14 leading-5 text-td outline-none transition placeholder:text-subtle focus:border-primary"
                            />
                        </div>
                    </fieldset>

                    {errors.materials && (
                        <p role="alert" className="text-13 text-danger">
                            {errors.materials}
                        </p>
                    )}
                </div>
            </Modal>
            <Modal
                open={!!pendingChange}
                onClose={() => setPendingChange(null)}
                title="切换后将清空已选物料"
                width={440}
                footer={
                    <>
                        <button
                            type="button"
                            onClick={() => setPendingChange(null)}
                            className="min-h-10 rounded-btn border border-line-strong px-4 text-14"
                        >
                            保留当前配置
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (pendingChange) {
                                    if (pendingChange.kind === "category") pickCategory(pendingChange.value);
                                    else pickChildCategory(pendingChange.value);
                                    setPendingChange(null);
                                }
                            }}
                            className="min-h-10 rounded-btn bg-primary px-4 text-14 text-white"
                        >
                            确认切换
                        </button>
                    </>
                }
            >
                <p className="text-14 text-td">
                    当前已选 {selectedIds.size} 项物料。切换品类或{childLabel}后，需要重新选择物料。
                </p>
            </Modal>

            {/* 判重命中：数据库已存在一模一样的 BOM（品类+构成+备注），未插入新档案 */}
            <Modal
                open={!!duplicateCode}
                onClose={() => setDuplicateCode(null)}
                label="已存在相同 BOM"
                title="已存在完全相同的 BOM"
                width={480}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setDuplicateCode(null)}>
                            关闭
                        </Button>
                        <Button
                            variant="primary"
                            onClick={async () => {
                                if (duplicateCode && (await copyText(duplicateCode))) {
                                    toast(`已复制 ${duplicateCode}，可直接粘贴到销售订单`);
                                }
                            }}
                        >
                            复制 BOM 编号
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-3">
                    <p className="text-14 leading-6 text-td">
                        已存在一模一样的 BOM，没有重复创建。直接用下面这个编号：
                    </p>
                    <p className="tnum rounded-input border border-dashed border-line-strong bg-soft px-4 py-3 text-center text-24 font-bold tracking-wide text-primary">
                        {duplicateCode}
                    </p>
                    <p className="text-13 leading-5 text-muted">点「复制 BOM 编号」即可粘贴到销售订单。</p>
                </div>
            </Modal>
        </>
    );
}

/* 可排序列：BOM 编码；默认不排序，保持后端「新建置顶」的列表顺序 */
type BomSortKey = "code";

export function BomPage() {
    const { can } = useApp();
    const bomsQuery = useBoms();
    const categoriesQuery = useBomCategories();
    const stocksQuery = useBomStocks();
    const usageQuery = useBomUsage();
    const { refresh } = useBomRefresh();
    const [searchParams, setSearchParams] = useSearchParams();
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("全部品类");
    const [statusFilter, setStatusFilter] = useState("全部状态");
    const showUnused = statusFilter === "未使用";
    const usageUnavailable = showUnused && usageQuery.isError && usageQuery.data === undefined;
    const isLoading =
        bomsQuery.isLoading ||
        categoriesQuery.isLoading ||
        stocksQuery.isLoading ||
        (showUnused && usageQuery.isLoading);
    const isFetching =
        bomsQuery.isFetching ||
        categoriesQuery.isFetching ||
        stocksQuery.isFetching ||
        (showUnused && usageQuery.isFetching);
    // 首载出替换式占位,后台刷新出保留式遮罩(200ms 内完成不闪现)
    const overlay = useDelayedFlag(isFetching && !isLoading);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [sort, setSort] = useState<SortState<BomSortKey> | null>(null);
    // 深链 ?new=bom 首帧即开弹窗（初始 state 直读）；effect 只负责清参数，不在副作用里开弹窗
    const [newOpen, setNewOpen] = useState(() => searchParams.get("new") === "bom");
    const [detail, setDetail] = useState<Bom | null>(null);
    const [deleting, setDeleting] = useState<Bom | null>(null);

    const boms = bomsQuery.data ?? EMPTY_BOMS;
    const categories = useMemo(() => [...new Set(boms.map(bom => bom.name))], [boms]);
    /* 无删除权限（仅超级管理员）、被订单或成品台账引用或有库存余量的档案不显示删除入口，
     * 前端先挡一层误操作；引用与库存余量须已成功加载才参与判断——
     * 未加载或加载失败按“引用未知”处理，不能把“没有数据”当成“没有引用”；
     * 曾被库存调整触碰过的边界由后端权威校验兜底 */
    const canDeleteBom = can("bom:delete");
    const referencedCodes = useMemo(
        () => new Set((usageQuery.data?.orders ?? []).map(order => order.bomCode)),
        [usageQuery.data?.orders],
    );
    /* 使用判定走订单 + 成品出入库台账；调整单不算使用 */
    const ledgerCodes = useMemo(
        () =>
            new Set(
                [...(usageQuery.data?.inboundLedger ?? []), ...(usageQuery.data?.outboundLedger ?? [])].map(
                    row => row.bomCode,
                ),
            ),
        [usageQuery.data?.inboundLedger, usageQuery.data?.outboundLedger],
    );
    const usageLoaded = usageQuery.data !== undefined;
    const unusedCodes = useMemo(
        () =>
            new Set(
                usageLoaded
                    ? boms
                          .filter(bom => !referencedCodes.has(bom.code) && !ledgerCodes.has(bom.code))
                          .map(bom => bom.code)
                    : [],
            ),
        [boms, usageLoaded, referencedCodes, ledgerCodes],
    );
    const referencesLoaded = usageLoaded && stocksQuery.data !== undefined;
    const deletable = (bom: Bom) =>
        referencesLoaded &&
        !referencedCodes.has(bom.code) &&
        !ledgerCodes.has(bom.code) &&
        (stocksQuery.data![bom.code] ?? 0) === 0;

    const filtered = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        return boms
            .filter(bom => category === "全部品类" || bom.name === category)
            .filter(bom => statusFilter !== "未使用" || unusedCodes.has(bom.code))
            .filter(
                bom =>
                    !kw ||
                    `${bom.code} ${bom.name} ${bom.spec} ${bom.items
                        .map(item => `${item.groupName} ${item.name}`)
                        .join(" ")}`
                        .toLowerCase()
                        .includes(kw),
            );
    }, [boms, keyword, category, statusFilter, unusedCodes]);

    const sorted = useMemo(() => {
        if (!sort) return filtered;
        const factor = sort.dir === "asc" ? 1 : -1;
        return [...filtered].sort((a, b) => a.code.localeCompare(b.code) * factor);
    }, [filtered, sort]);
    const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
    const canCreate = can("bom:create");
    // 排序或翻页后行序变化，滚动区回到顶部
    const tableScrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
    }, [page, sort]);

    useEffect(() => {
        if (searchParams.get("new") === "bom") setSearchParams({}, { replace: true });
    }, [searchParams, setSearchParams]);

    // 清空条件只作用于筛选行（搜索/品类/使用状态）；快捷入口与分页由用户自行操作
    const clearFilters = () => {
        setKeyword("");
        setCategory("全部品类");
        setStatusFilter("全部状态");
        setPage(1);
    };
    const filtersActive = !!keyword.trim() || category !== "全部品类" || statusFilter !== "全部状态";
    // 每条未使用的 BOM 都沿用弱化底色，与当前筛选状态无关
    return (
        <div className="flex flex-col gap-5">
            <h1 className="sr-only">物料与 BOM</h1>

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
                            placeholder="BOM / 品类 / 型号 / 物料"
                            className="w-full bg-transparent text-14 text-ink outline-none placeholder:text-subtle"
                        />
                    </label>
                    <select
                        value={category}
                        onChange={event => {
                            setCategory(event.target.value);
                            setPage(1);
                        }}
                        className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink"
                        aria-label="按品类筛选"
                    >
                        <option>全部品类</option>
                        {categories.map(item => (
                            <option key={item}>{item}</option>
                        ))}
                    </select>
                    <select
                        value={statusFilter}
                        onChange={event => {
                            setStatusFilter(event.target.value);
                            setPage(1);
                        }}
                        className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink"
                        aria-label="按使用状态筛选"
                    >
                        <option>全部状态</option>
                        <option>未使用</option>
                    </select>
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
                                        "BOM",
                                        ["序号", "BOM编码", "品类", "物料构成", "BOM 备注"],
                                        pageRows.map((bom, index) => [
                                            String((page - 1) * pageSize + index + 1),
                                            bom.code,
                                            bom.name,
                                            bom.spec,
                                            bom.remark,
                                        ]),
                                    )
                                }
                            >
                                导出
                            </Button>
                        </ToolbarMore>
                        {canCreate && (
                            <Button icon="plus" onClick={() => setNewOpen(true)}>
                                新建 BOM
                            </Button>
                        )}
                    </TableHeaderActions>
                </div>

                <div className="mobile-records">
                    {usageUnavailable ? (
                        <div role="status" className="p-8">
                            <EmptyState description="使用状态加载失败，请刷新重试" />
                        </div>
                    ) : (
                        <ListState loading={isLoading} empty={!pageRows.length}>
                            {pageRows.map(bom => (
                                <RecordCard
                                    key={bom.code}
                                    title={bom.code}
                                    subtitle={bom.name}
                                    actions={
                                        <Button variant="secondary" onClick={() => setDetail(bom)}>
                                            查看详情
                                        </Button>
                                    }
                                >
                                    <BomCell
                                        categories={categoriesQuery.data}
                                        bom={bom}
                                        bomCode={bom.code}
                                        showIdentity={false}
                                    />
                                    <div className="mt-2 grid grid-cols-2 gap-2">
                                        <CardField
                                            label="当前库存"
                                            value={
                                                stocksQuery.data ? `${num(stocksQuery.data[bom.code] ?? 0)} 个` : "—"
                                            }
                                        />
                                        <CardField label="备注" value={bom.remark || "—"} />
                                        <CardField label="创建人" value={bom.creator} />
                                        <CardField label="创建时间" value={formatDateTime(bom.created)} />
                                    </div>
                                </RecordCard>
                            ))}
                        </ListState>
                    )}
                </div>
                <div className="hidden lg:block">
                    {isLoading ? (
                        <PageLoading className="py-16" />
                    ) : (
                        <DataTable
                            tableId="bom"
                            defaultWidths={[80, 160, 120, 360, 180, 100, 150, 100]}
                            recordCount={filtered.length}
                            identityColumn={1}
                            scrollRef={tableScrollRef}
                        >
                            <thead>
                                <tr className="text-left text-13 text-muted">
                                    <th className="px-5 py-2.5 font-semibold" style={{ width: "6%" }}>
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
                                        width="16%"
                                    />
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "12%" }}>
                                        品类
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold">物料构成</th>
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "16%" }}>
                                        BOM 备注
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "8%" }}>
                                        创建人
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold" style={{ width: "12%" }}>
                                        创建时间
                                    </th>
                                    <th className="px-5 py-2.5 text-center font-semibold" style={{ width: "10%" }}>
                                        操作
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="px-5 py-10 text-center">
                                            <EmptyState
                                                description={
                                                    usageUnavailable
                                                        ? "使用状态加载失败，请刷新重试"
                                                        : showUnused
                                                          ? "没有未使用的 BOM"
                                                          : "暂无 BOM"
                                                }
                                            />
                                        </td>
                                    </tr>
                                )}
                                {pageRows.map((bom, index) => (
                                    <tr
                                        key={bom.code}
                                        className={
                                            unusedCodes.has(bom.code)
                                                ? "row-voided border-t border-line align-top"
                                                : "border-t border-line align-top transition hover:bg-row-hover"
                                        }
                                    >
                                        <td className="px-5 py-3 tnum text-14 text-muted">
                                            {(page - 1) * pageSize + index + 1}
                                        </td>
                                        <td className="px-3 py-3">
                                            <button
                                                type="button"
                                                onClick={() => setDetail(bom)}
                                                className="tnum text-14 font-semibold text-primary-strong underline-offset-2 hover:underline"
                                            >
                                                {bom.code}
                                            </button>
                                        </td>
                                        <td className="px-3 py-3 text-14 text-td">{bom.name}</td>
                                        <td className="px-3 py-3">
                                            <BomCell
                                                categories={categoriesQuery.data}
                                                bom={bom}
                                                bomCode={bom.code}
                                                showIdentity={false}
                                            />
                                        </td>
                                        <td className="px-3 py-3">
                                            <RemarkCell remark={bom.remark} variant="warning" />
                                        </td>
                                        <td className="px-3 py-3 text-14 text-td">{bom.creator}</td>
                                        <td className="tnum px-3 py-3 text-14 text-td">
                                            {formatDateTime(bom.created)}
                                        </td>
                                        <td className="px-5 py-3 text-center">
                                            <TableLink onClick={() => setDetail(bom)}>查看详情</TableLink>
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

            {canCreate && <NewBomModal open={newOpen} onClose={() => setNewOpen(false)} />}
            <BomDetailModal
                categories={categoriesQuery.data}
                bom={detail ? (boms.find(bom => bom.code === detail.code) ?? null) : null}
                onClose={() => setDetail(null)}
                onDelete={detail && canDeleteBom && deletable(detail) ? () => setDeleting(detail) : undefined}
            />
            <DeleteBomModal bom={deleting} onClose={() => setDeleting(null)} />
        </div>
    );
}

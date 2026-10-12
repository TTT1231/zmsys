import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PageLoading } from "@/components/ui/PageLoading";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorPage } from "@/pages/error/ErrorPage";
import { useToast } from "@/components/ui/toastContexts";
import { useApp } from "@/context/useApp";
import { useQueryClient } from "@tanstack/react-query";
import { isApiError } from "@/http";
import { useApplyBomStructure, useBomCategories, bomKeys } from "@/data/queries";
import { uuid } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { BomCategory, StructureOperation } from "@/api";
import { CategoryCreateModal } from "./CategoryCreateModal";
import { StructureEditor, type EditorActions } from "./StructureEditor";
import { applyOpsToView, viewTreeOf } from "./structureView";

/**
 * BOM 结构（仅超管）：品类/分区/分组/物料目录的在线维护。生效口径：结构变更只
 * 影响保存后新建的 BOM——已保存 BOM 及关联订单、出入库记录按建档冻结快照显示，
 * 不会自动补充或修改；旧 BOM 需要增加物料时请另建 BOM。
 */
export function BomStructurePage() {
    const { can } = useApp();
    const toast = useToast();
    const queryClient = useQueryClient();
    const { data: categories, isLoading } = useBomCategories();
    const applyStructure = useApplyBomStructure();
    const [selectedKey, setSelectedKey] = useState("");
    const [operations, setOperations] = useState<StructureOperation[]>([]);
    const [conflict, setConflict] = useState(false);
    const [creating, setCreating] = useState(false);

    const category = categories?.find(row => row.key === selectedKey) ?? null;
    /* 被引用提示：目录容器（焊线/插线）被哪些主品类的 childCategories 合并使用 */
    const usageOf = useMemo(() => {
        const usage = new Map<string, string[]>();
        for (const row of categories ?? []) {
            for (const childKey of row.childCategories ?? []) {
                usage.set(childKey, [...(usage.get(childKey) ?? []), row.name]);
            }
        }
        return usage;
    }, [categories]);

    /* 所见即所存：服务端快照 + 草稿 ops 按序投影（与后端 projectStructure 同构） */
    const snapshotTree = useMemo(() => (category ? viewTreeOf(category.groups) : []), [category]);
    const viewTree = useMemo(() => applyOpsToView(snapshotTree, operations), [snapshotTree, operations]);

    const pickCategory = (key: string) => {
        setSelectedKey(key);
        setOperations([]);
        setConflict(false);
    };

    const appendOps = (...ops: StructureOperation[]) => setOperations(current => [...current, ...ops]);

    const actions: EditorActions = {
        addSection: name => appendOps({ type: "add_section", tempId: uuid(), name }),
        addGroup: (parentId, name, multi, qty, isModel, items) =>
            appendOps({
                type: "add_group",
                tempId: uuid(),
                name,
                parentId,
                multi,
                qty,
                ...(isModel ? { isModel: true } : {}),
                ...(items.length > 0 ? { items: items.map(item => ({ tempId: uuid(), name: item })) } : {}),
            }),
        addItem: (groupId, name) => appendOps({ type: "add_item", tempId: uuid(), groupId, name }),
        setHidden: (kind, id, hidden) =>
            appendOps({ type: hidden ? "hide" : "restore", targetType: kind, targetId: id }),
        move: (kind, id, direction) => appendOps({ type: "reorder", targetType: kind, targetId: id, direction }),
        setRules: (groupId, multi, qty) => appendOps({ type: "set_rules", groupId, multi, qty }),
    };

    const save = () => {
        if (!category || operations.length === 0) {
            return;
        }
        applyStructure.mutate(
            {
                categoryKey: category.key,
                expectedRowVersion: category.rowVersion,
                operations,
            },
            {
                onSuccess: result => {
                    setOperations([]);
                    setConflict(false);
                    toast.success(
                        result.hiddenUsageCount
                            ? `结构已保存（新版本 ${result.rowVersion}）；隐藏的物料仍被 ${result.hiddenUsageCount} 行既有 BOM 引用，旧档案不受影响`
                            : `结构已保存（新版本 ${result.rowVersion}），对之后新建的 BOM 生效`,
                    );
                },
                onError: error => {
                    /* 409 版本冲突：保留草稿，由操作人选择拉取最新结构或稍后继续编辑 */
                    if (isApiError(error) && error.code === 409) {
                        setConflict(true);
                    }
                },
            },
        );
    };

    if (!can("bom-structure:view")) {
        return <ErrorPage kind="forbidden" />;
    }
    if (isLoading) {
        return <PageLoading label="加载 BOM 结构" />;
    }

    return (
        <div className="mx-auto w-full max-w-wrap-padding px-4 pb-10 pt-6 sm:px-6">
            <header className="mb-4 flex flex-wrap items-center gap-3">
                <div>
                    <h1 className="text-18 font-semibold text-ink">BOM 结构</h1>
                    <p className="mt-0.5 text-13 text-muted">超管专属 · 维护新建 BOM 的可选目录</p>
                </div>
                <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
                    新建品类
                </Button>
            </header>

            <div className="mb-4 rounded-panel border border-info/30 bg-info/5 px-4 py-3 text-13 text-muted">
                结构调整用于<strong className="text-ink">之后新建 BOM</strong> 的可选目录；已保存 BOM
                及关联订单、出入库记录按建档冻结快照显示，不会自动补充或修改。旧 BOM 需要增加物料时，请另建
                BOM（构成完全相同会提示已有编码）。
            </div>

            <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
                <aside className="space-y-1">
                    {(categories ?? []).map((row: BomCategory) => {
                        const used = usageOf.get(row.key);
                        return (
                            <button
                                key={row.key}
                                type="button"
                                onClick={() => pickCategory(row.key)}
                                className={cn(
                                    "w-full rounded-panel border px-3 py-2 text-left transition",
                                    row.key === selectedKey
                                        ? "border-ink/30 bg-soft"
                                        : "border-line bg-surface hover:bg-soft/60",
                                )}
                            >
                                <span className="flex items-center gap-2">
                                    <span className="text-14 font-medium text-ink">{row.name}</span>
                                    {row.status === false && (
                                        <span className="rounded-full bg-soft px-2 py-0.5 text-11 text-muted">
                                            目录容器
                                        </span>
                                    )}
                                </span>
                                <span className="mt-0.5 block text-12 text-placeholder">
                                    前缀 {row.codePrefix} · 版本 {row.rowVersion}
                                    {used && used.length > 0 ? ` · 被 ${used.join("、")} 引用` : ""}
                                </span>
                            </button>
                        );
                    })}
                </aside>

                <section className="rounded-panel border border-line bg-surface px-4 py-4 shadow-card">
                    {!category ? (
                        <EmptyState description="左侧选择一个品类维护其结构，或点击右上角「新建品类」" />
                    ) : (
                        <>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                                <h2 className="text-15 font-semibold text-ink">{category.name}</h2>
                                {(category.childCategories?.length ?? 0) > 0 && (
                                    <span className="rounded-full bg-soft px-2 py-0.5 text-11 text-muted">
                                        复合品类 · 合并{" "}
                                        {(category.childCategories ?? [])
                                            .map(key => categories?.find(row => row.key === key)?.name ?? key)
                                            .join("、")}{" "}
                                        目录
                                    </span>
                                )}
                                <span className="ml-auto text-12 text-placeholder">
                                    {operations.length > 0 ? `未保存变更 ${operations.length} 条` : "无未保存变更"}
                                </span>
                                {operations.length > 0 && (
                                    <>
                                        <Button size="sm" variant="secondary" onClick={() => setOperations([])}>
                                            放弃草稿
                                        </Button>
                                        <Button size="sm" onClick={save} disabled={applyStructure.isPending}>
                                            保存
                                        </Button>
                                    </>
                                )}
                            </div>
                            {conflict && (
                                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-panel border border-warning/40 bg-warning/10 px-3 py-2 text-13 text-ink">
                                    <span>品类结构已被他人修改，当前草稿基于旧版本。</span>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => {
                                            setOperations([]);
                                            setConflict(false);
                                            void queryClient.invalidateQueries({ queryKey: bomKeys.categories });
                                        }}
                                    >
                                        拉取最新结构（丢弃草稿）
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setConflict(false)}>
                                        稍后再试
                                    </Button>
                                </div>
                            )}
                            <StructureEditor roots={viewTree} actions={actions} mode="edit" />
                        </>
                    )}
                </section>
            </div>

            <CategoryCreateModal open={creating} onClose={() => setCreating(false)} />
        </div>
    );
}

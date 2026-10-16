import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { PageLoading } from "@/components/ui/PageLoading";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorPage } from "@/pages/error/ErrorPage";
import { useToast } from "@/components/ui/toastContexts";
import { useApp } from "@/context/useApp";
import { isApiError } from "@/http";
import { useBomCategories, useDeleteBomCategory, bomKeys, wbKeys } from "@/data/queries";
import { applyBomStructure, createBomCategory, type BomCategory, type StructureOperation } from "@/api";
import { uuid } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { CategoryCreateModal } from "./CategoryCreateModal";
import { PreviewModal } from "./PreviewModal";
import { StructureTree, type EditorSection, type RowRef, type TreeActions } from "./StructureTree";
import { CategoryNav, type DraftCategoryInfo } from "./CategoryNav";
import { AddNodeModal, DeleteCategoryModal, DeleteModal, MoveModal, RenameModal } from "./NodeDialogs";
import { StructureTour, type TourStep } from "./StructureTour";
import {
    applyOpsToView,
    flatDraftInputOf,
    flattenTree,
    standaloneItemOf,
    viewNodesOf,
    viewPathOf,
    statsOf,
    viewTreeOf,
    withoutDraftSubtree,
    type ViewRoot,
} from "./structureView";

/**
 * BOM 结构（仅超管，/product-structure）：按 BOM结构原型.html 重构——左侧品类折叠
 * 面板（复合品类的下属类型可展开点选），右侧树编辑区（多选/数量规则列；分组行有
 * 行级上移/下移/不可选/添加/更多，物料行操作全部走右键菜单），改名/跨父移动/删除、
 * 撤销重做（Ctrl+Z / Ctrl+Shift+Z）、Ctrl+S 保存、预览选料效果、操作引导。生效口径：
 * 结构变更只影响保存后新建的 BOM，已保存 BOM 及关联订单、出入库记录按建档冻结快照显示。
 *
 * 草稿模型：每品类一份 ops 草稿（复合视图同时编辑主/子品类两份），保存时逐品类
 * 调 /bom-structure/apply（乐观锁 rowVersion）；409 保留草稿由操作人选择拉取最新
 * 或稍后再试。草稿跨品类切换保留；保存成功后清空历史（撤销不跨越保存边界）。
 * 新建品类不即时落库：弹窗提交只生成左侧「未保存的新品类」草稿（draft- 键同样
 * 走 ops 草稿机制，快照为空树），点保存结构时才调 createBomCategory 连品类带
 * 整棵树一次写入；中途右键「丢弃草稿」即放弃，数据库无残留。
 */

type Drafts = Record<string, StructureOperation[]>;

interface DraftState {
    drafts: Drafts;
    past: Drafts[];
    future: Drafts[];
}

type DraftAction =
    | { type: "append"; key: string; ops: StructureOperation[] }
    | { type: "replace"; key: string; ops: StructureOperation[] }
    | { type: "saved"; key: string }
    | { type: "discardAll" }
    | { type: "undo" }
    | { type: "redo" };

const HISTORY_LIMIT = 100;

function draftReducer(state: DraftState, action: DraftAction): DraftState {
    switch (action.type) {
        case "append": {
            const current = state.drafts[action.key] ?? [];
            return {
                drafts: { ...state.drafts, [action.key]: [...current, ...action.ops] },
                past: [...state.past, state.drafts].slice(-HISTORY_LIMIT),
                future: [],
            };
        }
        case "replace": {
            const drafts = { ...state.drafts };
            if (action.ops.length > 0) {
                drafts[action.key] = action.ops;
            } else {
                delete drafts[action.key];
            }
            return { drafts, past: [...state.past, state.drafts].slice(-HISTORY_LIMIT), future: [] };
        }
        case "saved": {
            // 保存成功是不可撤销的落库边界：清空该品类草稿并整体重置历史
            const drafts = { ...state.drafts };
            delete drafts[action.key];
            return { drafts, past: [], future: [] };
        }
        case "discardAll":
            return { drafts: {}, past: [], future: [] };
        case "undo": {
            const previous = state.past.at(-1);
            if (!previous) {
                return state;
            }
            return {
                drafts: previous,
                past: state.past.slice(0, -1),
                future: [state.drafts, ...state.future].slice(0, HISTORY_LIMIT),
            };
        }
        case "redo": {
            const next = state.future[0];
            if (!next) {
                return state;
            }
            return {
                drafts: next,
                past: [...state.past, state.drafts].slice(-HISTORY_LIMIT),
                future: state.future.slice(1),
            };
        }
    }
}

/* 复合视图分节标签（与建档弹窗的子选口径一致：XK3 → 焊线工艺，跌倒 → 微动开关类型） */
const ownSectionLabel = (parent: BomCategory, own: BomCategory): string => {
    if (parent.key === "rotary-xk3") {
        return "焊线工艺";
    }
    if (parent.key === "tipover-switch") {
        return "微动开关类型";
    }
    return `${own.name}结构`;
};

type DialogState =
    | {
          kind: "add-node";
          categoryKey: string;
          categoryName: string;
          target: { type: "root" } | { type: "section" | "group"; id: string };
      }
    | { kind: "rename"; row: RowRef; tree: ViewRoot[] }
    | { kind: "move"; row: RowRef; tree: ViewRoot[]; categoryName: string }
    | { kind: "delete"; row: RowRef; childCount: number }
    | null;

export function BomStructurePage() {
    const { can } = useApp();
    const toast = useToast();
    const queryClient = useQueryClient();
    const { data: categories, isLoading } = useBomCategories();
    const deleteCategory = useDeleteBomCategory();
    const [selectedKey, setSelectedKey] = useState("");
    const [state, dispatch] = useReducer(draftReducer, { drafts: {}, past: [], future: [] });
    /* 新建品类草稿（未入库）：弹窗提交追加，保存结构时 createBomCategory 一次写入 */
    const [draftCategories, setDraftCategories] = useState<DraftCategoryInfo[]>([]);
    const [discarding, setDiscarding] = useState<DraftCategoryInfo | null>(null);
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
    const [expandedCategories, setExpandedCategories] = useState<ReadonlySet<string>>(new Set());
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const [conflictCategory, setConflictCategory] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    savingRef.current = saving;
    const [creating, setCreating] = useState(false);
    const [deleting, setDeleting] = useState<BomCategory | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [touring, setTouring] = useState(false);
    const [dialog, setDialog] = useState<DialogState>(null);
    const [focusRequest, setFocusRequest] = useState<string | null>(null);
    const stateRef = useRef(state);
    stateRef.current = state;

    /* 品类归属：child_categories 指向的下属类型嵌套在主品类下（目录容器） */
    const parentOf = useMemo(() => {
        const map = new Map<string, string>();
        for (const row of categories ?? []) {
            for (const childKey of row.childCategories ?? []) {
                if (!map.has(childKey)) {
                    map.set(childKey, row.key);
                }
            }
        }
        return map;
    }, [categories]);
    const childrenOf = useMemo(() => {
        const map = new Map<string, BomCategory[]>();
        for (const [childKey, parentKey] of parentOf) {
            const child = categories?.find(row => row.key === childKey);
            if (!child) {
                continue;
            }
            map.set(parentKey, [...(map.get(parentKey) ?? []), child]);
        }
        return map;
    }, [parentOf, categories]);
    const rootCategories = useMemo(
        () => (categories ?? []).filter(row => !parentOf.has(row.key)),
        [categories, parentOf],
    );

    const selected = categories?.find(row => row.key === selectedKey) ?? null;
    const selectedDraft = selected ? null : (draftCategories.find(row => row.key === selectedKey) ?? null);
    const hasSelection = selected !== null || selectedDraft !== null;
    const parentCategory = selected
        ? ((categories?.find(row => row.key === parentOf.get(selected.key)) ?? null) as BomCategory | null)
        : null;
    /** 弹窗副标题用：已存品类名 → 草稿品类名 → 空串 */
    const nameOfKey = useCallback(
        (key: string) =>
            categories?.find(row => row.key === key)?.name ?? draftCategories.find(row => row.key === key)?.name ?? "",
        [categories, draftCategories],
    );

    /* 各品类当前投影（快照 + 草稿 ops，与后端投影同构；草稿品类快照为空树） */
    const projections = useMemo(() => {
        const map = new Map<string, ViewRoot[]>();
        for (const row of categories ?? []) {
            map.set(row.key, applyOpsToView(viewTreeOf(row.groups), state.drafts[row.key] ?? []));
        }
        for (const draft of draftCategories) {
            map.set(draft.key, applyOpsToView([], state.drafts[draft.key] ?? []));
        }
        return map;
    }, [categories, draftCategories, state.drafts]);

    /* 复合品类分节：主品类共用结构（有目录时）+ 本品结构；单品类视图无标题；
     * 草稿品类 = 单分节空树编辑（保存后入库） */
    const sections = useMemo<EditorSection[]>(() => {
        if (selectedDraft) {
            return [
                {
                    categoryKey: selectedDraft.key,
                    label: selectedDraft.name,
                    composite: false,
                    tree: projections.get(selectedDraft.key) ?? [],
                },
            ];
        }
        if (!selected) {
            return [];
        }
        if (!parentCategory) {
            return [
                {
                    categoryKey: selected.key,
                    label: selected.name,
                    composite: false,
                    tree: projections.get(selected.key) ?? [],
                },
            ];
        }
        const views: EditorSection[] = [];
        if ((parentCategory.groups ?? []).length > 0) {
            views.push({
                categoryKey: parentCategory.key,
                label: `${parentCategory.name}类型`,
                composite: true,
                tree: projections.get(parentCategory.key) ?? [],
            });
        }
        views.push({
            categoryKey: selected.key,
            label: ownSectionLabel(parentCategory, selected),
            composite: true,
            tree: projections.get(selected.key) ?? [],
        });
        return views;
    }, [selectedDraft, selected, parentCategory, projections]);

    const dirtyKeys = useMemo(
        () => (categories ?? []).filter(row => (state.drafts[row.key]?.length ?? 0) > 0).map(row => row.key),
        [categories, state.drafts],
    );
    /* 待保存总量 = 已存品类与草稿品类下的 ops 数 + 草稿品类数（每个草稿品类
     * 本身即一条待入库变更） */
    const pendingCount =
        [...(categories ?? []).map(row => row.key), ...draftCategories.map(draft => draft.key)].reduce(
            (sum, key) => sum + (state.drafts[key]?.length ?? 0),
            0,
        ) + draftCategories.length;

    /* 首个品类默认选中（下属类型优先展开归属主品类） */
    useEffect(() => {
        if (!selectedKey && rootCategories.length > 0) {
            setSelectedKey(rootCategories[0]!.key);
        }
    }, [selectedKey, rootCategories]);

    /* 离开页面前的未保存提醒（草稿与草稿品类仅存于内存） */
    useEffect(() => {
        if (pendingCount === 0) {
            return;
        }
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [pendingCount]);

    /* 弹窗/操作后的焦点恢复：定位到目标行 */
    useEffect(() => {
        if (!focusRequest) {
            return;
        }
        const id = focusRequest;
        const ancestors = sections
            .flatMap(section => viewPathOf(section.tree, id))
            .map(node => node.id)
            .filter(nodeId => nodeId !== id);
        setCollapsed(current => {
            if (!ancestors.some(ancestor => current.has(ancestor))) return current;
            return new Set([...current].filter(ancestor => !ancestors.includes(ancestor)));
        });
        setFocusRequest(null);
        requestAnimationFrame(() => {
            const row = document.querySelector<HTMLElement>(`[data-node-row="${id}"]`);
            (row?.querySelector<HTMLElement>("[data-entry]") ?? row)?.focus({ preventScroll: false });
            row?.scrollIntoView?.({ block: "nearest" });
        });
    }, [focusRequest, sections]);

    const revealAndSelect = useCallback((id: string) => {
        setSelectedNode(id);
        setCollapsed(current => {
            const next = new Set(current);
            next.delete(id);
            return next;
        });
        setFocusRequest(id);
    }, []);

    const treeOfCategory = useCallback((key: string) => projections.get(key) ?? [], [projections]);

    /* 行操作 → ops（按行归属品类路由） */
    const actions: TreeActions = useMemo(
        () => ({
            toggleCollapse: id =>
                setCollapsed(current => {
                    const next = new Set(current);
                    if (next.has(id)) {
                        next.delete(id);
                    } else {
                        next.add(id);
                    }
                    return next;
                }),
            selectNode: id => setSelectedNode(id),
            setHidden: (row, hidden) => {
                dispatch({
                    type: "append",
                    key: row.categoryKey,
                    ops: [
                        { type: hidden ? "hide" : "restore", targetType: row.kind, targetId: row.id },
                        ...(row.materialItemId
                            ? [
                                  {
                                      type: hidden ? ("hide" as const) : ("restore" as const),
                                      targetType: "item" as const,
                                      targetId: row.materialItemId,
                                  },
                              ]
                            : []),
                    ],
                });
                toast.success(hidden ? "已设为不可选，保存后生效" : "已恢复可选，保存后生效");
                setFocusRequest(row.id);
            },
            reorder: (row, direction) => {
                dispatch({
                    type: "append",
                    key: row.categoryKey,
                    ops: [{ type: "reorder", targetType: row.kind, targetId: row.id, direction }],
                });
                setFocusRequest(row.id);
            },
            setRules: (categoryKey, groupId, multi, qty) => {
                dispatch({ type: "append", key: categoryKey, ops: [{ type: "set_rules", groupId, multi, qty }] });
            },
            openAddNode: (categoryKey, target) => {
                setDialog({ kind: "add-node", categoryKey, categoryName: nameOfKey(categoryKey), target });
            },
            openRename: row => setDialog({ kind: "rename", row, tree: treeOfCategory(row.categoryKey) }),
            openMove: row => {
                setDialog({
                    kind: "move",
                    row,
                    tree: treeOfCategory(row.categoryKey),
                    categoryName: nameOfKey(row.categoryKey),
                });
            },
            openRemove: row => {
                const node = viewNodesOf(treeOfCategory(row.categoryKey)).find(node => node.id === row.id);
                const childCount = node && !row.materialItemId ? flattenTree([node]).length - 1 : 0;
                setDialog({ kind: "delete", row, childCount });
            },
        }),
        [nameOfKey, toast, treeOfCategory],
    );

    const save = useCallback(async () => {
        if (saving || (dirtyKeys.length === 0 && draftCategories.length === 0)) {
            return;
        }
        setSaving(true);
        let savedCount = 0;
        let hiddenUsage = 0;
        let conflictName: string | null = null;
        let failure: string | null = null;
        let createdTarget: { key: string; types?: Array<{ key: string }> } | null = null;
        for (const key of dirtyKeys) {
            const category = categories?.find(row => row.key === key);
            if (!category) {
                continue;
            }
            try {
                const result = await applyBomStructure({
                    categoryKey: key,
                    expectedRowVersion: category.rowVersion,
                    operations: stateRef.current.drafts[key] ?? [],
                });
                savedCount += 1;
                hiddenUsage += result.hiddenUsageCount ?? 0;
                dispatch({ type: "saved", key });
            } catch (error) {
                if (isApiError(error) && error.code === 409) {
                    conflictName = category.name;
                } else {
                    failure = error instanceof Error ? error.message : "保存失败，请稍后再试";
                }
                break;
            }
        }
        /* 草稿品类入库：品类 + 整棵投影树一次写入（名称/前缀冲突 409 保留草稿重试） */
        if (!failure && !conflictName) {
            for (const draft of draftCategories) {
                try {
                    const created = await createBomCategory({
                        name: draft.name,
                        codePrefix: draft.codePrefix,
                        ...(draft.types.length > 0 ? { types: draft.types } : {}),
                        groups: flatDraftInputOf(applyOpsToView([], stateRef.current.drafts[draft.key] ?? [])),
                    });
                    savedCount += 1;
                    createdTarget = created;
                    dispatch({ type: "saved", key: draft.key });
                    setDraftCategories(current => current.filter(entry => entry.key !== draft.key));
                } catch (error) {
                    failure = error instanceof Error ? error.message : "保存失败，请稍后再试";
                    break;
                }
            }
        }
        setSaving(false);
        if (savedCount > 0) {
            void queryClient.invalidateQueries({ queryKey: bomKeys.categories });
            void queryClient.invalidateQueries({ queryKey: bomKeys.list });
            void queryClient.invalidateQueries({ queryKey: wbKeys.all });
            void queryClient.invalidateQueries({ queryKey: ["workbench"] });
            toast.success(
                (savedCount === 1 ? "结构已保存" : `已保存 ${savedCount} 个品类`) +
                    (hiddenUsage > 0 ? `；隐藏的物料仍被 ${hiddenUsage} 行既有 BOM 引用，旧档案不受影响` : ""),
            );
            setConflictCategory(null);
        }
        /* 草稿品类落库后选中它（复合品类切到首个下属类型，方便继续搭目录） */
        if (createdTarget) {
            setSelectedKey(createdTarget.types?.[0]?.key ?? createdTarget.key);
            if (createdTarget.types?.length) {
                setExpandedCategories(current => new Set([...current, createdTarget.key]));
            }
            setSelectedNode(null);
        }
        if (conflictName) {
            setConflictCategory(conflictName);
        }
        if (failure) {
            toast.error(failure);
        }
    }, [saving, dirtyKeys, draftCategories, categories, queryClient, toast]);

    /* 全局快捷键：Ctrl+S 保存 / Ctrl+Z·Ctrl+Shift+Z·Ctrl+Y 撤销重做 / F2 重命名选中行 */
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const editing =
                event.target instanceof HTMLElement &&
                event.target.matches("input,textarea,select,[contenteditable=true]");
            const inDialog = document.querySelector('[role="dialog"]') !== null;
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                if (!inDialog) {
                    void save();
                }
                return;
            }
            if (editing || inDialog) {
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
                event.preventDefault();
                if (savingRef.current) {
                    return;
                }
                dispatch({ type: event.shiftKey ? "redo" : "undo" });
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
                event.preventDefault();
                if (savingRef.current) {
                    return;
                }
                dispatch({ type: "redo" });
                return;
            }
            if (event.key === "F2" && selectedNode) {
                event.preventDefault();
                for (const section of sections) {
                    const rows = flattenTree(section.tree);
                    const row = rows.find(item => item.id === selectedNode);
                    if (row) {
                        const group = viewNodesOf(section.tree).find(item => item.id === row.id);
                        const material = group?.kind === "group" ? standaloneItemOf(group) : undefined;
                        setDialog({
                            kind: "rename",
                            row: {
                                categoryKey: section.categoryKey,
                                kind: row.kind,
                                id: row.id,
                                name: row.name,
                                draft: row.draft,
                                ...(material ? { materialItemId: material.id } : {}),
                            },
                            tree: section.tree,
                        });
                        break;
                    }
                }
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [save, selectedNode, sections]);

    /* 树内上下键：在可见行间移动焦点 */
    const onTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
            return;
        }
        const target = event.target as HTMLElement;
        if (!target.matches("[data-entry]")) {
            return;
        }
        event.preventDefault();
        const entries = [...document.querySelectorAll<HTMLElement>("[data-tree-root] [data-entry]")].filter(
            element => element.getClientRects().length > 0,
        );
        const index = entries.indexOf(event.target instanceof HTMLElement ? event.target : target);
        entries[Math.max(0, Math.min(entries.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
    };

    const pickCategory = (key: string) => {
        setSelectedKey(key);
        setSelectedNode(null);
        const parent = parentOf.get(key);
        if (parent) {
            setExpandedCategories(current => new Set([...current, parent]));
        }
    };

    const undo = useCallback(() => dispatch({ type: "undo" }), []);
    const redo = useCallback(() => dispatch({ type: "redo" }), []);

    /* 引导步骤的目标定位：选择器 → 可见元素（不可见/缺失的步骤自动跳过） */
    const tourTarget = (selector: string): HTMLElement[] => {
        const element = document.querySelector<HTMLElement>(selector);
        return element && element.getClientRects().length > 0 ? [element] : [];
    };

    const tourSteps = useMemo<TourStep[]>(
        () => [
            { title: "选品类", text: "先点左边的品类。", targets: () => tourTarget(".bs-category-panel") },
            {
                title: "加内容",
                text: "点 +，填名称。要建分组，就选「分组」。",
                targets: () => tourTarget("#bs-add-root, .bs-tree .bs-add"),
            },
            {
                title: "改顺序",
                text: "上下箭头换顺序，眼睛按钮控制能不能选。",
                targets: () => tourTarget(".bs-tree [data-node-row]"),
            },
            { title: "试试看", text: "点预览，试着选一遍物料。", targets: () => tourTarget("#bs-preview") },
            { title: "保存", text: "改好后点保存，旧 BOM 保持原样。", targets: () => tourTarget("#bs-save") },
        ],
        [],
    );

    if (!can("bom-structure:view")) {
        return <ErrorPage kind="forbidden" />;
    }
    if (isLoading) {
        return <PageLoading label="加载 BOM 结构" />;
    }

    const fullTitle = selectedDraft
        ? `${selectedDraft.name}（编号 ${selectedDraft.codePrefix}…）`
        : selected
          ? parentCategory
              ? `${parentCategory.name} / ${selected.name}`
              : selected.name
          : "";
    const composite = sections.some(section => section.composite);

    /* 弹窗提交处理器（与 dialog 状态一一对应） */
    const dialogNode = dialog;
    const dialogTreeOf = (key: string) => treeOfCategory(key);
    return (
        <div className="bs-page mx-auto w-full pb-3">
            <h1 className="sr-only">BOM 结构</h1>

            <div className="bs-workspace grid gap-3 lg:min-h-90 lg:grid-cols-[200px_minmax(0,1fr)]">
                <CategoryNav
                    roots={rootCategories}
                    childrenOf={childrenOf}
                    drafts={draftCategories}
                    selectedKey={selectedKey}
                    expanded={expandedCategories}
                    onToggle={key =>
                        setExpandedCategories(current => {
                            const next = new Set(current);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                        })
                    }
                    onPick={pickCategory}
                    onCreate={() => setCreating(true)}
                    onDelete={setDeleting}
                    onDiscardDraft={setDiscarding}
                />

                <section
                    className="flex min-h-0 min-w-0 flex-col rounded-card border border-line bg-surface shadow-card max-lg:h-[70dvh] max-lg:min-h-105"
                    aria-label="BOM 结构编辑区"
                    tabIndex={-1}
                >
                    {!hasSelection ? (
                        <div className="flex flex-1 items-center justify-center">
                            <EmptyState description="左侧选择一个品类维护其结构，或点击「新建品类」" />
                        </div>
                    ) : (
                        <>
                            <div className="bs-editor-header flex min-h-14 flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                    <h2 className="min-w-0 truncate text-15 font-semibold text-ink" title={fullTitle}>
                                        {fullTitle}
                                    </h2>
                                    {!composite && (
                                        <Button
                                            id="bs-add-root"
                                            iconOnly
                                            icon="plus"
                                            aria-label="添加内容"
                                            title="添加物料或分组"
                                            className="size-8 text-primary-strong"
                                            onClick={() => actions.openAddNode(selectedKey, { type: "root" })}
                                        />
                                    )}
                                    {selectedDraft && (
                                        <span className="flex-none rounded-[4px] bg-warning/15 px-1.5 py-0.5 text-11 text-warning">
                                            草稿品类 · 保存后入库
                                        </span>
                                    )}
                                    <span
                                        className={cn(
                                            "flex items-center gap-1.5 text-11",
                                            pendingCount > 0 ? "text-warning" : "text-muted",
                                        )}
                                        role="status"
                                    >
                                        <span
                                            className={cn(
                                                "size-1.5 rounded-full",
                                                pendingCount > 0 ? "bg-warning" : "bg-success",
                                            )}
                                        />
                                        {pendingCount > 0 ? `未保存 ${pendingCount} 条` : "已保存"}
                                    </span>
                                </div>
                                {/* min-w-0 + max-lg:shrink：动作区在移动端允许收缩到容器宽，
                                    内部 flex-wrap 才能生效分两行；否则按单行 max-content 宽溢出视口 */}
                                <TableHeaderActions className="bs-header-actions min-w-0 max-lg:shrink flex-wrap justify-end">
                                    <span className="flex items-center gap-0.5 border-r border-line-strong pr-2">
                                        <Button
                                            iconOnly
                                            icon="expand"
                                            aria-label="展开全部"
                                            title="展开全部"
                                            onClick={() =>
                                                setCollapsed(current => {
                                                    const next = new Set(current);
                                                    for (const section of sections) {
                                                        for (const row of flattenTree(section.tree)) {
                                                            next.delete(row.id);
                                                        }
                                                    }
                                                    return next;
                                                })
                                            }
                                            className="size-8 max-lg:size-11"
                                        />
                                        <Button
                                            iconOnly
                                            icon="collapse"
                                            aria-label="收起全部"
                                            title="收起全部"
                                            onClick={() =>
                                                setCollapsed(current => {
                                                    const next = new Set(current);
                                                    for (const section of sections) {
                                                        for (const row of flattenTree(section.tree)) {
                                                            if (row.kind !== "item") {
                                                                next.add(row.id);
                                                            }
                                                        }
                                                    }
                                                    return next;
                                                })
                                            }
                                            className="size-8 max-lg:size-11"
                                        />
                                    </span>
                                    <span className="mr-1 flex items-center gap-0.5 border-r border-line-strong pr-2">
                                        <Button
                                            iconOnly
                                            icon="undo"
                                            aria-label="撤销"
                                            title="撤销 · Ctrl+Z"
                                            disabled={saving || state.past.length === 0}
                                            onClick={undo}
                                            className="size-9 max-lg:size-11"
                                        />
                                        <Button
                                            iconOnly
                                            icon="redo"
                                            aria-label="重做"
                                            title="重做 · Ctrl+Shift+Z"
                                            disabled={saving || state.future.length === 0}
                                            onClick={redo}
                                            className="size-9 max-lg:size-11"
                                        />
                                    </span>
                                    <Button
                                        id="bs-guide"
                                        size="sm"
                                        variant="secondary"
                                        icon="compass"
                                        className="min-h-9 max-sm:px-2 max-sm:text-13"
                                        onClick={() => setTouring(true)}
                                    >
                                        引导
                                    </Button>

                                    <Button
                                        id="bs-preview"
                                        size="sm"
                                        variant="secondary"
                                        icon="eye"
                                        className="min-h-9 max-sm:px-2 max-sm:text-13"
                                        onClick={() => setPreviewing(true)}
                                        disabled={!hasSelection}
                                    >
                                        预览
                                    </Button>
                                    <Button
                                        id="bs-save"
                                        size="sm"
                                        icon="save"
                                        className="min-h-9 max-sm:px-2 max-sm:text-13"
                                        onClick={() => void save()}
                                        disabled={pendingCount === 0 || saving}
                                    >
                                        {saving ? "正在保存…" : "保存结构"}
                                    </Button>
                                </TableHeaderActions>
                            </div>

                            {conflictCategory && (
                                <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-4.5 py-2.5 text-13 text-ink">
                                    <span>「{conflictCategory}」被别人改过了，你的改动还在。</span>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => {
                                            dispatch({ type: "discardAll" });
                                            setConflictCategory(null);
                                            void queryClient.invalidateQueries({ queryKey: bomKeys.categories });
                                        }}
                                    >
                                        拉取最新结构（丢弃草稿）
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setConflictCategory(null)}>
                                        稍后再试
                                    </Button>
                                </div>
                            )}

                            <div
                                className="bs-cols bs-cols-header min-h-7 flex-shrink-0 border-b border-line bg-panel px-2 text-12 text-muted"
                                aria-hidden
                            >
                                <span />
                                <span className="text-center" title="允许同时选择同一分组中的多项物料">
                                    多选
                                </span>
                                <span className="text-center" title="选用物料时可以填写数量">
                                    数量
                                </span>
                                <span className="pr-2 text-right">操作</span>
                            </div>

                            <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onTreeKeyDown}>
                                <StructureTree
                                    sections={sections}
                                    collapsed={collapsed}
                                    selectedId={selectedNode}
                                    actions={actions}
                                />
                            </div>
                        </>
                    )}
                </section>
            </div>

            {creating && (
                <CategoryCreateModal
                    open={creating}
                    onClose={() => setCreating(false)}
                    onDraft={draft => {
                        const key = `draft-${uuid()}`;
                        setDraftCategories(current => [
                            ...current,
                            { key, name: draft.name, codePrefix: draft.codePrefix, types: draft.types },
                        ]);
                        setSelectedKey(key);
                        setSelectedNode(null);
                        setCreating(false);
                        toast.success("草稿品类已创建，搭建结构后点「保存结构」入库");
                    }}
                />
            )}

            {discarding && (
                <Modal
                    open
                    onClose={() => setDiscarding(null)}
                    title={`丢弃草稿品类「${discarding.name}」？`}
                    width={440}
                    footer={
                        <>
                            <Button size="sm" variant="secondary" onClick={() => setDiscarding(null)}>
                                取消
                            </Button>
                            <Button
                                size="sm"
                                variant="danger"
                                onClick={() => {
                                    const key = discarding.key;
                                    setDraftCategories(current => current.filter(entry => entry.key !== key));
                                    dispatch({ type: "replace", key, ops: [] });
                                    setSelectedKey(current => (current === key ? "" : current));
                                    setDiscarding(null);
                                    setSelectedNode(null);
                                }}
                            >
                                丢弃草稿
                            </Button>
                        </>
                    }
                >
                    <p className="text-13 text-muted">
                        该品类尚未写入数据库，右侧未保存的结构草稿会一并丢弃，不影响任何数据。
                    </p>
                </Modal>
            )}

            {previewing && hasSelection && (
                <PreviewModal
                    open={previewing}
                    onClose={() => setPreviewing(false)}
                    title={fullTitle}
                    sections={sections}
                />
            )}

            {deleting && (
                <DeleteCategoryModal
                    categoryName={deleting.name}
                    stats={statsOf(projections.get(deleting.key) ?? [])}
                    onClose={() => setDeleting(null)}
                    onSubmit={() =>
                        deleteCategory.mutate(deleting.key, {
                            onSuccess: () => {
                                toast.success(`品类「${deleting.name}」已删除`);
                                setDeleting(null);
                                setSelectedKey(current =>
                                    current === deleting.key || parentOf.get(current) === deleting.key ? "" : current,
                                );
                            },
                        })
                    }
                />
            )}
            {touring && <StructureTour steps={tourSteps} onClose={() => setTouring(false)} />}

            {dialogNode?.kind === "add-node" && (
                <AddNodeModal
                    categoryName={dialogNode.categoryName}
                    target={dialogNode.target}
                    tree={dialogTreeOf(dialogNode.categoryKey)}
                    onClose={() => setDialog(null)}
                    onSubmit={(kind, name) => {
                        const tempId = uuid();
                        const parentId = dialogNode.target.type === "root" ? null : dialogNode.target.id;
                        const materialGroup = (
                            groupId: string,
                            materialName: string,
                            parent: string | null,
                        ): StructureOperation => ({
                            type: "add_group",
                            tempId: groupId,
                            name: materialName,
                            parentId: parent,
                            multi: false,
                            qty: false,
                            items: [{ tempId: uuid(), name: materialName }],
                        });
                        const ops: StructureOperation[] =
                            kind === "material"
                                ? dialogNode.target.type === "group"
                                    ? [{ type: "add_item", tempId, groupId: dialogNode.target.id, name }]
                                    : [materialGroup(tempId, name, parentId)]
                                : [
                                      {
                                          type: "add_group",
                                          tempId,
                                          name,
                                          parentId,
                                          multi: false,
                                          qty: false,
                                      },
                                  ];
                        dispatch({
                            type: "append",
                            key: dialogNode.categoryKey,
                            ops,
                        });
                        setDialog(null);
                        if (parentId)
                            setCollapsed(current => {
                                const next = new Set(current);
                                next.delete(parentId);
                                return next;
                            });
                        revealAndSelect(tempId);
                        toast.success(kind === "material" ? "物料已添加，保存后生效" : "分组已添加，保存后生效");
                    }}
                />
            )}

            {dialogNode?.kind === "rename" && (
                <RenameModal
                    row={dialogNode.row}
                    tree={dialogNode.tree}
                    onClose={() => {
                        const id = dialogNode.row.id;
                        setDialog(null);
                        setFocusRequest(id);
                    }}
                    onSubmit={name => {
                        const row = dialogNode.row;
                        dispatch({
                            type: "append",
                            key: row.categoryKey,
                            ops: [
                                { type: "rename", targetType: row.kind, targetId: row.id, name },
                                ...(row.materialItemId
                                    ? [
                                          {
                                              type: "rename" as const,
                                              targetType: "item" as const,
                                              targetId: row.materialItemId,
                                              name,
                                          },
                                      ]
                                    : []),
                            ],
                        });
                        setDialog(null);
                        setFocusRequest(row.id);
                        toast.success("名称已修改，保存后生效");
                    }}
                />
            )}

            {dialogNode?.kind === "move" && (
                <MoveModal
                    row={dialogNode.row}
                    tree={dialogNode.tree}
                    categoryName={dialogNode.categoryName}
                    onClose={() => setDialog(null)}
                    onSubmit={parentId => {
                        const row = dialogNode.row;
                        dispatch({
                            type: "append",
                            key: row.categoryKey,
                            ops: [
                                {
                                    type: "move",
                                    targetType: row.kind === "item" ? ("item" as const) : ("group" as const),
                                    targetId: row.id,
                                    parentId,
                                },
                            ],
                        });
                        setDialog(null);
                        revealAndSelect(row.id);
                        toast.success("位置已调整，保存后生效");
                    }}
                />
            )}

            {dialogNode?.kind === "delete" && (
                <DeleteModal
                    row={dialogNode.row}
                    childCount={dialogNode.childCount}
                    onClose={() => setDialog(null)}
                    onSubmit={() => {
                        const row = dialogNode.row;
                        if (row.draft) {
                            dispatch({
                                type: "replace",
                                key: row.categoryKey,
                                ops: withoutDraftSubtree(stateRef.current.drafts[row.categoryKey] ?? [], row.id),
                            });
                            toast.success("已删除（草稿），可撤销");
                        } else {
                            dispatch({
                                type: "append",
                                key: row.categoryKey,
                                ops: [{ type: "remove", targetType: row.kind, targetId: row.id }],
                            });
                            toast.success("已删除，保存后生效；可撤销（Ctrl+Z）");
                        }
                        setDialog(null);
                        setSelectedNode(null);
                    }}
                />
            )}
        </div>
    );
}

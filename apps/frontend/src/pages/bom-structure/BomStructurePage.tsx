import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { PageLoading } from "@/components/ui/PageLoading";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorPage } from "@/pages/error/ErrorPage";
import { Icon } from "@/lib/icons";
import { useToast } from "@/components/ui/toastContexts";
import { useApp } from "@/context/useApp";
import { isApiError } from "@/http";
import { useBomCategories, useDeleteBomCategory, bomKeys, wbKeys } from "@/data/queries";
import { applyBomStructure, type BomCategory, type StructureOperation } from "@/api";
import { uuid } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { CategoryCreateModal } from "./CategoryCreateModal";
import { PreviewModal } from "./PreviewModal";
import { StructureTree, type EditorSection, type RowRef, type TreeActions } from "./StructureTree";
import { AddItemsModal, AddNodeModal, DeleteCategoryModal, DeleteModal, MoveModal, RenameModal } from "./NodeDialogs";
import { StructureTour, type TourStep } from "./StructureTour";
import { applyOpsToView, flattenTree, statsOf, viewTreeOf, withoutDraftSubtree, type ViewRoot } from "./structureView";

/**
 * BOM 结构（仅超管，/product-structure）：按 BOM结构原型.html 重构——左侧品类折叠
 * 面板（复合品类的下属类型可展开点选），右侧树编辑区（多选/数量规则列、行级
 * 上移/下移/不可选/添加/更多），改名/跨父移动/删除、撤销重做（Ctrl+Z / Ctrl+Shift+Z）、
 * Ctrl+S 保存、预览选料效果、操作引导。生效口径：结构变更只影响保存后新建的 BOM，
 * 已保存 BOM 及关联订单、出入库记录按建档冻结快照显示。
 *
 * 草稿模型：每品类一份 ops 草稿（复合视图同时编辑主/子品类两份），保存时逐品类
 * 调 /bom-structure/apply（乐观锁 rowVersion）；409 保留草稿由操作人选择拉取最新
 * 或稍后再试。草稿跨品类切换保留；保存成功后清空历史（撤销不跨越保存边界）。
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
          target: { type: "root" } | { type: "section"; id: string };
      }
    | { kind: "add-items"; categoryKey: string; group: { id: string; name: string } }
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
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
    const [categoryOpen, setCategoryOpen] = useState<string | null>(null);
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const [conflictCategory, setConflictCategory] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    savingRef.current = saving;
    const [creating, setCreating] = useState(false);
    const [deleting, setDeleting] = useState(false);
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
    const parentCategory = selected
        ? ((categories?.find(row => row.key === parentOf.get(selected.key)) ?? null) as BomCategory | null)
        : null;

    /* 各品类当前投影（快照 + 草稿 ops，与后端投影同构） */
    const projections = useMemo(() => {
        const map = new Map<string, ViewRoot[]>();
        for (const row of categories ?? []) {
            map.set(row.key, applyOpsToView(viewTreeOf(row.groups), state.drafts[row.key] ?? []));
        }
        return map;
    }, [categories, state.drafts]);

    /* 复合品类分节：主品类共用结构（有目录时）+ 本品结构；单品类视图无标题 */
    const sections = useMemo<EditorSection[]>(() => {
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
    }, [selected, parentCategory, projections]);

    const stats = useMemo(
        () =>
            sections.reduce(
                (sum, section) => {
                    const next = statsOf(section.tree);
                    return { groups: sum.groups + next.groups, materials: sum.materials + next.materials };
                },
                { groups: 0, materials: 0 },
            ),
        [sections],
    );
    const dirtyKeys = useMemo(
        () => (categories ?? []).filter(row => (state.drafts[row.key]?.length ?? 0) > 0).map(row => row.key),
        [categories, state.drafts],
    );
    const dirtyCount = dirtyKeys.reduce((sum, key) => sum + (state.drafts[key]?.length ?? 0), 0);

    /* 首个品类默认选中（下属类型优先展开归属主品类） */
    useEffect(() => {
        if (!selectedKey && rootCategories.length > 0) {
            setSelectedKey(rootCategories[0]!.key);
        }
    }, [selectedKey, rootCategories]);

    /* 离开页面前的未保存提醒（草稿仅存于内存） */
    useEffect(() => {
        if (dirtyCount === 0) {
            return;
        }
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [dirtyCount]);

    /* 弹窗/操作后的焦点恢复：定位到目标行 */
    useEffect(() => {
        if (!focusRequest) {
            return;
        }
        const id = focusRequest;
        setFocusRequest(null);
        requestAnimationFrame(() => {
            const row = document.querySelector<HTMLElement>(`[data-node-row="${id}"]`);
            (row?.querySelector<HTMLElement>("[data-entry]") ?? row)?.focus({ preventScroll: false });
            row?.scrollIntoView?.({ block: "nearest" });
        });
    }, [focusRequest]);

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
                    ops: [{ type: hidden ? "hide" : "restore", targetType: row.kind, targetId: row.id }],
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
                const category = categories?.find(row => row.key === categoryKey);
                setDialog({ kind: "add-node", categoryKey, categoryName: category?.name ?? "", target });
            },
            openAddItems: (categoryKey, group) => setDialog({ kind: "add-items", categoryKey, group }),
            openRename: row => setDialog({ kind: "rename", row, tree: treeOfCategory(row.categoryKey) }),
            openMove: row => {
                const category = categories?.find(item => item.key === row.categoryKey);
                setDialog({
                    kind: "move",
                    row,
                    tree: treeOfCategory(row.categoryKey),
                    categoryName: category?.name ?? "",
                });
            },
            openRemove: row => {
                /* 删除确认的「N 个子项」计数：分组 = 组内物料；分区 = 子分组 + 各组物料 */
                const tree = treeOfCategory(row.categoryKey);
                let childCount = 0;
                for (const root of tree) {
                    if (row.kind === "group") {
                        const groups = root.kind === "group" ? [root] : root.groups;
                        const group = groups.find(entry => entry.id === row.id);
                        if (group) {
                            childCount = group.items.length;
                            break;
                        }
                    } else if (row.kind === "section" && root.kind === "section" && root.id === row.id) {
                        childCount =
                            root.groups.length + root.groups.reduce((sum, group) => sum + group.items.length, 0);
                        break;
                    }
                }
                setDialog({ kind: "delete", row, childCount });
            },
        }),
        [categories, toast, treeOfCategory],
    );

    const save = useCallback(async () => {
        if (saving || dirtyKeys.length === 0) {
            return;
        }
        setSaving(true);
        let savedCount = 0;
        let hiddenUsage = 0;
        let lastVersion = 0;
        let conflictName: string | null = null;
        let failure: string | null = null;
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
                lastVersion = result.rowVersion;
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
        setSaving(false);
        if (savedCount > 0) {
            void queryClient.invalidateQueries({ queryKey: bomKeys.categories });
            void queryClient.invalidateQueries({ queryKey: bomKeys.list });
            void queryClient.invalidateQueries({ queryKey: wbKeys.all });
            void queryClient.invalidateQueries({ queryKey: ["workbench"] });
            toast.success(
                (savedCount === 1
                    ? `结构已保存（新版本 ${lastVersion}），对之后新建的 BOM 生效`
                    : `已保存 ${savedCount} 个品类的结构（最新版本 ${lastVersion}）`) +
                    (hiddenUsage > 0 ? `；隐藏的物料仍被 ${hiddenUsage} 行既有 BOM 引用，旧档案不受影响` : ""),
            );
            setConflictCategory(null);
        }
        if (conflictName) {
            setConflictCategory(conflictName);
        }
        if (failure) {
            toast.error(failure);
        }
    }, [saving, dirtyKeys, categories, queryClient, toast]);

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
                        setDialog({
                            kind: "rename",
                            row: {
                                categoryKey: section.categoryKey,
                                kind: row.kind,
                                id: row.id,
                                name: row.name,
                                draft: row.draft,
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
        if (!target.matches("[data-entry]") && !target.closest("[data-node-row]")) {
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
            setCategoryOpen(parent);
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
            {
                title: "选择品类",
                text: "点左边的品类展开，再选下面的类型（如「焊线」），就能开始整理这个品类的物料。没有想要的品类？点「新建品类」自己建一个。",
                note: "品类下面有哪些类型，是新建品类时一起设置的；组合品类的几个组成部分会在右侧一起列出。",
                targets: () => tourTarget(".bs-category-panel"),
            },
            {
                title: "新建一个分组",
                text: "点「新增分组」，起个好认的名字（如「五金件」「塑料件」），之后同类的物料就放到它下面。",
                note: "分组挂物料；分区用来归类分组，两者都可在保存前调整位置与规则。",
                targets: () => tourTarget("#bs-add-root"),
            },
            {
                title: "继续添加分组和物料",
                text: "行内的「＋」可以添加内容：分组里加物料，分区里加分组。",
                note: "分组下的物料一行一个名称，可以一次添加多项。",
                targets: () => {
                    const buttons = [...document.querySelectorAll<HTMLElement>(".bs-tree button[aria-label^='添加']")];
                    const visible = buttons.find(element => element.getClientRects().length > 0);
                    return visible ? [visible] : [];
                },
            },
            {
                title: "调整顺序与显示",
                text: "用上下箭头调整先后顺序；点眼睛图标把物料「设为不可选」，再点一下恢复。要改名或挪到别的分组，点「更多操作」。",
                note: "设为不可选只是变成灰色，不会删除，随时可恢复；以后新建 BOM 选料时选不到它。",
                targets: () => tourTarget(".bs-tree [data-node-row]"),
            },
            {
                title: "设置多选和数量",
                text: "勾上「多选」，这个分组里的物料就能同时挑好几项；勾上「数量」，选料时还能填写要用多少个。",
                note: "这两个开关只管当前分组里的物料，不影响其他分组。",
                targets: () => {
                    const checks = [...document.querySelectorAll<HTMLElement>(".bs-tree input[type='checkbox']")];
                    const visible = checks.find(
                        element => element.getClientRects().length > 0 && !(element as HTMLInputElement).disabled,
                    );
                    return visible ? [visible.closest<HTMLElement>("[data-node-row]") ?? visible] : [];
                },
            },
            {
                title: "预览选择效果",
                text: "点「预览」，就能看到以后新建 BOM 时大家是怎么选料的，多选、填数量都可以现场试一试。",
                note: "预览里怎么点都只是看效果，不会保存。",
                targets: () => tourTarget("#bs-preview"),
            },
            {
                title: "最后保存结构",
                text: "都整理好了，点「保存结构」就完成了。有改动还没保存时，页面会显示提示。",
                note: "也可以按 Ctrl + S 直接保存；已保存的旧 BOM 不受影响。",
                targets: () => tourTarget("#bs-save"),
            },
        ],
        [],
    );

    if (!can("bom-structure:view")) {
        return <ErrorPage kind="forbidden" />;
    }
    if (isLoading) {
        return <PageLoading label="加载 BOM 结构" />;
    }

    const fullTitle = selected ? (parentCategory ? `${parentCategory.name} / ${selected.name}` : selected.name) : "";
    const composite = sections.length > 1;

    /* 弹窗提交处理器（与 dialog 状态一一对应） */
    const dialogNode = dialog;
    const dialogTreeOf = (key: string) => treeOfCategory(key);
    return (
        <div className="mx-auto w-full max-w-wrap-padding px-4 pb-6 pt-4 sm:px-6">
            <header className="mb-3 flex items-center justify-between gap-3">
                <h1 className="text-15 font-semibold text-ink">BOM 结构</h1>
                <div className="flex items-center gap-2">
                    <span className="mr-1 flex items-center gap-0.5 border-r border-line-strong pr-2">
                        <Button
                            iconOnly
                            icon="undo"
                            aria-label="撤销"
                            title="撤销 · Ctrl+Z"
                            disabled={saving || state.past.length === 0}
                            onClick={undo}
                            className="size-9"
                        />
                        <Button
                            iconOnly
                            icon="redo"
                            aria-label="重做"
                            title="重做 · Ctrl+Shift+Z"
                            disabled={saving || state.future.length === 0}
                            onClick={redo}
                            className="size-9"
                        />
                    </span>
                    <Button id="bs-guide" size="sm" variant="secondary" icon="compass" onClick={() => setTouring(true)}>
                        引导
                    </Button>
                    <Button
                        id="bs-preview"
                        size="sm"
                        variant="secondary"
                        icon="eye"
                        onClick={() => setPreviewing(true)}
                        disabled={!selected}
                    >
                        预览
                    </Button>
                    <Button id="bs-save" icon="save" onClick={() => void save()} disabled={dirtyCount === 0 || saving}>
                        {saving ? "正在保存…" : "保存结构"}
                    </Button>
                </div>
            </header>

            <div className="grid gap-4 lg:h-[calc(100dvh-128px)] lg:min-h-105 lg:grid-cols-[212px_minmax(0,1fr)]">
                <aside
                    className="bs-category-panel flex min-h-0 flex-col rounded-panel border border-line bg-surface p-3 max-lg:max-h-48"
                    aria-label="品类导航"
                >
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <h2 className="text-14 font-semibold text-ink">品类</h2>
                        <button
                            type="button"
                            className="flex items-center gap-1 text-12 text-muted transition hover:text-primary-strong"
                            onClick={() => setCreating(true)}
                        >
                            <Icon name="plus" size={14} />
                            新建品类
                        </button>
                    </div>
                    <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="选择品类">
                        {rootCategories.map(root => {
                            const children = childrenOf.get(root.key) ?? [];
                            const open = categoryOpen === root.key;
                            const inPath = selectedKey !== "" && children.some(child => child.key === selectedKey);
                            if (children.length === 0) {
                                return (
                                    <button
                                        key={root.key}
                                        type="button"
                                        onClick={() => pickCategory(root.key)}
                                        aria-current={root.key === selectedKey ? "page" : undefined}
                                        title={`前缀 ${root.codePrefix} · 版本 ${root.rowVersion}`}
                                        className={cn(
                                            "mb-0.5 flex w-full items-center gap-2.5 rounded-[10px] px-3.5 py-2.5 text-left text-14 transition",
                                            root.key === selectedKey
                                                ? "bg-primary-soft font-semibold text-primary-strong"
                                                : "text-td hover:bg-soft",
                                        )}
                                    >
                                        <Icon name="layers" size={16} className="flex-none text-muted" />
                                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{root.name}</span>
                                    </button>
                                );
                            }
                            return (
                                <div key={root.key} className="mb-1">
                                    <button
                                        type="button"
                                        aria-expanded={open}
                                        onClick={() => setCategoryOpen(open ? null : root.key)}
                                        title={`前缀 ${root.codePrefix} · 版本 ${root.rowVersion}`}
                                        className={cn(
                                            "flex w-full items-center gap-2.5 rounded-[10px] px-3.5 py-2.5 text-left text-14 transition",
                                            inPath ? "font-medium text-ink" : "text-td hover:bg-soft",
                                        )}
                                    >
                                        <Icon name="layers" size={16} className="flex-none text-muted" />
                                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{root.name}</span>
                                        <span
                                            aria-hidden
                                            className={cn(
                                                "flex size-4 flex-none items-center justify-center text-muted transition-transform",
                                                !open && "-rotate-90",
                                            )}
                                        >
                                            <Icon name="chevron-down" size={15} />
                                        </span>
                                    </button>
                                    {open && (
                                        <div className="mb-1 ml-2 border-l border-line pl-1">
                                            {children.map(child => (
                                                <button
                                                    key={child.key}
                                                    type="button"
                                                    onClick={() => pickCategory(child.key)}
                                                    aria-current={child.key === selectedKey ? "page" : undefined}
                                                    title={`前缀 ${child.codePrefix} · 版本 ${child.rowVersion}`}
                                                    className={cn(
                                                        "flex w-full items-center gap-2 rounded-[10px] py-2 pr-2.5 pl-8 text-left text-14 transition",
                                                        child.key === selectedKey
                                                            ? "bg-primary-soft font-semibold text-primary-strong"
                                                            : "text-td hover:bg-soft",
                                                    )}
                                                >
                                                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                                                        {child.name}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </nav>
                </aside>

                <section
                    className="flex min-h-0 flex-col rounded-panel border border-line bg-surface shadow-card max-lg:h-[70dvh] max-lg:min-h-105"
                    aria-label="BOM 结构编辑区"
                    tabIndex={-1}
                >
                    {!selected ? (
                        <div className="flex flex-1 items-center justify-center">
                            <EmptyState description="左侧选择一个品类维护其结构，或点击「新建品类」" />
                        </div>
                    ) : (
                        <>
                            <div className="flex h-16 flex-shrink-0 items-center justify-between gap-4 border-b border-line px-4.5">
                                <div className="flex min-w-0 items-baseline gap-3.25">
                                    <h2
                                        className="min-w-0 max-w-[45%] truncate text-17 font-semibold text-ink"
                                        title={fullTitle}
                                    >
                                        {fullTitle}
                                    </h2>
                                    <p className="whitespace-nowrap text-12 text-muted tabular-nums">
                                        {stats.groups} 个分组 · {stats.materials} 项物料
                                    </p>
                                </div>
                                <div className="flex flex-none items-center gap-3">
                                    <span
                                        className={cn(
                                            "flex items-center gap-1.5 text-11",
                                            dirtyCount > 0 ? "text-warning" : "text-muted",
                                        )}
                                        role="status"
                                    >
                                        <span
                                            className={cn(
                                                "size-1.5 rounded-full",
                                                dirtyCount > 0 ? "bg-warning" : "bg-success",
                                            )}
                                        />
                                        {dirtyCount > 0 ? `未保存 ${dirtyCount} 条` : "已保存"}
                                    </span>
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
                                            className="size-8"
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
                                            className="size-8"
                                        />
                                    </span>
                                    <Button
                                        id="bs-delete-cat"
                                        size="sm"
                                        variant="ghost"
                                        tone="danger"
                                        icon="trash"
                                        onClick={() => setDeleting(true)}
                                    >
                                        删除品类
                                    </Button>
                                    {!composite && (
                                        <Button
                                            id="bs-add-root"
                                            size="sm"
                                            variant="secondary"
                                            icon="plus"
                                            onClick={() =>
                                                setDialog({
                                                    kind: "add-node",
                                                    categoryKey: selected.key,
                                                    categoryName: selected.name,
                                                    target: { type: "root" },
                                                })
                                            }
                                        >
                                            新增分组
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {conflictCategory && (
                                <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-4.5 py-2.5 text-13 text-ink">
                                    <span>
                                        品类「{conflictCategory}」的结构已被他人修改，当前草稿基于旧版本（草稿已保留）。
                                    </span>
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
                                className="bs-cols bs-cols-header flex-shrink-0 border-b border-line bg-panel px-3 text-12 text-muted"
                                aria-hidden
                            >
                                <span className="pl-3">分组 / 物料</span>
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
                    onCreated={created => {
                        const target = created.types?.[0]?.key ?? created.key;
                        setSelectedKey(target);
                        setSelectedNode(null);
                        setCategoryOpen(created.types?.length ? created.key : null);
                    }}
                />
            )}

            {previewing && selected && (
                <PreviewModal
                    open={previewing}
                    onClose={() => setPreviewing(false)}
                    title={fullTitle}
                    sections={sections}
                />
            )}

            {deleting && selected && (
                <DeleteCategoryModal
                    categoryName={selected.name}
                    stats={statsOf(projections.get(selected.key) ?? [])}
                    onClose={() => setDeleting(false)}
                    onSubmit={() =>
                        deleteCategory.mutate(selected.key, {
                            onSuccess: () => {
                                toast.success(`品类「${selected.name}」已删除`);
                                setDeleting(false);
                                setSelectedKey("");
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
                    onSubmit={(kind, name, items) => {
                        const tempId = uuid();
                        dispatch({
                            type: "append",
                            key: dialogNode.categoryKey,
                            ops:
                                kind === "SECTION"
                                    ? [{ type: "add_section", tempId, name }]
                                    : [
                                          {
                                              type: "add_group",
                                              tempId,
                                              name,
                                              parentId:
                                                  dialogNode.target.type === "section" ? dialogNode.target.id : null,
                                              multi: false,
                                              qty: false,
                                              ...(items.length > 0
                                                  ? { items: items.map(item => ({ tempId: uuid(), name: item })) }
                                                  : {}),
                                          },
                                      ],
                        });
                        setDialog(null);
                        revealAndSelect(tempId);
                        toast.success(kind === "SECTION" ? "分区已添加，保存后生效" : "分组已添加，保存后生效");
                    }}
                />
            )}

            {dialogNode?.kind === "add-items" && (
                <AddItemsModal
                    group={dialogNode.group}
                    tree={dialogTreeOf(dialogNode.categoryKey)}
                    onClose={() => setDialog(null)}
                    onSubmit={items => {
                        const tempIds = items.map(() => uuid());
                        dispatch({
                            type: "append",
                            key: dialogNode.categoryKey,
                            ops: items.map((name, index) => ({
                                type: "add_item" as const,
                                tempId: tempIds[index]!,
                                groupId: dialogNode.group.id,
                                name,
                            })),
                        });
                        setDialog(null);
                        setCollapsed(current => {
                            const next = new Set(current);
                            next.delete(dialogNode.group.id);
                            return next;
                        });
                        revealAndSelect(tempIds[0]!);
                        toast.success(`已添加 ${items.length} 项物料，保存后生效`);
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
                            ops: [{ type: "rename", targetType: row.kind, targetId: row.id, name }],
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

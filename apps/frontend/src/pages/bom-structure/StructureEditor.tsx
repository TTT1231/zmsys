import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { ViewGroupNode, ViewItem, ViewRoot, ViewSectionNode } from "./structureView";

/** 编辑动作回调：edit 模式追加 op / create 模式改草稿，两种实现见调用方 */
export interface EditorActions {
    addSection(name: string): void;
    addGroup(
        parentId: string | null,
        name: string,
        multi: boolean,
        qty: boolean,
        isModel: boolean,
        items: string[],
    ): void;
    addItem(groupId: string, name: string): void;
    setHidden(kind: "section" | "group" | "item", id: string, hidden: boolean): void;
    move(kind: "section" | "group" | "item", id: string, direction: "up" | "down"): void;
    setRules(groupId: string, multi: boolean, qty: boolean): void;
    /** 仅草稿节点可移除（新建模式整树 / 编辑模式本批新增） */
    removeDraft?(kind: "section" | "group" | "item", id: string): void;
}

/* 行内新增表单：分区/分组（含规则与型号标记、随组物料）/ 物料 三种形态 */
function AddForm({
    kind,
    onSubmit,
    onCancel,
}: {
    kind: "section" | "root-group" | "group" | "item";
    onSubmit: (name: string, multi: boolean, qty: boolean, isModel: boolean, items: string[]) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState("");
    const [multi, setMulti] = useState(false);
    const [qty, setQty] = useState(false);
    const [isModel, setIsModel] = useState(false);
    const [items, setItems] = useState("");
    const isGroup = kind === "root-group" || kind === "group";
    const trimmed = name.trim();
    const submit = () => {
        if (!trimmed) {
            return;
        }
        onSubmit(
            trimmed,
            multi,
            qty,
            isModel,
            items
                .split(/[,，、\s]+/)
                .map(entry => entry.trim())
                .filter(entry => entry.length > 0),
        );
    };
    return (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-dashed border-line bg-soft/50 px-3 py-2.5">
            <input
                autoFocus
                value={name}
                onChange={event => setName(event.target.value)}
                onKeyDown={event => event.key === "Enter" && submit()}
                placeholder={kind === "item" ? "物料名称" : kind === "section" ? "分区名称" : "分组名称"}
                className="min-w-40 flex-1 rounded-btn border border-line bg-surface px-3 py-1.5 text-14 text-ink outline-none focus:border-ink/40"
            />
            {isGroup && (
                <>
                    <label className="flex items-center gap-1.5 text-13 text-muted">
                        <input type="checkbox" checked={multi} onChange={event => setMulti(event.target.checked)} />
                        多选
                    </label>
                    <label className="flex items-center gap-1.5 text-13 text-muted">
                        <input type="checkbox" checked={qty} onChange={event => setQty(event.target.checked)} />
                        可填数量
                    </label>
                    <label className="flex items-center gap-1.5 text-13 text-muted">
                        <input type="checkbox" checked={isModel} onChange={event => setIsModel(event.target.checked)} />
                        型号组
                    </label>
                    <input
                        value={items}
                        onChange={event => setItems(event.target.value)}
                        placeholder="随组物料（逗号/空格分隔，可空）"
                        className="min-w-44 flex-1 rounded-btn border border-line bg-surface px-3 py-1.5 text-13 text-ink outline-none focus:border-ink/40"
                    />
                </>
            )}
            <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" type="button" onClick={submit} disabled={!trimmed}>
                    添加
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
                    取消
                </Button>
            </div>
        </div>
    );
}

const rowButton =
    "rounded-btn px-2 py-0.5 text-12 text-muted transition hover:bg-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

function HiddenBadge() {
    return <span className="rounded-full bg-soft px-2 py-0.5 text-11 font-medium text-muted">已隐藏</span>;
}

function DraftBadge() {
    return <span className="rounded-full bg-info/10 px-2 py-0.5 text-11 font-medium text-info">新增</span>;
}

function GroupRow({
    group,
    ancestorHidden,
    actions,
    mode,
}: {
    group: ViewGroupNode;
    ancestorHidden: boolean;
    actions: EditorActions;
    mode: "edit" | "create";
}) {
    const [adding, setAdding] = useState(false);
    const effectivelyHidden = ancestorHidden || !group.status;
    return (
        <div className={cn("ml-6", effectivelyHidden && "opacity-55")}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
                <span className="text-14 font-medium text-ink">{group.name}</span>
                <span className="rounded-full border border-line px-2 py-0.5 text-11 text-muted">
                    {group.multi ? "多选" : "单选"}
                    {group.qty ? " + 数量" : ""}
                </span>
                {group.isModel && (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-11 font-medium text-success">
                        型号组
                    </span>
                )}
                {group.draft && <DraftBadge />}
                {!group.status && <HiddenBadge />}
                {/* 规则即时改（set_rules 只影响之后新建 BOM 的校验，历史档案不受影响）：
                 * 已保存分组追加 set_rules op；草稿分组同样经 actions 收口（edit 模式
                 * set_rules 支持 tempId，create 模式直接改草稿） */}
                <span className="flex items-center gap-2 text-12 text-muted">
                    <label className="flex items-center gap-1">
                        <input
                            type="checkbox"
                            checked={group.multi}
                            onChange={event => actions.setRules(group.id, event.target.checked, group.qty)}
                        />
                        多选
                    </label>
                    <label className="flex items-center gap-1">
                        <input
                            type="checkbox"
                            checked={group.qty}
                            onChange={event => actions.setRules(group.id, group.multi, event.target.checked)}
                        />
                        数量
                    </label>
                </span>
                <span className="ml-auto flex items-center gap-0.5">
                    <button type="button" className={rowButton} onClick={() => actions.move("group", group.id, "up")}>
                        上移
                    </button>
                    <button type="button" className={rowButton} onClick={() => actions.move("group", group.id, "down")}>
                        下移
                    </button>
                    {mode === "edit" && (
                        <button
                            type="button"
                            className={rowButton}
                            onClick={() => actions.setHidden("group", group.id, group.status)}
                        >
                            {group.status ? "隐藏" : "恢复"}
                        </button>
                    )}
                    <button type="button" className={rowButton} onClick={() => setAdding(current => !current)}>
                        + 物料
                    </button>
                    {group.draft && actions.removeDraft && (
                        <button
                            type="button"
                            className={cn(rowButton, "text-danger hover:text-danger")}
                            onClick={() => actions.removeDraft?.("group", group.id)}
                        >
                            移除
                        </button>
                    )}
                </span>
            </div>
            {adding && (
                <AddForm
                    kind="item"
                    onCancel={() => setAdding(false)}
                    onSubmit={name => {
                        actions.addItem(group.id, name);
                        setAdding(false);
                    }}
                />
            )}
            <ul className="ml-6">
                {group.items.map(item => (
                    <ItemRow
                        key={item.id}
                        item={item}
                        ancestorHidden={effectivelyHidden}
                        actions={actions}
                        mode={mode}
                    />
                ))}
            </ul>
        </div>
    );
}

function ItemRow({
    item,
    ancestorHidden,
    actions,
    mode,
}: {
    item: ViewItem;
    ancestorHidden: boolean;
    actions: EditorActions;
    mode: "edit" | "create";
}) {
    const effectivelyHidden = ancestorHidden || !item.status;
    return (
        <li className={cn("flex items-center gap-2 py-0.5 text-13", effectivelyHidden ? "opacity-55" : "text-ink")}>
            <span className="text-muted">·</span>
            <span>{item.name}</span>
            {item.draft && <DraftBadge />}
            {!item.status && <HiddenBadge />}
            <span className="ml-auto flex items-center gap-0.5">
                <button type="button" className={rowButton} onClick={() => actions.move("item", item.id, "up")}>
                    上移
                </button>
                <button type="button" className={rowButton} onClick={() => actions.move("item", item.id, "down")}>
                    下移
                </button>
                {mode === "edit" && (
                    <button
                        type="button"
                        className={rowButton}
                        onClick={() => actions.setHidden("item", item.id, item.status)}
                    >
                        {item.status ? "隐藏" : "恢复"}
                    </button>
                )}
                {item.draft && actions.removeDraft && (
                    <button
                        type="button"
                        className={cn(rowButton, "text-danger hover:text-danger")}
                        onClick={() => actions.removeDraft?.("item", item.id)}
                    >
                        移除
                    </button>
                )}
            </span>
        </li>
    );
}

function SectionRow({
    section,
    actions,
    mode,
}: {
    section: ViewSectionNode;
    actions: EditorActions;
    mode: "edit" | "create";
}) {
    const [adding, setAdding] = useState(false);
    const effectivelyHidden = !section.status;
    return (
        <div className={cn(effectivelyHidden && "opacity-55")}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2">
                <span className="text-14 font-semibold text-muted">{section.name}</span>
                {section.draft && <DraftBadge />}
                {!section.status && <HiddenBadge />}
                <span className="ml-auto flex items-center gap-0.5">
                    <button
                        type="button"
                        className={rowButton}
                        onClick={() => actions.move("section", section.id, "up")}
                    >
                        上移
                    </button>
                    <button
                        type="button"
                        className={rowButton}
                        onClick={() => actions.move("section", section.id, "down")}
                    >
                        下移
                    </button>
                    {mode === "edit" && (
                        <button
                            type="button"
                            className={rowButton}
                            onClick={() => actions.setHidden("section", section.id, section.status)}
                        >
                            {section.status ? "隐藏" : "恢复"}
                        </button>
                    )}
                    <button type="button" className={rowButton} onClick={() => setAdding(current => !current)}>
                        + 分组
                    </button>
                    {section.draft && actions.removeDraft && (
                        <button
                            type="button"
                            className={cn(rowButton, "text-danger hover:text-danger")}
                            onClick={() => actions.removeDraft?.("section", section.id)}
                        >
                            移除
                        </button>
                    )}
                </span>
            </div>
            {adding && (
                <AddForm
                    kind="group"
                    onCancel={() => setAdding(false)}
                    onSubmit={(name, multi, qty, isModel, items) => {
                        actions.addGroup(section.id, name, multi, qty, isModel, items);
                        setAdding(false);
                    }}
                />
            )}
            <div className="mt-1">
                {section.groups.map(group => (
                    <GroupRow
                        key={group.id}
                        group={group}
                        ancestorHidden={effectivelyHidden}
                        actions={actions}
                        mode={mode}
                    />
                ))}
            </div>
        </div>
    );
}

/** 树编辑器：分区/分组/物料三级，行内上移下移、隐藏恢复（edit 模式）、新增与规则配置 */
export function StructureEditor({
    roots,
    actions,
    mode,
}: {
    roots: ViewRoot[];
    actions: EditorActions;
    mode: "edit" | "create";
}) {
    const [addingSection, setAddingSection] = useState(false);
    const [addingRootGroup, setAddingRootGroup] = useState(false);
    return (
        <div>
            <div className="flex items-center gap-2 border-b border-line pb-2">
                <button type="button" className={rowButton} onClick={() => setAddingSection(current => !current)}>
                    + 分区
                </button>
                <button type="button" className={rowButton} onClick={() => setAddingRootGroup(current => !current)}>
                    + 根分组
                </button>
                <span className="text-12 text-placeholder">
                    隐藏 = 整支不可再选（已建 BOM 不受影响）；恢复分区不会恢复单独隐藏的子项
                </span>
            </div>
            {addingSection && (
                <AddForm
                    kind="section"
                    onCancel={() => setAddingSection(false)}
                    onSubmit={name => {
                        actions.addSection(name);
                        setAddingSection(false);
                    }}
                />
            )}
            {addingRootGroup && (
                <AddForm
                    kind="root-group"
                    onCancel={() => setAddingRootGroup(false)}
                    onSubmit={(name, multi, qty, isModel, items) => {
                        actions.addGroup(null, name, multi, qty, isModel, items);
                        setAddingRootGroup(false);
                    }}
                />
            )}
            <div className="mt-2 space-y-1">
                {roots.map(root =>
                    root.kind === "section" ? (
                        <SectionRow key={root.id} section={root} actions={actions} mode={mode} />
                    ) : (
                        <GroupRow key={root.id} group={root} ancestorHidden={false} actions={actions} mode={mode} />
                    ),
                )}
                {roots.length === 0 && (
                    <p className="py-6 text-center text-13 text-placeholder">暂无结构，先添加分区或分组</p>
                )}
            </div>
        </div>
    );
}

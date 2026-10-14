import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { EditorSection } from "./StructureTree";
import type { ViewGroupNode, ViewRoot } from "./structureView";

/**
 * 「预览」弹窗：按当前草稿投影出的目录，模拟新建 BOM 时的选料效果（单选/多选/
 * 数量 1-99，语义与建档 NewBomModal 一致）。只读本地状态，关闭即弃。
 */

interface PreviewOption {
    itemId: string;
    name: string;
    groupId: string;
    groupName: string;
    sectionName: string | null;
    multi: boolean;
    qty: boolean;
    disabled: boolean;
}

/** 分组的直属物料与子分组；祖先隐藏时整支不可选。 */
function OptionGroup({
    group,
    sectionName,
    sectionHidden,
    selection,
    onToggle,
    onQty,
}: {
    group: ViewGroupNode;
    sectionName: string | null;
    /** 所属分区已设为不可选：其下分组整体不可选（= 自身∧祖先启用，与建档口径一致） */
    sectionHidden: boolean;
    selection: ReadonlyMap<string, number>;
    onToggle: (group: ViewGroupNode, itemId: string) => void;
    onQty: (itemId: string, qty: number) => void;
}) {
    if (group.items.length === 0 && !group.groups?.length) {
        return null;
    }
    const hidden = sectionHidden || !group.status;
    return (
        <section className="mt-3 first:mt-0">
            <h4 className="flex items-center gap-2 text-14 font-semibold text-ink">
                <Icon name={hidden ? "folder" : "folder-open"} size={16} className="text-muted" />
                <span className={cn(hidden && "text-muted")}>{group.name}</span>
                {group.items.some(item => selection.has(item.id)) && (
                    <span className="rounded-[5px] bg-primary-soft px-1.5 text-11 font-normal text-primary-strong">
                        {hidden ? "不可选" : group.multi ? "多选" : "单选"}
                        {group.qty ? " · 数量" : ""}
                    </span>
                )}
            </h4>
            {group.items.length > 0 && (
                <div className="mt-2 ml-1.5 grid gap-1.75 border-l border-line pl-3">
                    {group.items.map(item => {
                        const disabled = hidden || !item.status;
                        const checked = !disabled && selection.has(item.id);
                        return (
                            <label
                                key={item.id}
                                className={cn(
                                    "flex min-h-9 cursor-pointer items-center gap-2.25 rounded-btn border px-2.75 py-2 text-13 transition",
                                    checked
                                        ? "border-primary-border bg-primary-soft"
                                        : "border-line bg-surface hover:border-primary-border",
                                    disabled && "cursor-not-allowed opacity-70",
                                )}
                            >
                                <input
                                    type={group.multi ? "checkbox" : "radio"}
                                    name={`preview-${group.id}`}
                                    className="size-4 accent-primary"
                                    checked={checked}
                                    disabled={disabled}
                                    onChange={() => onToggle(group, item.id)}
                                />
                                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item.name}</span>
                                {disabled && <span className="text-11 text-muted">不可选</span>}
                                {group.qty && (
                                    <span className="flex flex-none items-center gap-1 text-11 text-muted">
                                        <input
                                            type="number"
                                            min={1}
                                            max={99}
                                            step={1}
                                            className="w-12.5 rounded-[4px] border border-line-strong bg-surface px-1 py-0.5 text-center text-12 text-ink outline-none focus:border-primary disabled:border-line disabled:bg-soft disabled:text-placeholder"
                                            value={selection.get(item.id) ?? 1}
                                            disabled={!checked}
                                            aria-label={`${item.name}数量`}
                                            onChange={event => onQty(item.id, Number(event.target.value))}
                                            onBlur={event =>
                                                onQty(
                                                    item.id,
                                                    Math.min(99, Math.max(1, Number(event.target.value) || 1)),
                                                )
                                            }
                                        />
                                        个
                                    </span>
                                )}
                            </label>
                        );
                    })}
                </div>
            )}
            {(group.groups?.length ?? 0) > 0 && (
                <div className="mt-3 ml-1.5 border-l border-line pl-3">
                    {(group.groups ?? []).map(child => (
                        <OptionGroup
                            key={child.id}
                            group={child}
                            sectionName={[sectionName, group.name].filter(Boolean).join(" / ")}
                            sectionHidden={hidden}
                            selection={selection}
                            onToggle={onToggle}
                            onQty={onQty}
                        />
                    ))}
                </div>
            )}
            <span className="sr-only">{sectionName}</span>
        </section>
    );
}

export function PreviewModal({
    open,
    onClose,
    title,
    sections,
}: {
    open: boolean;
    onClose: () => void;
    /** 品类全名（如 跌倒开关 / 新微动跌倒） */
    title: string;
    /** 当前草稿投影后的分节树（与编辑区同源） */
    sections: EditorSection[];
}) {
    const [selection, setSelection] = useState<Map<string, number>>(new Map());

    useEffect(() => {
        if (open) {
            setSelection(new Map());
        }
    }, [open]);

    const toggle = (group: ViewGroupNode, itemId: string) => {
        setSelection(current => {
            const next = new Map(current);
            if (!group.multi) {
                for (const item of group.items) {
                    next.delete(item.id);
                }
            }
            if (next.has(itemId)) {
                next.delete(itemId);
            } else {
                next.set(itemId, 1);
            }
            return next;
        });
    };

    const setQty = (itemId: string, qty: number) => {
        setSelection(current => {
            if (!current.has(itemId)) {
                return current;
            }
            const next = new Map(current);
            next.set(itemId, Math.min(99, Math.max(1, Math.round(qty) || 1)));
            return next;
        });
    };

    /* 名称 → 选择行路径（已选列表展示用） */
    const nameOf = useMemo(() => {
        const map = new Map<string, PreviewOption>();
        const visit = (node: ViewRoot, ancestors: string[], ancestorHidden: boolean) => {
            const hidden = ancestorHidden || !node.status;
            if (node.kind === "group") {
                for (const item of node.items) {
                    map.set(item.id, {
                        itemId: item.id,
                        name: item.name,
                        groupId: node.id,
                        groupName: node.name,
                        sectionName: ancestors.join(" / ") || null,
                        multi: node.multi,
                        qty: node.qty,
                        disabled: hidden || !item.status,
                    });
                }
            }
            for (const child of node.groups ?? []) visit(child, [...ancestors, node.name], hidden);
        };
        for (const section of sections) {
            for (const root of section.tree) visit(root, [], false);
        }
        return map;
    }, [sections]);

    const entries = [...selection.entries()];
    const total = entries.reduce((sum, [, qty]) => sum + qty, 0);

    const renderTree = (tree: ViewRoot[]) =>
        tree.map(root =>
            root.kind === "group" ? (
                <OptionGroup
                    key={root.id}
                    group={root}
                    sectionName={null}
                    sectionHidden={false}
                    selection={selection}
                    onToggle={toggle}
                    onQty={setQty}
                />
            ) : (
                root.groups.length > 0 && (
                    <section key={root.id} className="mt-4 first:mt-0 border-b border-line pb-3">
                        <h3
                            className={cn(
                                "flex items-center gap-2 text-14 font-semibold text-primary-strong",
                                !root.status && "text-muted",
                            )}
                        >
                            <Icon name={root.status ? "folder-open" : "folder"} size={16} className="text-muted" />
                            {root.name}
                            {!root.status && <span className="text-11 font-normal text-muted">不可选</span>}
                        </h3>
                        <div className="mt-1">
                            {root.groups.map(group => (
                                <OptionGroup
                                    key={group.id}
                                    group={group}
                                    sectionName={root.name}
                                    sectionHidden={!root.status}
                                    selection={selection}
                                    onToggle={toggle}
                                    onQty={setQty}
                                />
                            ))}
                        </div>
                    </section>
                )
            ),
        );

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="预览"
            subtitle={`${title} · 查看新建 BOM 时的物料选择效果（不会保存）`}
            width={1000}
            layout="workspace"
            footer={
                <>
                    <span className="mr-auto text-12 text-muted">
                        {entries.length > 0 ? `已选 ${entries.length} 项 · 总数量 ${total}` : "未选择物料"}
                    </span>
                    <Button size="sm" variant="primary" onClick={onClose}>
                        关闭预览
                    </Button>
                </>
            }
        >
            <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_264px]">
                <div className="min-h-0 overflow-y-auto pr-4 max-lg:pb-4">
                    {sections.map(
                        section =>
                            section.tree.some(
                                root => root.kind === "group" || (root.kind === "section" && root.groups.length > 0),
                            ) && (
                                <div key={section.categoryKey} className="mb-5 last:mb-0">
                                    {section.composite && (
                                        <h3 className="mb-2 flex items-center text-14 font-semibold text-primary-strong">
                                            {section.label}
                                        </h3>
                                    )}
                                    {renderTree(section.tree)}
                                </div>
                            ),
                    )}
                    {nameOf.size === 0 && (
                        <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-13 text-muted">
                            <strong className="font-normal text-ink">当前品类没有可选物料</strong>
                            <p className="text-12">先添加分组和物料，再回来预览</p>
                        </div>
                    )}
                </div>
                <aside
                    className="min-h-0 overflow-y-auto border-t border-line bg-panel px-5 py-4 lg:border-t-0 lg:border-l"
                    aria-live="polite"
                >
                    <h3 className="flex items-center gap-2 text-14 font-semibold text-ink">
                        已选物料
                        <span className="rounded-[5px] bg-primary-soft px-1.5 text-11 font-normal text-primary-strong">
                            {entries.length}
                        </span>
                    </h3>
                    {entries.length === 0 ? (
                        <div className="flex min-h-52 flex-col items-center justify-center gap-2.5 text-center text-12 text-muted">
                            <Icon name="eye" size={34} className="text-placeholder" />
                            <p>
                                从左侧选择物料
                                <br />
                                在这里查看选用结果
                            </p>
                        </div>
                    ) : (
                        <>
                            <ul className="my-4">
                                {entries.map(([itemId, qty]) => {
                                    const option = nameOf.get(itemId);
                                    return (
                                        <li key={itemId} className="relative border-b border-line py-2.75 pr-6">
                                            <strong className="block text-12 font-medium text-ink">
                                                {option?.name ?? itemId} <span className="text-primary">× {qty}</span>
                                            </strong>
                                            <p className="mt-1 text-11 text-muted">
                                                {[option?.sectionName, option?.groupName].filter(Boolean).join(" / ")}
                                            </p>
                                            <button
                                                type="button"
                                                aria-label={`移除：${option?.name ?? itemId}`}
                                                onClick={() =>
                                                    setSelection(current => {
                                                        const next = new Map(current);
                                                        next.delete(itemId);
                                                        return next;
                                                    })
                                                }
                                                className="absolute top-2 right-0 inline-flex size-6 items-center justify-center rounded-md text-muted transition hover:bg-soft hover:text-ink"
                                            >
                                                <Icon name="close" size={13} />
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                            <button
                                type="button"
                                className="text-12 text-muted transition hover:text-primary-strong"
                                onClick={() => setSelection(new Map())}
                            >
                                清空选择
                            </button>
                            <div className="mt-4 flex items-center justify-between border-t border-line pt-3.5 text-12 text-muted">
                                <span>总数量</span>
                                <strong className="text-14 text-ink">{total}</strong>
                            </div>
                        </>
                    )}
                </aside>
            </div>
        </Modal>
    );
}

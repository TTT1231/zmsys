import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { ViewGroupNode, ViewRoot, ViewSectionNode } from "./structureView";
import { conflictingItemName, conflictingNodeName } from "./structureView";
import type { RowRef } from "./StructureTree";

/**
 * 「BOM 结构」行操作弹窗组（BOM结构原型.html 交互）：新增分组/分区、批量添加物料、
 * 重命名、移动位置（跨父单选树）、删除确认。校验先行（重名/长度/空值），提交经
 * 页面层落成 ops；已保存节点的删除/改名最终由服务端引用守卫兜底（400 带行数提示）。
 */

const NAME_MAX = 64; // 与 material_group/material_item 列宽一致（DB VarChar(64)）

const splitLines = (value: string): string[] =>
    value
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

/* 位置卡（原型 location-card）：分支图标 + 归属路径 */
function LocationCard({ path, description }: { path: string; description: string }) {
    return (
        <div className="mb-2 flex items-start gap-2.5 rounded-btn border border-line bg-soft/60 px-3.5 py-3 text-12 text-muted">
            <Icon name="corner" size={16} className="mt-0.5 flex-none text-primary-strong" />
            <span>
                <strong className="mb-0.5 block font-medium text-ink">{path}</strong>
                {description}
            </span>
        </div>
    );
}

const sectionPathOf = (tree: readonly ViewRoot[], sectionId: string): string => {
    const section = tree.find(root => root.kind === "section" && root.id === sectionId) as ViewSectionNode | undefined;
    return section?.name ?? "未知分区";
};

/** 物料 → 所在分组（重名校验与定位用） */
const groupOfItem = (tree: readonly ViewRoot[], itemId: string): ViewGroupNode | undefined => {
    for (const root of tree) {
        const groups = root.kind === "group" ? [root] : root.groups;
        for (const group of groups) {
            if (group.items.some(item => item.id === itemId)) {
                return group;
            }
        }
    }
    return undefined;
};

/* ---- 新增分组 / 分区 ---- */

export function AddNodeModal({
    categoryName,
    target,
    tree,
    onClose,
    onSubmit,
}: {
    categoryName: string;
    target: { type: "root" } | { type: "section"; id: string };
    tree: readonly ViewRoot[];
    onClose: () => void;
    onSubmit: (kind: "SECTION" | "GROUP", name: string, items: string[]) => void;
}) {
    const atRoot = target.type === "root";
    const [kind, setKind] = useState<"SECTION" | "GROUP">("GROUP");
    const [name, setName] = useState("");
    const [items, setItems] = useState("");
    const [error, setError] = useState("");
    const locationPath = atRoot ? categoryName : sectionPathOf(tree, target.id);
    const effectiveKind = atRoot ? kind : "GROUP";

    const submit = () => {
        const trimmed = name.trim();
        if (!trimmed) {
            setError("请输入名称");
            return;
        }
        if (trimmed.length > NAME_MAX) {
            setError(`名称最多 ${NAME_MAX} 个字符`);
            return;
        }
        if (conflictingNodeName(tree, trimmed)) {
            setError("该品类内已有同名分组或分区，请换个名称");
            return;
        }
        if (effectiveKind === "GROUP") {
            const names = splitLines(items);
            if (names.length > 200) {
                setError("随组物料最多 200 项");
                return;
            }
            if (names.some(entry => entry.length > NAME_MAX)) {
                setError(`物料名称最多 ${NAME_MAX} 个字符`);
                return;
            }
            if (new Set(names).size !== names.length) {
                setError("输入的物料名称有重复，请检查");
                return;
            }
        }
        onSubmit(effectiveKind, trimmed, splitLines(items));
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={atRoot ? "新增分组" : "添加子分组"}
            subtitle={atRoot ? "分组挂物料，分区归类分组；两者都可在保存前调整位置与规则" : undefined}
            width={480}
            footer={
                <>
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" onClick={submit}>
                        {effectiveKind === "GROUP" ? "添加分组" : "添加分区"}
                    </Button>
                </>
            }
        >
            <LocationCard path={locationPath} description={atRoot ? "直接添加到此品类" : "添加到此分组内"} />
            {atRoot && (
                <div className="mb-3 flex gap-2" role="radiogroup" aria-label="节点类型">
                    {(
                        [
                            ["GROUP", "分组（挂物料）"],
                            ["SECTION", "分区（归类分组）"],
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={kind === value}
                            onClick={() => setKind(value)}
                            className={cn(
                                "flex-1 rounded-btn border px-3 py-2 text-13 transition",
                                kind === value
                                    ? "border-primary bg-primary-soft font-medium text-primary-strong"
                                    : "border-line bg-surface text-td hover:border-primary-border",
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}
            <label className="block">
                <span className="mb-1 block text-13 font-medium text-td">
                    {effectiveKind === "GROUP" ? "分组名称" : "分区名称"}
                </span>
                <input
                    autoFocus
                    value={name}
                    maxLength={NAME_MAX}
                    placeholder={effectiveKind === "GROUP" ? "如：五金件" : "如：塑料件"}
                    onChange={event => {
                        setName(event.target.value);
                        setError("");
                    }}
                    onKeyDown={event => event.key === "Enter" && submit()}
                    className="w-full rounded-input border border-line-strong bg-surface px-3 py-2.5 text-14 text-ink outline-none focus:border-primary"
                />
            </label>
            {effectiveKind === "GROUP" && (
                <>
                    <label className="mt-3 block">
                        <span className="mb-1 block text-13 font-medium text-td">随组物料（可选）</span>
                        <textarea
                            value={items}
                            rows={3}
                            placeholder={"一行一个名称，可以一次添加多项物料"}
                            onChange={event => {
                                setItems(event.target.value);
                                setError("");
                            }}
                            className="w-full resize-y rounded-input border border-line-strong bg-surface px-3 py-2.5 text-14 text-ink outline-none focus:border-primary"
                        />
                    </label>
                </>
            )}
            {error && (
                <p role="alert" className="mt-2 text-13 text-danger">
                    {error}
                </p>
            )}
        </Modal>
    );
}

/* ---- 批量添加物料 ---- */

export function AddItemsModal({
    group,
    tree,
    onClose,
    onSubmit,
}: {
    group: { id: string; name: string };
    tree: readonly ViewRoot[];
    onClose: () => void;
    onSubmit: (items: string[]) => void;
}) {
    const [value, setValue] = useState("");
    const [error, setError] = useState("");
    const names = splitLines(value);

    const submit = () => {
        if (names.length === 0) {
            setError("请输入至少一个物料名称");
            return;
        }
        if (names.length > 200) {
            setError("单次最多添加 200 项物料");
            return;
        }
        if (names.some(name => name.length > NAME_MAX)) {
            setError(`物料名称最多 ${NAME_MAX} 个字符`);
            return;
        }
        if (new Set(names).size !== names.length) {
            setError("输入的物料名称有重复，请检查");
            return;
        }
        const repeat = names.find(name => conflictingItemName(tree, group.id, name));
        if (repeat) {
            setError(`此分组已有「${repeat}」`);
            return;
        }
        onSubmit(names);
    };

    return (
        <Modal
            open
            onClose={onClose}
            title="添加物料"
            subtitle="一行一个名称，可以一次添加多项物料。"
            width={480}
            footer={
                <>
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" onClick={submit}>
                        添加物料
                    </Button>
                </>
            }
        >
            <LocationCard path={group.name} description="添加到这个分组中" />
            <label className="block">
                <span className="mb-1 block text-13 font-medium text-td">物料名称</span>
                <textarea
                    autoFocus
                    value={value}
                    rows={4}
                    placeholder={"如：小静片\n半圆静片"}
                    onChange={event => {
                        setValue(event.target.value);
                        setError("");
                    }}
                    className="w-full resize-y rounded-input border border-line-strong bg-surface px-3 py-2.5 text-14 text-ink outline-none focus:border-primary"
                />
            </label>
            <p className="mt-1.5 text-13 text-subtle">
                {names.length > 0 ? `将添加 ${names.length} 项物料` : "支持单个添加，也支持批量添加"}
            </p>
            {error && (
                <p role="alert" className="mt-2 text-13 text-danger">
                    {error}
                </p>
            )}
        </Modal>
    );
}

/* ---- 重命名 ---- */

export function RenameModal({
    row,
    tree,
    onClose,
    onSubmit,
}: {
    row: RowRef;
    tree: readonly ViewRoot[];
    onClose: () => void;
    onSubmit: (name: string) => void;
}) {
    const [name, setName] = useState(row.name);
    const [error, setError] = useState("");
    const label = row.kind === "item" ? "物料" : row.kind === "group" ? "分组" : "分区";

    const submit = () => {
        const trimmed = name.trim();
        if (!trimmed) {
            setError("请输入名称");
            return;
        }
        if (trimmed.length > NAME_MAX) {
            setError(`名称最多 ${NAME_MAX} 个字符`);
            return;
        }
        if (trimmed === row.name) {
            onClose();
            return;
        }
        if (row.kind === "item") {
            const holder = groupOfItem(tree, row.id);
            if (holder && conflictingItemName(tree, holder.id, trimmed, row.id)) {
                setError("同一分组下已有相同名称");
                return;
            }
        } else if (conflictingNodeName(tree, trimmed, row.id)) {
            setError("该品类内已有同名分组或分区");
            return;
        }
        onSubmit(trimmed);
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={`重命名${label}`}
            width={440}
            footer={
                <>
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" onClick={submit}>
                        确定
                    </Button>
                </>
            }
        >
            <label className="block">
                <span className="mb-1 block text-13 font-medium text-td">{label}名称</span>
                <input
                    autoFocus
                    value={name}
                    maxLength={NAME_MAX}
                    onChange={event => {
                        setName(event.target.value);
                        setError("");
                    }}
                    onKeyDown={event => event.key === "Enter" && submit()}
                    onFocus={event => event.target.select()}
                    className="w-full rounded-input border border-line-strong bg-surface px-3 py-2.5 text-14 text-ink outline-none focus:border-primary"
                />
            </label>
            {row.kind !== "section" && (
                <p className="mt-2 text-13 text-subtle">已被既有 BOM 引用的物料/分组不能改名，保存时服务端会校验。</p>
            )}
            {error && (
                <p role="alert" className="mt-2 text-13 text-danger">
                    {error}
                </p>
            )}
        </Modal>
    );
}

/* ---- 移动位置（跨父单选） ---- */

interface MoveTarget {
    value: string; // 目标 id 或 "@root"
    name: string;
    path: string;
    depth: number;
    hidden: boolean;
    current: boolean;
}

export function MoveModal({
    row,
    categoryName,
    tree,
    onClose,
    onSubmit,
}: {
    row: RowRef;
    categoryName: string;
    tree: readonly ViewRoot[];
    onClose: () => void;
    onSubmit: (parentId: string | null) => void;
}) {
    const currentParentId = useMemo(() => {
        if (row.kind === "group") {
            for (const root of tree) {
                if (root.kind === "group" && root.id === row.id) {
                    return root.parentId;
                }
                if (root.kind === "section") {
                    const group = root.groups.find(entry => entry.id === row.id);
                    if (group) {
                        return group.parentId;
                    }
                }
            }
            return null;
        }
        return groupOfItem(tree, row.id)?.id ?? null;
    }, [row, tree]);
    const [chosen, setChosen] = useState<string>(currentParentId ?? "@root");

    const targets: MoveTarget[] = useMemo(() => {
        const list: MoveTarget[] = [];
        if (row.kind === "group") {
            list.push({
                value: "@root",
                name: categoryName,
                path: categoryName,
                depth: 0,
                hidden: false,
                current: currentParentId === null,
            });
            for (const root of tree) {
                if (root.kind !== "section") {
                    continue;
                }
                list.push({
                    value: root.id,
                    name: root.name,
                    path: root.name,
                    depth: 0,
                    hidden: !root.status,
                    current: currentParentId === root.id,
                });
            }
            return list;
        }
        for (const root of tree) {
            const groups: ViewGroupNode[] = root.kind === "group" ? [root] : root.groups;
            for (const group of groups) {
                const holder = root.kind === "section" ? `${root.name} / ` : "";
                list.push({
                    value: group.id,
                    name: group.name,
                    path: `${holder}${group.name}`,
                    depth: root.kind === "section" ? 1 : 0,
                    hidden: !group.status || (root.kind === "section" && !root.status),
                    current: currentParentId === group.id,
                });
            }
        }
        return list;
    }, [row.kind, tree, categoryName, currentParentId]);

    const chosenTarget = targets.find(target => target.value === chosen);
    const changed = chosen !== (currentParentId ?? "@root");

    return (
        <Modal
            open
            onClose={onClose}
            title={`移动「${row.name}」`}
            subtitle={
                row.kind === "group" ? "选择放置位置；分组会移到目标末位。" : "选择要放入的分组；物料会移到目标末位。"
            }
            width={570}
            footer={
                <>
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" disabled={!changed} onClick={() => onSubmit(chosen === "@root" ? null : chosen)}>
                        移动
                    </Button>
                </>
            }
        >
            <LocationCard
                path={
                    row.kind === "item"
                        ? (groupOfItem(tree, row.id)?.name ?? "—")
                        : currentParentId
                          ? sectionPathOf(tree, currentParentId)
                          : categoryName
                }
                description="当前位置"
            />
            <p className="mt-2 mb-1 text-13 font-medium text-td">放到哪里</p>
            <div
                className="max-h-71 overflow-y-auto rounded-btn border border-line bg-panel p-1.75"
                role="radiogroup"
                aria-label="移动目标"
            >
                {targets.map(target => (
                    <label
                        key={target.value}
                        className={cn(
                            "mb-0.5 flex min-h-10 cursor-pointer items-center gap-2.5 rounded-btn px-2.25 py-2 text-13 transition",
                            target.depth > 0 && "ml-5",
                            chosen === target.value ? "bg-primary-soft text-primary-strong" : "text-td hover:bg-soft",
                        )}
                        title={target.path}
                    >
                        <input
                            type="radio"
                            name="move-target"
                            className="size-4 accent-primary"
                            value={target.value}
                            checked={chosen === target.value}
                            onChange={() => setChosen(target.value)}
                        />
                        <Icon
                            name={row.kind === "group" && target.value === "@root" ? "layers" : "folder"}
                            size={16}
                            className="flex-none text-muted"
                        />
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{target.name}</span>
                        {target.current ? (
                            <span className="flex-none rounded-[4px] bg-soft px-1.5 py-0.5 text-11 text-muted">
                                当前位置
                            </span>
                        ) : target.hidden ? (
                            <span className="flex-none rounded-[4px] bg-soft px-1.5 py-0.5 text-11 text-muted">
                                已不可选
                            </span>
                        ) : null}
                    </label>
                ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-12 text-muted">
                <span>将放到</span>
                <strong className="font-medium text-ink">{chosenTarget?.path ?? "—"}</strong>
                {chosenTarget?.hidden && (
                    <p className="w-full text-warning">这个分组已不可选，移入的内容也会随之不可选。</p>
                )}
            </div>
        </Modal>
    );
}

/* ---- 删除确认 ---- */

export function DeleteModal({
    row,
    childCount,
    onClose,
    onSubmit,
}: {
    row: RowRef;
    childCount: number;
    onClose: () => void;
    onSubmit: () => void;
}) {
    const label = row.kind === "item" ? "物料" : row.kind === "group" ? "分组" : "分区";
    return (
        <Modal
            open
            onClose={onClose}
            title={`删除「${row.name}」？`}
            width={460}
            footer={
                <>
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" variant="danger" onClick={onSubmit}>
                        删除
                    </Button>
                </>
            }
        >
            <LocationCard path={row.name} description={`${label}${childCount > 0 ? "及其所有子项" : ""}`} />
            <p className="text-13 text-muted">
                {childCount > 0 ? `下面的 ${childCount} 个子项会一起删除。` : ""}
                {row.draft
                    ? "草稿删除后可以撤销（Ctrl+Z）；移入草稿的已保存项会回到原位置。"
                    : "已保存节点删除后不可恢复；被既有 BOM 引用时会保存失败，请改用「设为不可选」。"}
            </p>
        </Modal>
    );
}

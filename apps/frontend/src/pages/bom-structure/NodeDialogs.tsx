import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { ViewGroupNode, ViewRoot } from "./structureView";
import {
    conflictingItemName,
    conflictingNodeName,
    MAX_TREE_DEPTH,
    viewDepthOf,
    viewNodesOf,
    viewPathOf,
} from "./structureView";
import type { AddKind, AddTarget, RowRef } from "./StructureTree";

/**
 * 「BOM 结构」行操作弹窗：添加物料/分组、
 * 重命名、移动位置（跨父单选树）、删除确认。校验先行（重名/长度/空值），提交经
 * 页面层落成 ops；已保存节点的删除/改名最终由服务端引用守卫兜底（400 带行数提示）。
 */

const NAME_MAX = 64; // 与 material_group/material_item 列宽一致（DB VarChar(64)）

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
    return (
        viewPathOf(tree, sectionId)
            .map(node => node.name)
            .join(" / ") || "未知分组"
    );
};

/** 物料 → 所在分组（重名校验与定位用） */
const groupOfItem = (tree: readonly ViewRoot[], itemId: string): ViewGroupNode | undefined => {
    return viewNodesOf(tree).find(node => node.kind === "group" && node.items.some(item => item.id === itemId)) as
        | ViewGroupNode
        | undefined;
};

/* ---- 添加：默认物料，分组只填写名称 ---- */

export function AddNodeModal({
    categoryName,
    target,
    tree,
    onClose,
    onSubmit,
}: {
    categoryName: string;
    target: AddTarget;
    tree: readonly ViewRoot[];
    onClose: () => void;
    onSubmit: (kind: AddKind, name: string) => void;
}) {
    const [kind, setKind] = useState<AddKind>("material");
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const path = target.type === "root" ? [] : viewPathOf(tree, target.id);
    const locationName = path.at(-1)?.name ?? categoryName;
    const canAddGroup = path.length < MAX_TREE_DEPTH - 1;
    const material = kind === "material";

    const submit = () => {
        const trimmed = name.trim();
        if (!trimmed) {
            setError(material ? "请输入物料名称" : "请输入分组名称");
            return;
        }
        if (trimmed.length > NAME_MAX) {
            setError(`名称最多 ${NAME_MAX} 个字`);
            return;
        }
        if (path.length >= MAX_TREE_DEPTH || (!material && !canAddGroup)) {
            setError("最多添加 5 层");
            return;
        }
        const conflict =
            target.type === "group" && material
                ? conflictingItemName(tree, target.id, trimmed)
                : conflictingNodeName(tree, trimmed);
        if (conflict) {
            setError("已有这个名称，请换一个");
            return;
        }
        onSubmit(kind, trimmed);
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={material ? "添加物料" : "添加分组"}
            subtitle={`添加到：${locationName}`}
            width={440}
            footer={
                <>
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" onClick={submit}>
                        {material ? "添加物料" : "添加分组"}
                    </Button>
                </>
            }
        >
            <div className="mb-4 flex border-b border-line" role="radiogroup" aria-label="添加类型">
                {(
                    [
                        ["material", "物料"],
                        ["group", "分组"],
                    ] as const
                ).map(([value, label]) => {
                    const disabled = value === "group" && !canAddGroup;
                    return (
                        <label
                            key={value}
                            title={disabled ? "已到最深层" : undefined}
                            className={cn(
                                "flex min-h-10 flex-1 items-center justify-center border-b-2 px-3 text-14 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-primary",
                                disabled
                                    ? "cursor-not-allowed border-transparent text-placeholder"
                                    : kind === value
                                      ? "cursor-pointer border-primary font-medium text-primary-strong"
                                      : "cursor-pointer border-transparent text-muted hover:text-ink",
                            )}
                        >
                            <input
                                type="radio"
                                name="add-kind"
                                value={value}
                                checked={kind === value}
                                disabled={disabled}
                                className="sr-only"
                                onChange={() => {
                                    setKind(value);
                                    setError("");
                                }}
                            />
                            {label}
                        </label>
                    );
                })}
            </div>
            <label className="block">
                <span className="mb-1.5 block text-13 font-medium text-td">{material ? "物料名称" : "分组名称"}</span>
                <input
                    autoFocus
                    value={name}
                    maxLength={NAME_MAX}
                    placeholder={material ? "如：底座" : "如：五金件"}
                    onChange={event => {
                        setName(event.target.value);
                        setError("");
                    }}
                    onKeyDown={event => event.key === "Enter" && submit()}
                    className="w-full rounded-input border border-line-strong bg-surface px-3 py-2.5 text-14 text-ink outline-none focus:border-primary"
                />
            </label>
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
    const label = row.kind === "item" || row.materialItemId ? "物料" : "分组";

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
            setError("此品类已有同名内容");
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
            const node = viewNodesOf(tree).find(entry => entry.kind === "group" && entry.id === row.id) as
                | ViewGroupNode
                | undefined;
            return node?.parentId ?? null;
        }
        return groupOfItem(tree, row.id)?.id ?? null;
    }, [row, tree]);
    const [chosen, setChosen] = useState<string>(currentParentId ?? "@root");

    const targets: MoveTarget[] = useMemo(() => {
        const own = viewNodesOf(tree).find(node => node.id === row.id);
        const blocked = new Set(own ? viewNodesOf([own]).map(node => node.id) : []);
        const targets: MoveTarget[] =
            row.kind === "group"
                ? [
                      {
                          value: "@root",
                          name: categoryName,
                          path: categoryName,
                          depth: 0,
                          hidden: false,
                          current: currentParentId === null,
                      },
                  ]
                : [];
        for (const node of viewNodesOf(tree)) {
            if (blocked.has(node.id) || (row.kind === "item" && node.kind !== "group")) continue;
            const path = viewPathOf(tree, node.id);
            if (path.length + (own ? viewDepthOf(own) : 1) > MAX_TREE_DEPTH) continue;
            targets.push({
                value: node.id,
                name: node.name,
                path: path.map(part => part.name).join(" / "),
                depth: path.length - 1,
                hidden: path.some(part => !part.status),
                current: currentParentId === node.id,
            });
        }
        return targets;
    }, [row, tree, categoryName, currentParentId]);

    const chosenTarget = targets.find(target => target.value === chosen);
    const changed = chosen !== (currentParentId ?? "@root");

    return (
        <Modal
            open
            onClose={onClose}
            title={`移动「${row.name}」`}
            subtitle={
                row.kind === "group"
                    ? "选择放置位置，内容会移到所选位置的末尾。"
                    : "选择要放入的分组，物料会移到分组的末尾。"
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
    const label = row.kind === "item" || row.materialItemId ? "物料" : "分组";
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

/* ---- 删除品类（危险操作，二次确认：输入品类名解锁删除按钮） ---- */

export function DeleteCategoryModal({
    categoryName,
    stats,
    onClose,
    onSubmit,
}: {
    categoryName: string;
    stats: { groups: number; materials: number };
    onClose: () => void;
    onSubmit: () => void;
}) {
    const [confirmName, setConfirmName] = useState("");
    const matched = confirmName.trim() === categoryName;
    return (
        <Modal
            open
            onClose={onClose}
            title={`删除品类「${categoryName}」？`}
            width={480}
            footer={
                <>
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        取消
                    </Button>
                    <Button size="sm" variant="danger" disabled={!matched} onClick={onSubmit}>
                        确认删除
                    </Button>
                </>
            }
        >
            <div className="mb-3 flex items-start gap-2.5 rounded-btn border border-danger/30 bg-danger-soft px-3.5 py-3 text-12 text-danger">
                <Icon name="alert" size={16} className="mt-0.5 flex-none" />
                <span>
                    品类及其{" "}
                    <strong>
                        {stats.groups} 个分组 · {stats.materials} 项物料
                    </strong>
                    、全部 BOM 档案、下属类型容器与取号序列将一并删除，不可恢复。已被订单或出入库 引用的 BOM
                    会阻止删除并逐个列出。
                </span>
            </div>
            <label className="block">
                <span className="mb-1 block text-13 font-medium text-td">
                    请输入品类名称 <span className="font-semibold text-danger">{categoryName}</span> 以确认
                </span>
                <input
                    autoFocus
                    value={confirmName}
                    onChange={event => setConfirmName(event.target.value)}
                    placeholder={categoryName}
                    className="w-full rounded-input border border-line-strong bg-surface px-3 py-2.5 text-14 text-ink outline-none focus:border-danger"
                />
            </label>
        </Modal>
    );
}

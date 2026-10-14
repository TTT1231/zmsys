import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { ViewGroupNode, ViewItem, ViewRoot, ViewSectionNode } from "./structureView";

/**
 * 「BOM 结构」树编辑区（BOM结构原型.html 的最终版交互）：分区/分组/物料三级行，
 * 多选/数量两列规则开关（仅含物料的分组），行尾 上移/下移/不可选/添加/更多 操作；
 * 复合品类按分节渲染（共用结构 + 本品结构），节点可折叠（高度动画）。
 * 行为契约与页面层（BomStructurePage）通过 TreeActions 回调收口。
 */

export interface EditorSection {
    /** 分节归属品类的 key（ops 路由与保存按品类收口） */
    categoryKey: string;
    /** 分节标题（复合视图：跌倒开关类型 / 微动开关类型…）；单视图不渲染标题 */
    label: string;
    composite: boolean;
    tree: ViewRoot[];
}

export interface RowRef {
    categoryKey: string;
    kind: "section" | "group" | "item";
    id: string;
    name: string;
    draft: boolean;
}

export interface TreeActions {
    toggleCollapse(id: string): void;
    selectNode(id: string): void;
    setHidden(row: RowRef, hidden: boolean): void;
    reorder(row: RowRef, direction: "up" | "down"): void;
    setRules(categoryKey: string, groupId: string, multi: boolean, qty: boolean): void;
    /** 新增分组/分区（target：品类根 或 指定分区下） */
    openAddNode(categoryKey: string, target: { type: "root" } | { type: "section"; id: string }): void;
    openAddItems(categoryKey: string, group: { id: string; name: string }): void;
    openRename(row: RowRef): void;
    openMove(row: RowRef): void;
    openRemove(row: RowRef): void;
}

/* 折叠容器：高度动画（WAAPI，reduced-motion 直切）；hidden 卸载流以省渲染 */
function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const firstRun = useRef(true);
    useEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }
        if (firstRun.current) {
            firstRun.current = false;
            element.hidden = !open;
            return;
        }
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduced || typeof element.animate !== "function") {
            element.hidden = !open;
            return;
        }
        if (open) {
            const from = element.hidden ? 0 : element.getBoundingClientRect().height;
            element.hidden = false;
            const to = element.getBoundingClientRect().height;
            const animation = element.animate([{ height: `${from}px` }, { height: `${to}px` }], {
                duration: 180,
                easing: "cubic-bezier(0.2, 0, 0, 1)",
            });
            animation.onfinish = () => animation.cancel();
            return;
        }
        const from = element.getBoundingClientRect().height;
        const animation = element.animate([{ height: `${from}px` }, { height: "0px" }], {
            duration: 180,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
        });
        animation.onfinish = () => {
            element.hidden = true;
            animation.cancel();
        };
    }, [open]);
    return (
        <div ref={ref} className={cn("overflow-hidden", className)}>
            {children}
        </div>
    );
}

/* 图标按钮 + Radix 提示（BOM 结构树行尾操作统一外观）。
   rest 原样透传：DropdownMenuTrigger asChild 依赖它注入 ref 与指针事件 */
function IconButton({
    icon,
    label,
    tip,
    className,
    disabled,
    ...rest
}: {
    icon: string;
    label: string;
    tip?: string;
    className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
    const button = (
        <button
            type="button"
            data-action
            aria-label={label}
            className={cn(
                "inline-flex size-8 flex-none items-center justify-center rounded-md text-muted transition",
                "hover:bg-primary-soft hover:text-primary-strong",
                "disabled:cursor-not-allowed disabled:text-placeholder disabled:hover:bg-transparent disabled:hover:text-placeholder",
                className,
            )}
            {...rest}
        >
            <Icon name={icon} size={15} />
        </button>
    );
    if (!tip || disabled) {
        return button;
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{tip}</TooltipContent>
        </Tooltip>
    );
}

function Chip({ tone, children }: { tone: "muted" | "primary" | "warning"; children: ReactNode }) {
    return (
        <span
            className={cn(
                "flex-none rounded-[5px] px-1.5 py-px text-11 leading-4.5 whitespace-nowrap",
                tone === "muted" && "bg-soft text-muted",
                tone === "primary" && "bg-primary-soft text-primary-strong",
                tone === "warning" && "bg-warning-soft text-warning",
            )}
        >
            {children}
        </span>
    );
}

const ruleCellDash = (
    <span className="bs-rule flex items-center justify-center text-placeholder" aria-hidden>
        —
    </span>
);

function RuleChecks({
    group,
    disabled,
    onChange,
}: {
    group: ViewGroupNode;
    disabled: boolean;
    onChange: (multi: boolean, qty: boolean) => void;
}) {
    return (
        <>
            <span className="bs-rule flex items-center justify-center">
                <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={group.multi}
                    disabled={disabled}
                    aria-label={`${group.name} · 多选`}
                    onChange={event => onChange(event.target.checked, group.qty)}
                />
            </span>
            <span className="bs-rule flex items-center justify-center">
                <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={group.qty}
                    disabled={disabled}
                    aria-label={`${group.name} · 数量`}
                    onChange={event => onChange(group.multi, event.target.checked)}
                />
            </span>
        </>
    );
}

/* 树本体：分区 → 分组 → 物料 递归渲染 */
export function StructureTree({
    sections,
    collapsed,
    selectedId,
    actions,
    headerExtra,
}: {
    sections: EditorSection[];
    collapsed: ReadonlySet<string>;
    selectedId: string | null;
    actions: TreeActions;
    headerExtra?: ReactNode;
}) {
    return (
        <TooltipProvider delayDuration={250}>
            <div className="bs-tree min-h-0 flex-1 overflow-y-auto" data-tree-root>
                {headerExtra}
                {sections.map(section => (
                    <StructureSection
                        key={section.categoryKey}
                        section={section}
                        collapsed={collapsed}
                        selectedId={selectedId}
                        actions={actions}
                    />
                ))}
            </div>
        </TooltipProvider>
    );
}

function StructureSection({
    section,
    collapsed,
    selectedId,
    actions,
}: {
    section: EditorSection;
    collapsed: ReadonlySet<string>;
    selectedId: string | null;
    actions: TreeActions;
}) {
    const { tree } = section;
    return (
        <section className="min-w-0" data-structure-category={section.categoryKey}>
            {section.composite && (
                <div className="flex min-h-9 items-center justify-between gap-3 px-3">
                    <h3 className="text-13 font-semibold text-primary-strong">{section.label}</h3>
                    <button
                        type="button"
                        onClick={() => actions.openAddNode(section.categoryKey, { type: "root" })}
                        className="flex items-center gap-1 text-12 text-muted transition hover:text-primary-strong"
                    >
                        <Icon name="plus" size={14} />
                        新增分组
                    </button>
                </div>
            )}
            {tree.length === 0 ? (
                <div className="flex min-h-26 flex-col items-center justify-center gap-2 px-4 py-4 text-13 text-muted">
                    <strong className="font-normal">还没有分组</strong>
                    {section.composite ? null : <p className="text-12">先新建一个分组，再添加物料或子分组</p>}
                </div>
            ) : (
                <ul className="min-w-0" aria-label={`${section.label}的分组与物料`}>
                    {tree.map((root, index) => (
                        <li key={root.id} className="min-w-0">
                            {root.kind === "section" ? (
                                <SectionBranch
                                    section={root}
                                    categoryKey={section.categoryKey}
                                    first={index === 0}
                                    last={index === tree.length - 1}
                                    collapsed={collapsed}
                                    selectedId={selectedId}
                                    actions={actions}
                                />
                            ) : (
                                <GroupBranch
                                    group={root}
                                    ancestorHidden={false}
                                    categoryKey={section.categoryKey}
                                    first={index === 0}
                                    last={index === tree.length - 1}
                                    collapsed={collapsed}
                                    selectedId={selectedId}
                                    actions={actions}
                                />
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/* 分区行：折叠开关 + 文件夹图标 + 名称；规则列为 —；操作=上移/下移/不可选/添加分组/更多 */
function SectionBranch({
    section,
    categoryKey,
    first,
    last,
    collapsed,
    selectedId,
    actions,
}: {
    section: ViewSectionNode;
    categoryKey: string;
    first: boolean;
    last: boolean;
    collapsed: ReadonlySet<string>;
    selectedId: string | null;
    actions: TreeActions;
}) {
    const expanded = !collapsed.has(section.id);
    const hidden = !section.status;
    const row: RowRef = {
        categoryKey,
        kind: "section",
        id: section.id,
        name: section.name,
        draft: section.draft === true,
    };
    return (
        <>
            <div className="bs-cols node-row min-h-11 py-0.5" data-node-row={section.id}>
                <EntryButton
                    indent={0}
                    chevron
                    expanded={expanded}
                    icon={<Icon name={expanded ? "folder-open" : "folder"} size={16} />}
                    name={section.name}
                    muted={hidden}
                    selected={selectedId === section.id}
                    chips={
                        <>
                            {section.draft && <Chip tone="primary">新增</Chip>}
                            {hidden && <Chip tone="muted">不可选</Chip>}
                        </>
                    }
                    onActivate={() => {
                        actions.toggleCollapse(section.id);
                        actions.selectNode(section.id);
                    }}
                    onChevronKey={() => actions.toggleCollapse(section.id)}
                />
                {ruleCellDash}
                {ruleCellDash}
                <RowActions
                    row={row}
                    first={first}
                    last={last}
                    ownHidden={hidden}
                    actions={actions}
                    addLabel="添加分组"
                    onAdd={() => actions.openAddNode(categoryKey, { type: "section", id: section.id })}
                    canMove={false}
                />
            </div>
            <Collapse open={expanded} className="relative">
                <span aria-hidden className="absolute top-0 bottom-5 left-[20px] w-px bg-line-strong" />
                <ul className="min-w-0 pl-0">
                    {section.groups.map((group, index) => (
                        <li key={group.id} className="min-w-0">
                            <GroupBranch
                                group={group}
                                ancestorHidden={hidden}
                                categoryKey={categoryKey}
                                first={index === 0}
                                last={index === section.groups.length - 1}
                                collapsed={collapsed}
                                selectedId={selectedId}
                                actions={actions}
                            />
                        </li>
                    ))}
                    {section.groups.length === 0 && (
                        <li className="py-1 pr-2 pb-2.5 text-12 text-muted" style={{ paddingLeft: "calc(45px)" }}>
                            这里还没有内容 ·{" "}
                            <button
                                type="button"
                                className="text-primary-strong hover:underline"
                                onClick={() => actions.openAddNode(categoryKey, { type: "section", id: section.id })}
                            >
                                添加分组
                            </button>
                        </li>
                    )}
                </ul>
            </Collapse>
        </>
    );
}

/* 分组行（根分组或分区内分组）：规则两列（含物料时）；操作含 添加物料/移动 */
function GroupBranch({
    group,
    ancestorHidden,
    categoryKey,
    first,
    last,
    collapsed,
    selectedId,
    actions,
}: {
    group: ViewGroupNode;
    ancestorHidden: boolean;
    categoryKey: string;
    first: boolean;
    last: boolean;
    collapsed: ReadonlySet<string>;
    selectedId: string | null;
    actions: TreeActions;
}) {
    const expanded = !collapsed.has(group.id);
    const ownHidden = !group.status;
    const hidden = ancestorHidden || ownHidden;
    const row: RowRef = { categoryKey, kind: "group", id: group.id, name: group.name, draft: group.draft === true };
    return (
        <>
            <div
                className={cn("bs-cols node-row min-h-11 py-0.5", group.items.length === 0 && "font-medium")}
                data-node-row={group.id}
            >
                <EntryButton
                    indent={0}
                    chevron
                    expanded={expanded}
                    icon={<Icon name={expanded ? "folder-open" : "folder"} size={16} />}
                    name={group.name}
                    muted={hidden}
                    selected={selectedId === group.id}
                    chips={
                        <>
                            {group.draft && <Chip tone="primary">新增</Chip>}
                            {hidden && <Chip tone="muted">不可选</Chip>}
                        </>
                    }
                    onActivate={() => {
                        actions.toggleCollapse(group.id);
                        actions.selectNode(group.id);
                    }}
                    onChevronKey={() => actions.toggleCollapse(group.id)}
                />
                {group.items.length > 0 ? (
                    <RuleChecks
                        group={group}
                        disabled={hidden}
                        onChange={(multi, qty) => actions.setRules(categoryKey, group.id, multi, qty)}
                    />
                ) : (
                    <>
                        {ruleCellDash}
                        {ruleCellDash}
                    </>
                )}
                <RowActions
                    row={row}
                    first={first}
                    last={last}
                    ownHidden={ownHidden}
                    actions={actions}
                    addLabel="添加物料"
                    onAdd={() => actions.openAddItems(categoryKey, { id: group.id, name: group.name })}
                    canMove
                />
            </div>
            <Collapse open={expanded} className="relative">
                <span aria-hidden className="absolute top-0 bottom-5 left-[20px] w-px bg-line-strong" />
                <ul className="min-w-0">
                    {group.items.map((item, index) => (
                        <li key={item.id} className="min-w-0">
                            <ItemRow
                                item={item}
                                ancestorHidden={hidden}
                                categoryKey={categoryKey}
                                first={index === 0}
                                last={index === group.items.length - 1}
                                selectedId={selectedId}
                                actions={actions}
                            />
                        </li>
                    ))}
                    {group.items.length === 0 && (
                        <li className="py-1 pr-2 pb-2.5 text-12 text-muted" style={{ paddingLeft: "45px" }}>
                            这里还没有内容 ·{" "}
                            <button
                                type="button"
                                className="text-primary-strong hover:underline"
                                onClick={() => actions.openAddItems(categoryKey, { id: group.id, name: group.name })}
                            >
                                添加物料
                            </button>
                        </li>
                    )}
                </ul>
            </Collapse>
        </>
    );
}

/* 物料行：不可选时禁用选择；操作含 移动/重命名/删除 */
function ItemRow({
    item,
    ancestorHidden,
    categoryKey,
    first,
    last,
    selectedId,
    actions,
}: {
    item: ViewItem;
    ancestorHidden: boolean;
    categoryKey: string;
    first: boolean;
    last: boolean;
    selectedId: string | null;
    actions: TreeActions;
}) {
    const ownHidden = !item.status;
    const hidden = ancestorHidden || ownHidden;
    const row: RowRef = { categoryKey, kind: "item", id: item.id, name: item.name, draft: item.draft === true };
    return (
        <div className="bs-cols node-row min-h-11 py-0.5" data-node-row={item.id}>
            <EntryButton
                indent={1}
                icon={<Icon name="box" size={16} />}
                name={item.name}
                muted={hidden}
                selected={selectedId === item.id}
                disabled={hidden}
                chips={
                    <>
                        {item.draft && <Chip tone="primary">新增</Chip>}
                        {hidden && <Chip tone="muted">不可选</Chip>}
                    </>
                }
                onActivate={() => actions.selectNode(item.id)}
            />
            {ruleCellDash}
            {ruleCellDash}
            <RowActions row={row} first={first} last={last} ownHidden={ownHidden} actions={actions} canMove />
        </div>
    );
}

/* 名称单元格整行按钮：缩进 + 折叠箭头/占位 + 图标 + 名称 + 角标 */
function EntryButton({
    indent,
    chevron,
    expanded,
    icon,
    name,
    muted,
    selected,
    disabled,
    chips,
    onActivate,
    onChevronKey,
}: {
    indent: number;
    chevron?: boolean;
    expanded?: boolean;
    icon: ReactNode;
    name: string;
    muted: boolean;
    selected: boolean;
    disabled?: boolean;
    chips: ReactNode;
    onActivate: () => void;
    onChevronKey?: (direction: "left" | "right") => void;
}) {
    return (
        <button
            type="button"
            data-entry
            title={name}
            aria-label={name}
            aria-expanded={chevron === true ? expanded === true : undefined}
            aria-pressed={chevron === true ? undefined : selected}
            disabled={disabled}
            onClick={onActivate}
            onKeyDown={event => {
                if (chevron && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                    event.preventDefault();
                    onChevronKey?.(event.key === "ArrowLeft" ? "left" : "right");
                }
            }}
            className={cn(
                "flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-14 transition",
                "min-h-10 text-td hover:bg-soft",
                chevron !== true && selected && "bg-primary-soft font-semibold text-primary-strong",
                muted && "text-muted",
            )}
            style={{ paddingLeft: `calc(12px + var(--bs-step) * ${indent})` }}
        >
            {indent > 0 && (
                <span
                    aria-hidden
                    className="pointer-events-none relative hidden h-px w-[calc(var(--bs-step)-10px)] flex-none self-center bg-line-strong sm:block"
                />
            )}
            {chevron === true ? (
                <span
                    aria-hidden
                    className={cn(
                        "flex size-4 flex-none items-center justify-center text-muted transition-transform",
                        !expanded && "-rotate-90",
                    )}
                >
                    <Icon name="chevron-down" size={15} />
                </span>
            ) : (
                <span aria-hidden className="w-4 flex-none" />
            )}
            <span className="flex-none text-muted">{icon}</span>
            <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate">{name}</span>
                {chips}
            </span>
        </button>
    );
}

/* 行尾操作：上移/下移/不可选切换/添加/更多（重命名·移动·删除） */
function RowActions({
    row,
    first,
    last,
    ownHidden,
    actions,
    addLabel,
    onAdd,
    canMove,
}: {
    row: RowRef;
    first: boolean;
    last: boolean;
    ownHidden: boolean;
    actions: TreeActions;
    addLabel?: string;
    onAdd?: () => void;
    canMove: boolean;
}) {
    return (
        <span className="flex min-w-0 items-center justify-end gap-0.5">
            <IconButton
                icon="chevron-up"
                label={`上移：${row.name}`}
                tip="上移"
                disabled={first}
                onClick={() => actions.reorder(row, "up")}
                className="bs-move"
            />
            <IconButton
                icon="chevron-down"
                label={`下移：${row.name}`}
                tip="下移"
                disabled={last}
                onClick={() => actions.reorder(row, "down")}
                className="bs-move"
            />
            <IconButton
                icon={ownHidden ? "eye-off" : "eye"}
                label={`${ownHidden ? "恢复可选" : "设为不可选"}：${row.name}`}
                tip={ownHidden ? "恢复可选" : "设为不可选"}
                onClick={() => actions.setHidden(row, !ownHidden)}
                className={ownHidden ? "text-warning" : undefined}
            />
            {onAdd && (
                <IconButton
                    icon="plus"
                    label={`${addLabel}：${row.name}`}
                    tip={addLabel}
                    onClick={onAdd}
                    className="text-primary-strong"
                />
            )}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <IconButton icon="more-v" label={`更多操作：${row.name}`} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => actions.openRename(row)}>
                        <Icon name="edit" size={16} />
                        重命名
                    </DropdownMenuItem>
                    {canMove && (
                        <DropdownMenuItem onSelect={() => actions.openMove(row)}>
                            <Icon name="move" size={16} />
                            移动位置
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-danger" onSelect={() => actions.openRemove(row)}>
                        <Icon name="trash" size={16} />
                        删除
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </span>
    );
}

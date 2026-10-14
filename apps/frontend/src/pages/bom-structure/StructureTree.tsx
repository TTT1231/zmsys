import {
    useRef,
    useState,
    type ButtonHTMLAttributes,
    type KeyboardEvent,
    type MouseEvent,
    type ReactNode,
} from "react";
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
import { MAX_TREE_DEPTH, standaloneItemOf, viewChildrenOf, type ViewGroupNode, type ViewRoot } from "./structureView";

export interface EditorSection {
    categoryKey: string;
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
    /** 同名的单物料分组在编辑器中合为一行，操作仍保留完整目录归属。 */
    materialItemId?: string;
}

export type AddKind = "material" | "group";
export type AddTarget = { type: "root" } | { type: "section" | "group"; id: string };

export interface TreeActions {
    toggleCollapse(id: string): void;
    selectNode(id: string): void;
    setHidden(row: RowRef, hidden: boolean): void;
    reorder(row: RowRef, direction: "up" | "down"): void;
    setRules(categoryKey: string, groupId: string, multi: boolean, qty: boolean): void;
    openAddNode(categoryKey: string, target: AddTarget): void;
    openRename(row: RowRef): void;
    openMove(row: RowRef): void;
    openRemove(row: RowRef): void;
}

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
} & ButtonHTMLAttributes<HTMLButtonElement>) {
    const button = (
        <button
            type="button"
            data-action
            aria-label={label}
            disabled={disabled}
            className={cn(
                "bs-icon-button inline-flex size-8 flex-none items-center justify-center rounded-md text-muted transition-colors",
                "hover:bg-primary-soft hover:text-primary-strong disabled:cursor-not-allowed disabled:opacity-35",
                className,
            )}
            {...rest}
        >
            <Icon name={icon} size={15} />
        </button>
    );
    return tip && !disabled ? (
        <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{tip}</TooltipContent>
        </Tooltip>
    ) : (
        button
    );
}

interface TreeNode {
    row: RowRef;
    children: TreeNode[];
    folder: boolean;
    hidden: boolean;
    ownHidden: boolean;
    group?: ViewGroupNode;
    first?: boolean;
    last?: boolean;
}

interface NodeMenuTarget {
    node: TreeNode;
    depth: number;
    first: boolean;
    last: boolean;
}

type OpenNodeMenu = (target: NodeMenuTarget, event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => void;

function nodesOf(tree: ViewRoot[], categoryKey: string): TreeNode[] {
    const groupNode = (group: ViewGroupNode, ancestorHidden: boolean): TreeNode => {
        const material = standaloneItemOf(group);
        const ownHidden = !group.status || (material !== undefined && !material.status);
        const hidden = ancestorHidden || ownHidden;
        return {
            row: {
                categoryKey,
                kind: "group",
                id: group.id,
                name: group.name,
                draft: group.draft === true,
                ...(material ? { materialItemId: material.id } : {}),
            },
            group,
            folder: material === undefined,
            ownHidden,
            hidden,
            children: material
                ? []
                : [
                      ...group.items.map((item, index) => ({
                          row: {
                              categoryKey,
                              kind: "item" as const,
                              id: item.id,
                              name: item.name,
                              draft: item.draft === true,
                          },
                          folder: false,
                          children: [],
                          ownHidden: !item.status,
                          hidden: hidden || !item.status,
                          first: index === 0,
                          last: index === group.items.length - 1,
                      })),
                      ...viewChildrenOf(group).map((child, index, siblings) => ({
                          ...groupNode(child, hidden),
                          first: index === 0,
                          last: index === siblings.length - 1,
                      })),
                  ],
        };
    };
    return tree.map(root =>
        root.kind === "group"
            ? groupNode(root, false)
            : {
                  row: { categoryKey, kind: "section", id: root.id, name: root.name, draft: root.draft === true },
                  folder: true,
                  hidden: !root.status,
                  ownHidden: !root.status,
                  children: root.groups.map(group => groupNode(group, !root.status)),
              },
    );
}

const ruleDash = <span className="bs-rule text-placeholder" aria-hidden />;

function RuleChecks({ node, actions }: { node: TreeNode; actions: TreeActions }) {
    const { group, row, hidden } = node;
    if (!group || group.items.length === 0)
        return (
            <>
                {ruleDash}
                {ruleDash}
            </>
        );
    return (
        <>
            <span className="bs-rule">
                {!row.materialItemId && (
                    <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={group.multi}
                        disabled={hidden}
                        aria-label={`${group.name} · 多选`}
                        onChange={event => actions.setRules(row.categoryKey, group.id, event.target.checked, group.qty)}
                    />
                )}
            </span>
            <span className="bs-rule">
                <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={group.qty}
                    disabled={hidden}
                    aria-label={`${group.name} · 数量`}
                    onChange={event => actions.setRules(row.categoryKey, group.id, group.multi, event.target.checked)}
                />
            </span>
        </>
    );
}

export function StructureTree({
    sections,
    collapsed,
    selectedId,
    actions,
}: {
    sections: EditorSection[];
    collapsed: ReadonlySet<string>;
    selectedId: string | null;
    actions: TreeActions;
}) {
    const [menu, setMenu] = useState<(NodeMenuTarget & { x: number; y: number }) | null>(null);
    const returnFocus = useRef<HTMLElement | null>(null);
    const openMenu: OpenNodeMenu = (target, event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
        const entry = event.currentTarget.querySelector<HTMLElement>("[data-entry]") ?? event.currentTarget;
        returnFocus.current = entry;
        const rect = entry.getBoundingClientRect();
        const pointer = "clientX" in event && (event.clientX !== 0 || event.clientY !== 0);
        actions.selectNode(target.node.row.id);
        setMenu({ ...target, x: pointer ? event.clientX : rect.left + 16, y: pointer ? event.clientY : rect.bottom });
    };
    return (
        <TooltipProvider delayDuration={250}>
            <div className="bs-tree min-h-0 flex-1 overflow-y-auto" data-tree-root>
                {sections.map(section => (
                    <section
                        key={section.categoryKey}
                        className="min-w-0"
                        data-structure-category={section.categoryKey}
                    >
                        {section.composite && (
                            <div className="flex min-h-10 items-center justify-between gap-3 px-2">
                                <h3 className="text-13 font-semibold text-primary-strong">{section.label}</h3>
                                <IconButton
                                    icon="plus"
                                    label={`添加内容：${section.label}`}
                                    tip="添加物料或分组"
                                    onClick={() => actions.openAddNode(section.categoryKey, { type: "root" })}
                                />
                            </div>
                        )}
                        {section.tree.length === 0 ? (
                            <div className="flex min-h-32 items-center justify-center px-4 py-6 text-13 text-muted">
                                暂无内容
                            </div>
                        ) : (
                            <ul role="tree" aria-label={`${section.label}的分组与物料`}>
                                {nodesOf(section.tree, section.categoryKey).map((node, index, nodes) => (
                                    <NodeBranch
                                        key={node.row.id}
                                        node={node}
                                        depth={0}
                                        ancestorLines={[]}
                                        first={index === 0}
                                        last={index === nodes.length - 1}
                                        collapsed={collapsed}
                                        selectedId={selectedId}
                                        actions={actions}
                                        openMenu={openMenu}
                                    />
                                ))}
                            </ul>
                        )}
                    </section>
                ))}
                <DropdownMenu
                    modal={false}
                    open={menu !== null}
                    onOpenChange={open => {
                        if (!open) setMenu(null);
                    }}
                >
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            tabIndex={-1}
                            aria-hidden
                            className="pointer-events-none fixed size-px opacity-0"
                            style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
                        />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="start"
                        sideOffset={0}
                        className="data-[state=open]:animate-none"
                        onPointerDownOutside={event => {
                            // 连续右键换行时菜单保持挂载，由紧随其后的 contextmenu 重新定位，
                            // 避免每次右键都经历卸载/挂载（回焦 + 入场动画）造成的迟滞感
                            const pointer = event.detail.originalEvent;
                            if (
                                pointer.button === 2 &&
                                pointer.target instanceof Element &&
                                pointer.target.closest("[data-node-row]")
                            ) {
                                event.preventDefault();
                            }
                        }}
                        onKeyDown={event => event.stopPropagation()}
                        onInteractOutside={() => {
                            returnFocus.current = null;
                        }}
                        onCloseAutoFocus={event => {
                            event.preventDefault();
                            // 连续右键已打开另一个菜单时，不让旧菜单的延迟回焦打断它。
                            if (!document.querySelector('[role="dialog"], [role="menu"]')) returnFocus.current?.focus();
                        }}
                    >
                        {menu && <NodeMenuItems {...menu} actions={actions} />}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </TooltipProvider>
    );
}

function NodeBranch({
    node,
    depth,
    ancestorLines,
    first,
    last,
    collapsed,
    selectedId,
    actions,
    openMenu,
}: {
    node: TreeNode;
    depth: number;
    ancestorLines: boolean[];
    first: boolean;
    last: boolean;
    collapsed: ReadonlySet<string>;
    selectedId: string | null;
    actions: TreeActions;
    openMenu: OpenNodeMenu;
}) {
    const { row, folder } = node;
    const expanded = !collapsed.has(row.id);
    const selected = selectedId === row.id;
    const menuTarget = { node, depth, first: node.first ?? first, last: node.last ?? last };
    const openAdd = () =>
        actions.openAddNode(row.categoryKey, { type: row.kind === "section" ? "section" : "group", id: row.id });
    return (
        <li
            role="treeitem"
            aria-expanded={folder ? expanded : undefined}
            aria-selected={selected}
            aria-label={row.name}
        >
            <div
                className="bs-cols node-row rounded-md"
                data-selected={selected || undefined}
                onClick={() => actions.selectNode(row.id)}
                data-node-row={row.id}
                data-depth={depth}
                onContextMenu={event => openMenu(menuTarget, event)}
                onKeyDown={event => {
                    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
                        openMenu(menuTarget, event);
                }}
            >
                <div className="bs-entry-cell flex min-w-0 items-stretch pl-2">
                    {ancestorLines.map((continuous, index) => (
                        <span key={index} aria-hidden className={cn("bs-indent", continuous && "bs-indent-through")} />
                    ))}
                    {depth > 0 && (
                        <span aria-hidden className={cn("bs-indent bs-indent-branch", last && "bs-indent-last")} />
                    )}
                    {folder ? (
                        <button
                            type="button"
                            className="bs-switcher my-auto flex size-6 flex-none items-center justify-center rounded-md text-muted hover:bg-primary-soft hover:text-primary-strong"
                            aria-label={`${expanded ? "收起" : "展开"}：${row.name}`}
                            aria-expanded={expanded}
                            onClick={() => actions.toggleCollapse(row.id)}
                        >
                            <Icon name={expanded ? "chevron-down" : "chevron-right"} size={13} />
                        </button>
                    ) : (
                        <span aria-hidden className="w-6 flex-none" />
                    )}
                    <button
                        type="button"
                        data-entry
                        title={row.name}
                        aria-label={row.name}
                        aria-pressed={selected}
                        onFocus={() => actions.selectNode(row.id)}
                        onClick={() => actions.selectNode(row.id)}
                        onKeyDown={event => {
                            if (folder && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                                event.preventDefault();
                                if ((event.key === "ArrowRight") !== expanded) actions.toggleCollapse(row.id);
                            }
                        }}
                        className={cn(
                            "bs-entry flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2 text-left text-13 transition-colors",
                            folder ? "font-medium text-ink" : "text-td",
                            selected && "text-primary-strong",
                            node.hidden && "text-muted",
                        )}
                    >
                        <Icon
                            name={folder ? (expanded ? "folder-open" : "folder") : "box"}
                            size={16}
                            className={cn("flex-none", folder ? "text-muted" : "text-subtle")}
                        />
                        <span className="min-w-0 truncate">{row.name}</span>
                        {row.draft && (
                            <span className="flex-none rounded-md bg-primary-soft px-1 text-11 text-primary-strong">
                                新增
                            </span>
                        )}
                        {node.hidden && (
                            <span className="flex-none rounded-md bg-soft px-1 text-11 text-muted">不可选</span>
                        )}
                    </button>
                </div>
                <RuleChecks node={node} actions={actions} />
                {folder ? (
                    <RowActions {...menuTarget} actions={actions}>
                        <IconButton
                            icon="plus"
                            label={`添加内容：${row.name}`}
                            tip={depth >= MAX_TREE_DEPTH - 1 ? "最多添加 5 层" : "添加物料或分组"}
                            disabled={depth >= MAX_TREE_DEPTH - 1}
                            onClick={openAdd}
                            className="bs-add text-primary-strong"
                        />
                    </RowActions>
                ) : (
                    // 物料行不设行内按钮，全部操作走右键菜单；空占位保持操作列对齐
                    <span aria-hidden />
                )}
            </div>
            {folder && (
                <ul role="group" hidden={!expanded}>
                    {node.children.map((child, index) => (
                        <NodeBranch
                            key={child.row.id}
                            node={child}
                            depth={depth + 1}
                            ancestorLines={depth === 0 ? [] : [...ancestorLines, !last]}
                            first={index === 0}
                            last={index === node.children.length - 1}
                            collapsed={collapsed}
                            selectedId={selectedId}
                            actions={actions}
                            openMenu={openMenu}
                        />
                    ))}
                    {node.children.length === 0 && (
                        <li
                            className="bs-empty-branch py-1.5 text-12 text-muted"
                            style={{ paddingLeft: `calc(32px + var(--bs-step) * ${depth + 1})` }}
                        >
                            暂无内容
                        </li>
                    )}
                </ul>
            )}
        </li>
    );
}

function RowActions({
    node,
    first,
    last,
    depth,
    actions,
    children,
}: {
    node: TreeNode;
    first: boolean;
    last: boolean;
    depth: number;
    actions: TreeActions;
    children: ReactNode;
}) {
    const { row, ownHidden } = node;
    return (
        <span className="flex min-w-0 items-center justify-end gap-0.5 pr-1">
            <IconButton
                icon="arrow-up"
                label={`上移：${row.name}`}
                tip="上移"
                disabled={first}
                onClick={() => actions.reorder(row, "up")}
                className="bs-move"
            />
            <IconButton
                icon="arrow-down"
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
                className="bs-visibility"
            />
            {children}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <IconButton icon="more-v" label={`更多操作：${row.name}`} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onKeyDown={event => event.stopPropagation()}>
                    <NodeMenuItems node={node} depth={depth} first={first} last={last} actions={actions} />
                </DropdownMenuContent>
            </DropdownMenu>
        </span>
    );
}

/** 右键与「更多」共用动作，按画面上的分组/物料身份显示入口。 */
function NodeMenuItems({ node, first, last, depth, actions }: NodeMenuTarget & { actions: TreeActions }) {
    const { row, ownHidden } = node;
    return (
        <>
            {node.folder && (
                <>
                    <DropdownMenuItem
                        disabled={depth >= MAX_TREE_DEPTH - 1}
                        onSelect={() =>
                            actions.openAddNode(row.categoryKey, {
                                type: row.kind === "section" ? "section" : "group",
                                id: row.id,
                            })
                        }
                    >
                        <Icon name="plus" size={16} />
                        添加物料
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                </>
            )}
            <DropdownMenuItem disabled={first} onSelect={() => actions.reorder(row, "up")}>
                <Icon name="arrow-up" size={16} />
                上移
            </DropdownMenuItem>
            <DropdownMenuItem disabled={last} onSelect={() => actions.reorder(row, "down")}>
                <Icon name="arrow-down" size={16} />
                下移
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.openRename(row)}>
                <Icon name="edit" size={16} />
                重命名
            </DropdownMenuItem>
            <DropdownMenuItem disabled={row.kind === "section"} onSelect={() => actions.openMove(row)}>
                <Icon name="move" size={16} />
                移动位置
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.setHidden(row, !ownHidden)}>
                <Icon name={ownHidden ? "eye-off" : "eye"} size={16} />
                {ownHidden ? "恢复可选" : "设置为不可选"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-danger" onSelect={() => actions.openRemove(row)}>
                <Icon name="trash" size={16} />
                删除
            </DropdownMenuItem>
        </>
    );
}

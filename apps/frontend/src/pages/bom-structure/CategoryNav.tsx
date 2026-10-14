import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { BomCategory } from "@/api";
import { Icon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CategoryNav({
    roots,
    childrenOf,
    selectedKey,
    expanded,
    onToggle,
    onPick,
    onCreate,
    onDelete,
}: {
    roots: BomCategory[];
    childrenOf: Map<string, BomCategory[]>;
    selectedKey: string;
    expanded: ReadonlySet<string>;
    onToggle: (key: string) => void;
    onPick: (key: string) => void;
    onCreate: () => void;
    onDelete: (category: BomCategory) => void;
}) {
    const [menu, setMenu] = useState<{ category: BomCategory; x: number; y: number } | null>(null);
    const returnFocus = useRef<HTMLElement | null>(null);
    const showMenu = (category: BomCategory, event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
        event.preventDefault();
        const button = event.currentTarget.querySelector("button") ?? event.currentTarget;
        returnFocus.current = button;
        const rect = button.getBoundingClientRect();
        const pointer = "clientX" in event && (event.clientX !== 0 || event.clientY !== 0);
        setMenu({ category, x: pointer ? event.clientX : rect.left + 16, y: pointer ? event.clientY : rect.bottom });
    };
    const menuKeys = (category: BomCategory, event: KeyboardEvent<HTMLElement>) => {
        if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") showMenu(category, event);
    };
    const itemClass = (active: boolean) =>
        cn(
            "bs-category-button flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-13 transition-colors",
            active ? "bg-primary-soft font-semibold text-primary-strong" : "text-td hover:bg-soft",
        );
    return (
        <aside
            className="bs-category-panel flex min-h-0 flex-col rounded-card border border-line bg-surface p-2.5 max-lg:max-h-44"
            aria-label="品类导航"
        >
            <div className="mb-2 flex min-h-8 items-center justify-between gap-2 px-1">
                <h2 className="text-13 font-semibold text-ink">品类</h2>
                <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-12 text-muted hover:bg-soft hover:text-primary-strong"
                    onClick={onCreate}
                >
                    <Icon name="plus" size={14} />
                    新建品类
                </button>
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="选择品类">
                {roots.map(root => {
                    const children = childrenOf.get(root.key) ?? [];
                    const open = expanded.has(root.key);
                    const inPath = children.some(child => child.key === selectedKey);
                    return (
                        <div key={root.key} className="mb-1">
                            <div
                                data-category-item
                                onContextMenu={event => showMenu(root, event)}
                                onKeyDown={event => menuKeys(root, event)}
                            >
                                <button
                                    type="button"
                                    onClick={() => (children.length > 0 ? onToggle(root.key) : onPick(root.key))}
                                    aria-current={root.key === selectedKey ? "page" : undefined}
                                    aria-expanded={children.length > 0 ? open : undefined}
                                    className={cn(
                                        itemClass(root.key === selectedKey),
                                        inPath && "font-medium text-ink",
                                    )}
                                >
                                    <Icon name="layers" size={16} className="flex-none text-muted" />
                                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{root.name}</span>
                                    {children.length > 0 && (
                                        <Icon
                                            name={open ? "chevron-down" : "chevron-right"}
                                            size={14}
                                            className="flex-none text-muted"
                                        />
                                    )}
                                </button>
                            </div>
                            {open && children.length > 0 && (
                                <div className="ml-4 border-l border-line-strong pl-2">
                                    {children.map(child => (
                                        <div
                                            key={child.key}
                                            data-category-item
                                            onContextMenu={event => showMenu(child, event)}
                                            onKeyDown={event => menuKeys(child, event)}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => onPick(child.key)}
                                                aria-current={child.key === selectedKey ? "page" : undefined}
                                                className={itemClass(child.key === selectedKey)}
                                            >
                                                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                                                    {child.name}
                                                </span>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>
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
                        // 连续右键换品类时菜单保持挂载，由紧随其后的 contextmenu 重新定位
                        const pointer = event.detail.originalEvent;
                        if (
                            pointer.button === 2 &&
                            pointer.target instanceof Element &&
                            pointer.target.closest("[data-category-item]")
                        ) {
                            event.preventDefault();
                        }
                    }}
                    onCloseAutoFocus={event => {
                        event.preventDefault();
                        returnFocus.current?.focus();
                    }}
                >
                    <DropdownMenuLabel className="max-w-64 truncate text-12 text-muted">
                        {menu?.category.name}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                        className="text-danger"
                        onSelect={() => {
                            if (menu) onDelete(menu.category);
                        }}
                    >
                        <Icon name="trash" size={16} />
                        删除品类
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </aside>
    );
}

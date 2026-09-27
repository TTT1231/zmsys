import { NavLink, useLocation } from "react-router";
import { Icon } from "@/lib/icons";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { findActiveGroup, type NavSection } from "@/data/permissions";
import { useMenuNote } from "./useMenuNote";

/* 顶栏水平组菜单（水平 / 混合垂直 / 混合双列模式）：每组一个下拉，激活组高亮。
   仅桌面端渲染（移动端走抽屉 + 底部导航） */

export function HeaderMenu({ sections }: { sections: NavSection[] }) {
    const location = useLocation();
    const activeGroup = findActiveGroup(sections, location.pathname)?.group;
    const { openNote, noteDialog } = useMenuNote();

    return (
        <>
            <nav aria-label="主导航" className="hidden min-w-0 items-center gap-1 lg:flex">
                {sections.map(section => (
                    <DropdownMenu key={section.group}>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label={`${section.group}菜单`}
                                className={`flex h-10 cursor-pointer items-center gap-1.5 rounded-btn px-3 text-14 font-medium transition-colors ${
                                    activeGroup === section.group
                                        ? "bg-primary-soft text-primary-strong"
                                        : "text-td hover:bg-soft hover:text-ink"
                                }`}
                            >
                                <Icon name={section.icon} size={18} strokeWidth={1.7} className="shrink-0" />
                                <span className="whitespace-nowrap">{section.group}</span>
                                <Icon name="chevron-down" size={14} className="shrink-0 text-muted" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-48">
                            {section.items.map(item =>
                                item.note ? (
                                    <DropdownMenuItem
                                        key={item.label}
                                        onSelect={() => openNote({ title: item.label, description: item.note! })}
                                    >
                                        <Icon name={item.icon} size={18} strokeWidth={1.7} className="shrink-0" />
                                        {item.label}
                                    </DropdownMenuItem>
                                ) : (
                                    <DropdownMenuItem key={item.to} asChild>
                                        <NavLink
                                            to={item.to!}
                                            end={item.end}
                                            className={({ isActive }) =>
                                                isActive ? "font-semibold text-primary-strong" : ""
                                            }
                                        >
                                            <Icon name={item.icon} size={18} strokeWidth={1.7} className="shrink-0" />
                                            {item.label}
                                        </NavLink>
                                    </DropdownMenuItem>
                                ),
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ))}
            </nav>
            {noteDialog}
        </>
    );
}

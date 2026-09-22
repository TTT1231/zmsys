import { NavLink } from "react-router";
import { Icon } from "@/lib/icons";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { NavSection } from "@/data/permissions";
import { useMenuNote, type MenuNote } from "./useMenuNote";

/* 图标轨（vben 双列菜单第一列 / 树形侧栏折叠态）：只显示分组图标。
   - variant="panel"：点击切换子面板显示的分组（双列模式）
   - variant="popup"：点击弹出该组子菜单（树形折叠态） */

interface MenuRailProps {
    sections: NavSection[];
    /** 当前激活分组名（路由反算） */
    activeGroup?: string;
    /** variant="panel" 时点击分组图标 */
    onSelectGroup?: (group: string) => void;
    variant?: "panel" | "popup";
    /** 点击菜单项后回调（关闭移动端抽屉） */
    onNavigate?: () => void;
}

const railButtonClass = (active: boolean) =>
    `relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-btn transition-colors ${
        active ? "bg-primary-soft text-primary-strong" : "text-td hover:bg-soft hover:text-ink"
    }`;

export function MenuRail({ sections, activeGroup, onSelectGroup, variant = "panel", onNavigate }: MenuRailProps) {
    const { openNote, noteDialog } = useMenuNote();

    return (
        <TooltipProvider delayDuration={250}>
            <nav className="flex flex-col items-center gap-1.5 py-2">
                {sections.map(section =>
                    variant === "popup" ? (
                        <GroupPopup
                            key={section.group}
                            section={section}
                            active={activeGroup === section.group}
                            onNote={openNote}
                            onNavigate={onNavigate}
                        />
                    ) : (
                        <Tooltip key={section.group}>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    aria-label={section.group}
                                    aria-pressed={activeGroup === section.group}
                                    onClick={() => onSelectGroup?.(section.group)}
                                    className={railButtonClass(activeGroup === section.group)}
                                >
                                    <Icon name={section.icon} size={19} />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="right">{section.group}</TooltipContent>
                        </Tooltip>
                    ),
                )}
            </nav>
            {noteDialog}
        </TooltipProvider>
    );
}

/* 折叠态弹出子菜单：radix DropdownMenu（键盘导航 / 外点关闭由 Radix 提供） */
function GroupPopup({
    section,
    active,
    onNote,
    onNavigate,
}: {
    section: NavSection;
    active: boolean;
    onNote: (note: MenuNote) => void;
    onNavigate?: () => void;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button type="button" aria-label={section.group} className={railButtonClass(active)}>
                    <Icon name={section.icon} size={19} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="min-w-48">
                {section.items.map(item =>
                    item.note ? (
                        <DropdownMenuItem
                            key={item.label}
                            onSelect={() => {
                                onNote({ title: item.label, description: item.note! });
                                onNavigate?.();
                            }}
                        >
                            <Icon name={item.icon} size={16} className="shrink-0" />
                            {item.label}
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem key={item.to} asChild>
                            <NavLink
                                to={item.to!}
                                end={item.end}
                                onClick={onNavigate}
                                className={({ isActive }) => (isActive ? "font-semibold text-primary-strong" : "")}
                            >
                                <Icon name={item.icon} size={16} className="shrink-0" />
                                {item.label}
                            </NavLink>
                        </DropdownMenuItem>
                    ),
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

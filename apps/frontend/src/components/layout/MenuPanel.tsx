import { Icon } from "@/lib/icons";
import type { NavSection } from "@/data/permissions";
import { MenuItemLink } from "./SidebarMenu";
import { useMenuNote } from "./useMenuNote";

/* 双列菜单第二列 / 混合垂直的「激活组面板」：组名标题 + 该组二级项。
   头部高度对齐侧栏 logo 行（h-16），与 vben extra-title 同语义 */

interface MenuPanelProps {
    section: NavSection | undefined;
    onNavigate?: () => void;
}

export function MenuPanel({ section, onNavigate }: MenuPanelProps) {
    const { openNote, noteDialog } = useMenuNote();

    if (!section) return null;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-5 text-15 font-semibold text-ink">
                <Icon name={section.icon} size={17} className="shrink-0 text-primary-strong" />
                <span className="min-w-0 truncate">{section.group}</span>
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
                <div className="flex flex-col gap-0.5">
                    {section.items.map(item => (
                        <MenuItemLink
                            key={item.to ?? item.label}
                            item={item}
                            onNote={openNote}
                            onNavigate={onNavigate}
                        />
                    ))}
                </div>
            </nav>
            {noteDialog}
        </div>
    );
}

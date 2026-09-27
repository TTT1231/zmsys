import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { Icon } from "@/lib/icons";
import { findActiveGroup, type NavItem, type NavSection } from "@/data/permissions";
import { useMenuNote, type MenuNote } from "./useMenuNote";

/* 二级侧边菜单（vben 式）：一级分组手风琴展开（chevron 旋转 + grid-rows 高度动画），
   二级为页面链接 / 说明型入口。垂直、侧边导航模式与移动端抽屉共用 */

interface MenuItemLinkProps {
    item: NavItem;
    /** 树形子级：左侧额外缩进 */
    inset?: boolean;
    onNote: (note: MenuNote) => void;
    /** 点击后回调（关闭移动端抽屉） */
    onNavigate?: () => void;
}

/* 单个二级菜单项：NavLink（激活浅色圆角底 + 主色文字）或 note 说明按钮 */
export function MenuItemLink({ item, inset = false, onNote, onNavigate }: MenuItemLinkProps) {
    const padding = inset ? "pl-9 pr-3.5" : "px-3.5";

    if (item.note) {
        return (
            <button
                type="button"
                onClick={() => {
                    onNote({ title: item.label, description: item.note! });
                    onNavigate?.();
                }}
                className={`relative flex min-h-10 max-lg:min-h-11 items-center gap-2.5 rounded-btn text-14 text-td transition-colors hover:bg-soft ${padding}`}
            >
                <Icon name={item.icon} size={18} strokeWidth={1.7} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
            </button>
        );
    }

    return (
        <NavLink
            to={item.to!}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
                `relative flex min-h-10 max-lg:min-h-11 items-center gap-2.5 rounded-btn text-14 transition-colors ${
                    isActive ? "bg-primary-soft font-semibold text-primary-strong" : "text-td hover:bg-soft"
                } ${padding}`
            }
        >
            <Icon name={item.icon} size={18} strokeWidth={1.7} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </NavLink>
    );
}

interface SidebarMenuProps {
    sections: NavSection[];
    onNavigate?: () => void;
}

export function SidebarMenu({ sections, onNavigate }: SidebarMenuProps) {
    const location = useLocation();
    const { openNote, noteDialog } = useMenuNote();
    const activeGroup = findActiveGroup(sections, location.pathname)?.group;
    const [openGroup, setOpenGroup] = useState<string | null>(activeGroup ?? sections[0]?.group ?? null);

    // 路由跨组切换时自动展开新组（组内导航不打扰用户手动收起的状态）。
    // 依赖用组名字符串：对象依赖（findActiveGroup 的返回）每次渲染都是新引用，会每帧重置展开态
    useEffect(() => {
        if (activeGroup) setOpenGroup(activeGroup);
    }, [activeGroup]);

    // 授权 / 角色变化导致分组增减时兜底
    useEffect(() => {
        if (openGroup && !sections.some(section => section.group === openGroup)) {
            setOpenGroup(sections[0]?.group ?? null);
        }
    }, [sections, openGroup]);

    return (
        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
            {sections.map(section => {
                const open = openGroup === section.group;
                return (
                    <div key={section.group}>
                        <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => setOpenGroup(open ? null : section.group)}
                            className={`group flex w-full min-h-10 max-lg:min-h-11 cursor-pointer items-center gap-2.5 rounded-btn px-3.5 text-14 font-medium transition-colors ${
                                activeGroup === section.group ? "text-primary-strong" : "text-ink hover:bg-soft"
                            }`}
                        >
                            <Icon name={section.icon} size={18} strokeWidth={1.7} className="shrink-0" />
                            <span className="min-w-0 flex-1 truncate text-left">{section.group}</span>
                            <Icon
                                name="chevron-down"
                                size={15}
                                className={`shrink-0 text-muted transition-transform duration-300 ${open ? "" : "-rotate-90"}`}
                            />
                        </button>
                        {/* grid-rows 0fr→1fr 过渡实现展开/收起高度动画，无需 JS 测量 */}
                        <div
                            className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                                open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                            }`}
                        >
                            {/* 负 margin 抵消水平 padding：裁剪框向外扩 4px，
                                容纳 :focus-visible 画在元素外侧的焦点圈（3px outline + 1px offset） */}
                            <div className="-mx-1 overflow-hidden px-1">
                                <div className="flex flex-col gap-0.5 py-1">
                                    {section.items.map(item => (
                                        <MenuItemLink
                                            key={item.to ?? item.label}
                                            item={item}
                                            inset
                                            onNote={openNote}
                                            onNavigate={onNavigate}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
            {noteDialog}
        </nav>
    );
}

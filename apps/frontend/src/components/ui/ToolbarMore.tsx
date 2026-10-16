import type { ReactNode } from "react";

/** 工具栏收纳区，仅桌面（lg+）渲染。移动端原本收纳的只有"刷新"一项，
 *  单为它铺一层"更多"下拉菜单占一行空间不划算；刷新交给浏览器下拉刷新。 */
export function ToolbarMore({ children }: { children: ReactNode }) {
    return <div className="hidden items-center gap-2 lg:flex">{children}</div>;
}

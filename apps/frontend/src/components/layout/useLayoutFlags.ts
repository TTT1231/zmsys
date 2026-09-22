import { usePreferences } from "@/context/usePreferences";

/* 布局模式 → 结构 flags（vben use-layout 的 React 版）：
   AppLayout / Sidebar / Topbar 只消费这三个派生值，不直接 switch 布局枚举 */

export type SidebarForm = "tree" | "mixed" | "group" | "none";

export interface LayoutFlags {
    /** 侧栏形态：完整树 / 图标轨+子面板 / 仅激活组面板 / 无侧栏 */
    sidebarForm: SidebarForm;
    /** true = 骨架 B：logo 进顶栏、顶栏通栏、侧栏从顶栏下方开始 */
    headerFull: boolean;
    /** 顶栏渲染水平组菜单（水平 / 混合垂直 / 混合双列） */
    headerMenu: boolean;
}

export function useLayoutFlags(): LayoutFlags {
    const { preferences } = usePreferences();
    switch (preferences.layout) {
        case "sidebar-nav":
            return { sidebarForm: "tree", headerFull: false, headerMenu: false };
        case "sidebar-mixed-nav":
            return { sidebarForm: "mixed", headerFull: false, headerMenu: false };
        case "header-nav":
            return { sidebarForm: "none", headerFull: true, headerMenu: true };
        case "header-sidebar-nav":
            return { sidebarForm: "tree", headerFull: true, headerMenu: false };
        case "mixed-nav":
            return { sidebarForm: "group", headerFull: true, headerMenu: true };
        case "header-mixed-nav":
            return { sidebarForm: "mixed", headerFull: true, headerMenu: true };
    }
}

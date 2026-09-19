import { createContext, useContext } from "react";

/* 内容最大化上下文（vben 式“伪全屏”）：收起侧边栏与顶栏、列表卡片撑满视口，
   表体在卡片内部滚动。状态由 AppLayout 持有（布局与页面按钮共用），
   与顶栏的浏览器原生全屏（requestFullscreen）相互独立 */
interface ContentMaximizeState {
    maximized: boolean;
    toggle: () => void;
}

export const ContentMaximizeContext = createContext<ContentMaximizeState>({
    maximized: false,
    toggle: () => {},
});

export const useContentMaximize = () => useContext(ContentMaximizeContext);

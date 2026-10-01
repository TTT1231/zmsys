import { createContext, useContext } from "react";
import type { Snapshot } from "@/api";
import { EMPTY_SNAPSHOT } from "@/data/views";

/* 快照上下文的非组件部分（context 对象、hook）单独成文件，
   避免与 SnapProvider 混在一个文件导出而破坏 React Fast Refresh */

/** 页面级聚合快照共享：页面根部用 useWbView 取数一次并包 Provider，
 *  子组件（弹窗/卡片）经 useSnap 消费，替代逐层传递的 snap props。
 *  未包 Provider 时回落空快照，与加载中/无数据同构 */
export const SnapContext = createContext<Snapshot>(EMPTY_SNAPSHOT);

/** 当前页面的聚合快照（快照未就绪时为空数据结构） */
export function useSnap(): Snapshot {
    return useContext(SnapContext);
}

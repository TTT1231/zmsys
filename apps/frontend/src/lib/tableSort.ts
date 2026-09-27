// 表格列排序状态切换（纯函数，各列表页共用；首次点击一律升序）
export type SortDir = "asc" | "desc";

export interface SortState<K extends string> {
    key: K;
    dir: SortDir;
}

/* 点击同列在升/降序间切换，点击新列从升序开始 */
export function nextSortState<K extends string>(current: SortState<K>, key: K): SortState<K> {
    if (current.key !== key) return { key, dir: "asc" };
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

/* 三态排序循环（升序 → 降序 → 取消）：仅供支持手动行拖拽的列表页（订单页）使用。
   点表头排序即重排一次并作废手动序；拖拽手动序则暂停当前排序——两种顺序来源
   按最后一次操作生效（联动由页面状态负责）。其余列表页继续用 nextSortState 两态。 */
export function cycleSortState<K extends string>(current: SortState<K> | null, key: K): SortState<K> | null {
    if (!current || current.key !== key) return { key, dir: "asc" };
    return current.dir === "asc" ? { key, dir: "desc" } : null;
}

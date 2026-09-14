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

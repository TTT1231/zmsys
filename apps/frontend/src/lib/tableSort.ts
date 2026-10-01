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

/* 台账行（入库/出库记录）的可排序公共字段与键 */
export interface LedgerRow {
    no: string;
    bomCode: string;
    qty: number;
    date: string;
}
export type LedgerSortKey = "no" | "bomCode" | "qty" | "date";

/** 台账排序套件：列配置（单号/数量/日期三列的文案按 入库/出库 前缀差异化）
 *  + 统一比较器（同键并列按单号稳定排序，与两台账页原实现同口径） */
export function makeLedgerSort<Row extends LedgerRow>(labels: { no: string; qty: string; date: string }) {
    const columns: Array<{ key: LedgerSortKey; label: string }> = [
        { key: "no", label: labels.no },
        { key: "bomCode", label: "BOM 编码" },
        { key: "qty", label: labels.qty },
        { key: "date", label: labels.date },
    ];
    const sortRows = (rows: Row[], sort: SortState<LedgerSortKey>) => {
        const factor = sort.dir === "asc" ? 1 : -1;
        return [...rows].sort((a, b) => {
            const byKey =
                sort.key === "no"
                    ? a.no.localeCompare(b.no)
                    : sort.key === "bomCode"
                      ? a.bomCode.localeCompare(b.bomCode)
                      : sort.key === "qty"
                        ? a.qty - b.qty
                        : a.date.localeCompare(b.date);
            return byKey * factor || a.no.localeCompare(b.no);
        });
    };
    return { columns, sortRows };
}

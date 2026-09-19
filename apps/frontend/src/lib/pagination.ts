/** 分页页码窗口:总页数 ≤5 全量展示,否则收缩为首尾 + 当前页邻域,省略处用 "…" 占位。 */
export function paginationWindow(page: number, pages: number): Array<number | "…"> {
    if (pages <= 5) return Array.from({ length: pages }, (_, index) => index + 1);
    if (page <= 3) return [1, 2, 3, 4, "…", pages];
    if (page >= pages - 2) return [1, "…", pages - 3, pages - 2, pages - 1, pages];
    return [1, "…", page - 1, page, page + 1, "…", pages];
}

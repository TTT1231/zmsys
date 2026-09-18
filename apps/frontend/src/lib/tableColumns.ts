/** 列宽以实际像素计算；拖动只在相邻两列之间分配空间，保持表格总宽度。 */
export interface TableColumnSize {
    key: string;
    width: number;
    min: number;
    max: number;
    fixed?: boolean;
}
export function fitTableWidths(columns: TableColumnSize[], saved: Record<string, number>, available: number) {
    const widths = Object.fromEntries(
        columns.map(column => [
            column.key,
            column.fixed ? column.width : Math.min(column.max, Math.max(column.min, saved[column.key] ?? column.width)),
        ]),
    );
    let spare = Math.max(0, Math.floor(available - Object.values(widths).reduce((sum, width) => sum + width, 0)));
    // 有多余空间时只分配给数据列；达到上限后继续分配给其余列。
    while (spare > 0) {
        const flexible = columns.filter(column => !column.fixed && widths[column.key] < column.max);
        if (!flexible.length) break;
        const share = Math.max(1, Math.floor(spare / flexible.length));
        for (const column of flexible) {
            const added = Math.min(share, spare, column.max - widths[column.key]);
            widths[column.key] += added;
            spare -= added;
        }
    }
    return widths;
}
export function resizeTablePair(
    columns: TableColumnSize[],
    widths: Record<string, number>,
    key: string,
    desired: number,
) {
    const index = columns.findIndex(column => column.key === key);
    const column = columns[index];
    if (!column || column.fixed) return widths;
    const neighbor = columns[index + 1]?.fixed ? columns[index - 1] : columns[index + 1];
    if (!neighbor || neighbor.fixed) return widths;
    const total = widths[key] + widths[neighbor.key];
    const lower = Math.max(column.min, total - neighbor.max);
    const upper = Math.min(column.max, total - neighbor.min);
    const width = Math.min(upper, Math.max(lower, Math.round(desired)));
    return { ...widths, [key]: width, [neighbor.key]: total - width };
}

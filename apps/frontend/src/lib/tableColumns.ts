/** 推荐布局优先为产品信息分配空间；手动宽度保持不变，剩余空间交给自动列。 */
export interface TableColumnSize {
    key: string;
    width: number;
    min: number;
    max: number;
    fixed?: boolean;
    grow?: boolean;
}
export function fitTableWidths(columns: TableColumnSize[], saved: Record<string, number>, available: number) {
    const widths = Object.fromEntries(
        columns.map(column => [
            column.key,
            column.fixed ? column.width : Math.min(column.max, Math.max(column.min, saved[column.key] ?? column.width)),
        ]),
    );
    let spare = Math.max(0, Math.floor(available - Object.values(widths).reduce((sum, width) => sum + width, 0)));
    // 已手动调整的列保持用户指定宽度；其余空间优先分配给内容型自动列。
    while (spare > 0) {
        const candidates = columns.filter(
            column => !column.fixed && saved[column.key] === undefined && widths[column.key] < column.max,
        );
        const preferred = candidates.filter(column => column.grow);
        const flexible = preferred.length ? preferred : candidates;
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
export function resizeTableColumn(
    columns: TableColumnSize[],
    widths: Record<string, number>,
    key: string,
    desired: number,
) {
    const column = columns.find(column => column.key === key);
    if (!column || column.fixed) return widths;
    const width = Math.min(column.max, Math.max(column.min, Math.round(desired)));
    return { ...widths, [key]: width };
}

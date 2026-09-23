/** 推荐布局优先为产品信息分配空间；手动宽度保持不变，剩余空间交给自动列。
 *  推荐宽度超出容器时先收窄自动列（优先最宽的内容列），让默认视图尽量单屏放下，
 *  避免数值被固定操作列遮住；数据列压到推荐下限仍溢出时，全员（含手动宽度）按可让
 *  空间比例继续压缩到单屏——横向滚动时"只有首尾固定、中间内容滚走"不可接受；
 *  压到保底下限仍放不下的极端窄屏才真正横向滚动（首尾固定列兜底）。
 *  紧凑档（账本模式）传 stretch:false：内容列不吸收剩余宽度，富余集中到表格尾部弹性区。 */

/** 二阶段压缩的保底下限：低于它不再让位，宁可横向滚动也不把列压没 */
const HARD_MIN = 72;

export interface TableColumnSize {
    key: string;
    width: number;
    min: number;
    max: number;
    fixed?: boolean;
    grow?: boolean;
}
export function fitTableWidths(
    columns: TableColumnSize[],
    saved: Record<string, number>,
    available: number,
    options?: { stretch?: boolean },
) {
    const widths = Object.fromEntries(
        columns.map(column => [
            column.key,
            column.fixed ? column.width : Math.min(column.max, Math.max(column.min, saved[column.key] ?? column.width)),
        ]),
    );
    const total = () => Object.values(widths).reduce((sum, width) => sum + width, 0);
    // available<=0 视为视口未测得（jsdom / 首帧），不收窄以免闪最小宽
    let overflow = available > 0 ? Math.max(0, Math.ceil(total() - available)) : 0;
    while (overflow > 0) {
        const candidates = columns.filter(
            column => !column.fixed && saved[column.key] === undefined && widths[column.key] > column.min,
        );
        const preferred = candidates.filter(column => column.grow);
        const flexible = preferred.length ? preferred : candidates;
        if (!flexible.length) break;
        const share = Math.max(1, Math.ceil(overflow / flexible.length));
        for (const column of flexible) {
            const removed = Math.min(share, overflow, widths[column.key] - column.min);
            widths[column.key] -= removed;
            overflow -= removed;
        }
    }
    // 第二阶段：仍溢出时全员按可让空间比例压缩（含手动宽度，不写回偏好，容器变宽即恢复）
    if (overflow > 0) {
        const shrinkable = columns
            .filter(column => !column.fixed && widths[column.key] > HARD_MIN)
            .sort((a, b) => widths[b.key] - widths[a.key]);
        const poolWidth = shrinkable.reduce((sum, column) => sum + (widths[column.key] - HARD_MIN), 0);
        if (poolWidth >= overflow) {
            let remaining = overflow;
            for (const column of shrinkable) {
                const removable = widths[column.key] - HARD_MIN;
                const share = Math.min(removable, Math.floor((overflow * removable) / poolWidth), remaining);
                widths[column.key] -= share;
                remaining -= share;
            }
            // 比例取整的尾差补到最宽列，保证总宽精确收进容器
            for (const column of shrinkable) {
                if (remaining <= 0) break;
                const extra = Math.min(widths[column.key] - HARD_MIN, remaining);
                widths[column.key] -= extra;
                remaining -= extra;
            }
            overflow = remaining;
        }
    }
    // stretch=false（紧凑账本档）：剩余宽度不分给内容列，交回调用方的尾部弹性列
    let spare = options?.stretch === false ? 0 : Math.max(0, Math.floor(available - total()));
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

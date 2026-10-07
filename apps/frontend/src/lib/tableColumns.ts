/** 推荐布局优先为产品信息分配空间；手动宽度保持不变，剩余空间交给自动列。
 *  推荐宽度超出容器时先收窄自动列（优先最宽的内容列），让默认视图尽量单屏放下，
 *  避免数值被固定操作列遮住；列最小宽之和仍溢出时保留溢出走横向滚动——
 *  此时由各页 pinnedStart 固定关键列（客户/备注、BOM 编码等），滚动不失锚点；
 *  不要在此处做"全员压缩进单屏"：压出的窄列处处截断，还会吃掉手动调宽（拖拽无效）。
 *  紧凑档（账本模式）传 stretch:false：内容列不吸收剩余宽度，富余集中到表格尾部弹性区。
 *  剩余宽度按各列当前宽的占比摊给所有列（含手动列与固定操作列）——浏览器 100%
 *  固定布局表格的原生呼吸感：拖窄一列，整表一起分担，而不是个别内容列独吞；
 *  hold 传入拖拽中的列：它的宽度由指针 1:1 控制，参与分摊会出现"拖了不缩"的橡皮筋感。
 *  fixed（最右操作列）不参与溢出收缩让位，自动宽度恒为推荐值；
 *  但手动宽度（拖拽/显示设置写入 saved）同样生效并受 min/max 钳制——min 由调用方
 *  给到内容下限（推荐宽），操作列压不进内容，大字号下不再截成「查看详情…」，
 *  手动调过宽的固定列也不再是"拖不动的死列"。 */
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
    options?: { stretch?: boolean; hold?: string },
) {
    const widths = Object.fromEntries(
        columns.map(column => [
            column.key,
            Math.min(column.max, Math.max(column.min, saved[column.key] ?? column.width)),
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
    // stretch=false（紧凑账本档）：剩余宽度不分给内容列，交回调用方的尾部弹性列
    let spare = options?.stretch === false ? 0 : Math.max(0, Math.floor(available - total()));
    // 剩余宽度按各列当前宽的占比摊给所有列（含手动列与固定操作列）：
    // 手动宽度是基准不被吃掉，呼吸是渲染时的二次分摊、不落盘；
    // 逐轮分配消化取整余数与触到 max 的列，分完或无人可加即止。
    while (spare > 0) {
        const candidates = columns.filter(column => column.key !== options?.hold && widths[column.key] < column.max);
        if (!candidates.length) break;
        const base = candidates.reduce((sum, column) => sum + widths[column.key], 0);
        let distributed = 0;
        for (const column of candidates) {
            const added = Math.min(column.max - widths[column.key], Math.floor((spare * widths[column.key]) / base));
            if (added > 0) {
                widths[column.key] += added;
                distributed += added;
            }
        }
        if (distributed === 0) {
            // 占比取整全为 0 的碎余数：按列序每列匀 1px（候选列必有 ≥1px 余量），分完即止
            for (const column of candidates) {
                if (spare === 0) break;
                widths[column.key] += 1;
                distributed += 1;
                spare -= 1;
            }
        }
        spare -= distributed;
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
    if (!column) return widths;
    const width = Math.min(column.max, Math.max(column.min, Math.round(desired)));
    return { ...widths, [key]: width };
}

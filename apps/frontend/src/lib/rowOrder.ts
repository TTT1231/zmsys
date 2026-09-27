// 行拖拽手动排序的顺序计算（纯函数，订单页手动行序使用）
/* 把 from 下标的元素移动到 to 下标（clamp 进界），返回新数组；from 越界或原地不动时返回原序副本 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
    if (from < 0 || from >= list.length || from === to) return [...list];
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
    return next;
}

/* 手动序合流：full 是拖拽前的完整序，participants 是实际参与重排的子序列（如当前页/
   筛选视图的可见行），ordered 是参与行的新序。未参与行保持原相对位置穿插回去——
   若直接把可见行的新序当全量序，清空筛选后未参与行会从列表里"消失"。 */
export function mergeReordered<T>(full: readonly T[], participants: readonly T[], ordered: readonly T[]): T[] {
    const set = new Set(participants);
    const queue = [...ordered];
    return full.map(item => (set.has(item) ? (queue.shift() ?? item) : item));
}

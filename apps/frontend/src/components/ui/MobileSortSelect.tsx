// 移动端卡片列表的排序入口：原生 select 一次点选列+方向，与桌面表头共享同一 sort 状态（仅 <lg 显示）
import type { SortState } from "@/lib/tableSort";

/* value 可为 null：传 noneLabel 的页面（订单页手动行序）多出"默认顺序"选项表示取消排序。
   两态列表页不传 noneLabel、value 恒非空，onChange 里 `if (next)` 只挡类型层的 null */
export function MobileSortSelect<K extends string>({
    columns,
    value,
    onChange,
    noneLabel,
}: {
    columns: Array<{ key: K; label: string }>;
    value: SortState<K> | null;
    onChange: (next: SortState<K> | null) => void;
    noneLabel?: string;
}) {
    return (
        <select
            value={value ? `${value.key}:${value.dir}` : "none"}
            onChange={event => {
                if (event.target.value === "none") {
                    onChange(null);
                    return;
                }
                const [key, dir] = event.target.value.split(":");
                onChange({ key: key as K, dir: dir === "desc" ? "desc" : "asc" });
            }}
            aria-label="排序列表"
            className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink lg:hidden"
        >
            {noneLabel && <option value="none">{noneLabel}</option>}
            {columns.flatMap(({ key, label }) => [
                <option key={`${key}:asc`} value={`${key}:asc`}>
                    {label} ↑ 升序
                </option>,
                <option key={`${key}:desc`} value={`${key}:desc`}>
                    {label} ↓ 降序
                </option>,
            ])}
        </select>
    );
}

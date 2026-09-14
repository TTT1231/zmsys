// 移动端卡片列表的排序入口：原生 select 一次点选列+方向，与桌面表头共享同一 sort 状态（仅 <lg 显示）
import type { SortState } from "@/lib/tableSort";

export function MobileSortSelect<K extends string>({
    columns,
    value,
    onChange,
}: {
    columns: Array<{ key: K; label: string }>;
    value: SortState<K>;
    onChange: (next: SortState<K>) => void;
}) {
    return (
        <select
            value={`${value.key}:${value.dir}`}
            onChange={event => {
                const [key, dir] = event.target.value.split(":");
                onChange({ key: key as K, dir: dir === "desc" ? "desc" : "asc" });
            }}
            aria-label="排序列表"
            className="h-10 rounded-btn border border-line-strong bg-white px-3 text-13 text-ink lg:hidden"
        >
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

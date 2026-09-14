// 可排序列表头：aria-sort 语义 + 方向指示（未激活淡显、激活后主题色），排序状态由页面持有
import { Icon } from "@/lib/icons";
import type { SortDir } from "@/lib/tableSort";

export function SortTh({
    label,
    active,
    dir,
    onSort,
    align = "left",
    width,
    className = "",
}: {
    label: string;
    active: boolean;
    dir: SortDir;
    onSort: () => void;
    align?: "left" | "right";
    width?: string;
    className?: string;
}) {
    return (
        <th
            aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
            className={`py-2.5 text-12 font-semibold ${align === "right" ? "text-right" : "text-left"} ${className}`}
            style={width ? { width } : undefined}
        >
            <button
                type="button"
                onClick={onSort}
                title={active ? `当前${dir === "asc" ? "升" : "降"}序，点击切换` : "点击按升序排序"}
                className={`inline-flex items-center gap-1 underline-offset-2 transition hover:text-primary-strong hover:underline ${
                    active ? "text-primary-strong" : "text-muted"
                }`}
            >
                {label}
                {/* 图标定宽：sort/chevron 三态宽度不同，不定宽会导致文字在切换时横向跳动 */}
                <span className="inline-flex w-3.5 shrink-0 justify-center">
                    <Icon
                        name={active ? (dir === "asc" ? "chevron-up" : "chevron-down") : "sort"}
                        size={13}
                        className={active ? "" : "opacity-40"}
                    />
                </span>
            </button>
        </th>
    );
}

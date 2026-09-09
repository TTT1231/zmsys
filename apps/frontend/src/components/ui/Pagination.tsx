import { Icon } from "@/lib/icons";
import { num } from "@/lib/format";

interface PaginationProps {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
    unit?: string;
}

export function paginationWindow(page: number, pages: number): Array<number | "…"> {
    if (pages <= 5) return Array.from({ length: pages }, (_, index) => index + 1);
    if (page <= 3) return [1, 2, 3, 4, "…", pages];
    if (page >= pages - 2) return [1, "…", pages - 3, pages - 2, pages - 1, pages];
    return [1, "…", page - 1, page, page + 1, "…", pages];
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, unit = "条" }: PaginationProps) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const current = Math.min(page, pages);
    const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
    const to = Math.min(total, current * pageSize);

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 max-sm:flex-col">
            <div className="flex items-center gap-3 text-[12.5px] text-muted max-sm:hidden">
                <span>
                    显示 {from}–{to}，共 {num(total)} {unit}
                </span>
                {onPageSizeChange && (
                    <label className="flex items-center gap-1.5">
                        每页
                        <select
                            value={pageSize}
                            onChange={event => onPageSizeChange(Number(event.target.value))}
                            className="rounded-lg border border-line bg-white px-2 py-1 text-[12.5px] text-ink"
                        >
                            {[10, 30, 50].map(size => (
                                <option key={size} value={size}>
                                    {size}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
            </div>
            <div className="flex items-center gap-1 max-sm:w-full max-sm:justify-between">
                <button
                    type="button"
                    aria-label="上一页"
                    disabled={current <= 1}
                    onClick={() => onPageChange(current - 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted transition hover:border-primary-border hover:text-primary disabled:opacity-40"
                >
                    <Icon name="chevron-left" size={15} />
                </button>
                {paginationWindow(current, pages).map((item, index) =>
                    item === "…" ? (
                        <span key={`ellipsis-${index}`} className="px-1.5 text-[12.5px] text-subtle max-sm:hidden">
                            …
                        </span>
                    ) : (
                        <button
                            key={item}
                            type="button"
                            aria-current={item === current ? "page" : undefined}
                            onClick={() => onPageChange(item)}
                            className={`h-8 min-w-8 rounded-lg px-2 text-[12.5px] font-medium transition ${
                                item === current
                                    ? "bg-primary text-white max-sm:hidden"
                                    : "border border-line text-muted hover:border-primary-border hover:text-primary max-sm:hidden"
                            }`}
                        >
                            {item}
                        </button>
                    ),
                )}
                <span className="hidden text-center text-[12px] text-muted max-sm:block">
                    第 {current} / {pages} 页
                </span>
                <button
                    type="button"
                    aria-label="下一页"
                    disabled={current >= pages}
                    onClick={() => onPageChange(current + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted transition hover:border-primary-border hover:text-primary disabled:opacity-40"
                >
                    <Icon name="chevron-right" size={15} />
                </button>
            </div>
        </div>
    );
}

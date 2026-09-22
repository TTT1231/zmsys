import { cn } from "@/lib/utils";

/* 分段式 tab（vben VbenSegmented 的轻量版）：灰底胶囊容器 + 白色滑动药丸 + 主色激活文字。
   药丸用 absolute left 百分比过渡实现滑动，不依赖 DOM 测量 */

export interface SegmentedTabItem {
    value: string;
    label: string;
}

interface SegmentedTabsProps {
    tabs: SegmentedTabItem[];
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

export function SegmentedTabs({ tabs, value, onChange, className }: SegmentedTabsProps) {
    const activeIndex = Math.max(
        0,
        tabs.findIndex(tab => tab.value === value),
    );
    const cell = 100 / tabs.length;

    return (
        <div
            role="tablist"
            className={cn("relative grid rounded-full bg-soft p-1", className)}
            style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
            {/* 滑动药丸：left 取激活格百分比，两侧各让出容器的 p-1 内边距 */}
            <span
                aria-hidden="true"
                className="absolute inset-y-1 rounded-full bg-surface shadow-sm transition-[left] duration-300 ease-out"
                style={{ left: `calc(${activeIndex * cell}% + 0.25rem)`, width: `calc(${cell}% - 0.5rem)` }}
            />
            {tabs.map(tab => (
                <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={tab.value === value}
                    onClick={() => onChange(tab.value)}
                    className={cn(
                        "relative z-10 flex h-9 cursor-pointer items-center justify-center rounded-full text-13 font-medium whitespace-nowrap transition-colors",
                        tab.value === value ? "text-primary-strong" : "text-muted hover:text-ink",
                    )}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}

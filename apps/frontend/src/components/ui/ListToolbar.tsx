import type { ReactNode } from "react";
import { Icon } from "@/lib/icons";

/** 列表页工具栏容器：搜索框（最左，窄屏独占整行、宽屏 280px）+ 中段筛选控件
 *  （品类/状态/排序/日期等经 children 注入）+ 清空条件 + 右侧动作区（trailing）。
 *  类串与各列表页原实现逐字一致；变更筛选回第 1 页由页面传入的 onChange 负责 */
export function ListToolbar({
    keyword,
    onKeywordChange,
    placeholder,
    onClear,
    filtersActive,
    children,
    trailing,
}: {
    keyword: string;
    onKeywordChange: (value: string) => void;
    placeholder: string;
    onClear: () => void;
    filtersActive: boolean;
    children?: ReactNode;
    /** 右侧（ml-auto）动作区：计数 / 刷新菜单 / 新增按钮等 */
    trailing?: ReactNode;
}) {
    return (
        <div className="list-toolbar flex flex-wrap items-center border-b border-line bg-linear-to-b from-surface to-panel px-5 py-4 lg:gap-2.5">
            <label className="flex h-10 items-center gap-2 rounded-btn border border-line-strong bg-surface px-3 lg:w-70">
                <Icon name="search" size={15} className="text-subtle" />
                <input
                    value={keyword}
                    onChange={event => onKeywordChange(event.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-transparent text-14 text-ink outline-none placeholder:text-subtle"
                />
            </label>
            {children}
            <button
                type="button"
                onClick={onClear}
                disabled={!filtersActive}
                className="min-h-10 px-1 text-14 font-medium text-muted transition hover:text-primary-strong disabled:cursor-not-allowed disabled:text-subtle disabled:hover:text-subtle"
            >
                清空条件
            </button>
            {trailing}
        </div>
    );
}

import type { ReactNode } from "react";
import { Icon } from "@/lib/icons";
import { Button } from "./Button";
import { useRegisterListSearch } from "@/context/useListView";

/** 桌面保留搜索、筛选及动作区；手机注册顶栏搜索并展示精简控件与当前关键词。
 *  变更条件后回到第 1 页，由页面传入的 onChange 负责。 */
export function ListToolbar({
    keyword,
    onKeywordChange,
    placeholder,
    onClear,
    filtersActive,
    children,
    trailing,
    mobileContent,
    searchLabel = "搜索内容",
    clearLabel = "清空条件",
}: {
    keyword: string;
    onKeywordChange: (value: string) => void;
    placeholder: string;
    onClear: () => void;
    filtersActive: boolean;
    children?: ReactNode;
    /** 右侧（ml-auto）动作区：计数 / 刷新菜单 / 新增按钮等 */
    trailing?: ReactNode;
    mobileContent?: ReactNode;
    searchLabel?: string;
    clearLabel?: string;
}) {
    useRegisterListSearch(keyword, onKeywordChange, placeholder);
    return (
        <>
            <div className="list-toolbar hidden flex-wrap items-center gap-2.5 border-b border-line bg-linear-to-b from-surface to-panel px-5 py-4 lg:flex">
                <label className="flex h-10 items-center gap-2 rounded-btn border border-line-strong bg-surface px-3 lg:w-70">
                    <Icon name="search" size={15} className="text-subtle" />
                    <input
                        aria-label={searchLabel}
                        value={keyword}
                        onChange={event => onKeywordChange(event.target.value)}
                        placeholder={placeholder}
                        className="w-full bg-transparent text-14 text-ink outline-none placeholder:text-subtle"
                    />
                </label>
                {children}
                {/* 手机在筛选面板重置，或通过工具栏一键清空筛选。 */}
                <Button
                    variant="link"
                    onClick={onClear}
                    disabled={!filtersActive}
                    className="max-lg:hidden min-h-10 px-1 text-muted hover:text-primary-strong disabled:cursor-not-allowed disabled:text-subtle disabled:hover:text-subtle"
                >
                    {clearLabel}
                </Button>
                {trailing}
            </div>
            {mobileContent}
            {!!keyword.trim() && (
                <div
                    className="flex items-center gap-2 border-b border-line bg-primary-soft px-3 py-1.5 text-14 text-primary-strong lg:hidden"
                    role="status"
                >
                    <Icon name="search" size={15} className="shrink-0" />
                    <span className="min-w-0 flex-1 wrap-anywhere">搜索：{keyword}</span>
                    <Button
                        iconOnly
                        aria-label="清除搜索"
                        onClick={() => onKeywordChange("")}
                        className="shrink-0 text-primary-strong"
                    >
                        <Icon name="close" size={17} />
                    </Button>
                </div>
            )}
        </>
    );
}

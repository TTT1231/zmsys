import type { ReactNode } from "react";
import { useContentMaximize } from "@/context/useContentMaximize";
import { Icon } from "@/lib/icons";

interface TableHeaderActionsProps {
    children?: ReactNode;
    className?: string;
}

/* 列表卡片右侧动作区：业务主动作跟随表格，最大化始终位于最右。 */
export function TableHeaderActions({ children, className = "" }: TableHeaderActionsProps) {
    const { maximized, toggle } = useContentMaximize();

    return (
        <div className={`table-header-actions flex shrink-0 items-center gap-2 ${className}`}>
            {children}
            <button
                type="button"
                aria-label={maximized ? "退出表格最大化" : "最大化表格"}
                aria-pressed={maximized}
                onClick={toggle}
                className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-btn border border-line bg-surface text-muted transition hover:bg-soft hover:text-ink active:scale-90 lg:flex"
            >
                <Icon name={maximized ? "minimize" : "maximize"} size={17} />
            </button>
        </div>
    );
}

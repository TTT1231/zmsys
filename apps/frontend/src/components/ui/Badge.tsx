import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "@/lib/icons";
import type { StatusKey } from "@/api";

/* 状态徽章：一律走语义 token（soft 底 + 语义字色 + 基色 30% 透明边框），
   边框不用固定浅色 hex——暗色下 base token 整体提亮，透明度随动，浅暗共用一份定义 */
const STATUS_STYLES: Record<string, string> = {
    done: "bg-accent-soft text-accent border-accent/30",
    ready: "bg-accent-soft text-accent border-accent/30",
    partReady: "bg-warning-soft text-warning border-warning/30",
    progress: "bg-soft text-td-strong border-line",
    pending: "bg-warning-soft text-warning border-warning/30",
    archived: "bg-soft text-subtle border-line",
    danger: "bg-danger-soft text-danger border-danger/30",
    success: "bg-success-soft text-success border-success/30",
};

const STATUS_LABELS: Record<StatusKey, string> = {
    done: "已完成",
    progress: "部分发货",
    ready: "可发货",
    partReady: "部分可发货",
    pending: "待备货",
    archived: "已归档",
};

export function StatusBadge({ status, label }: { status: StatusKey; label?: string }) {
    return (
        <span
            className={`table-badge inline-flex items-center rounded-full border px-2.5 py-0.75 text-13 font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}
        >
            {label || STATUS_LABELS[status]}
        </span>
    );
}

export function Badge({ tone = "progress", children }: { tone?: string; children: ReactNode }) {
    return (
        <span
            className={`table-badge inline-flex items-center rounded-full border px-2.5 py-0.75 text-13 font-medium whitespace-nowrap ${STATUS_STYLES[tone] || STATUS_STYLES.progress}`}
        >
            {children}
        </span>
    );
}

/* 主按钮 / 次按钮 */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "danger";
    icon?: string;
}

export function Button({ variant = "primary", icon, children, className = "", ...rest }: ButtonProps) {
    const base =
        "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-btn px-4 text-14 font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
    const styles =
        variant === "primary"
            ? "bg-primary text-white hover:bg-primary-hover"
            : variant === "danger"
              ? "bg-danger text-white hover:bg-danger/90"
              : "border border-line-strong bg-surface text-ink hover:border-primary-border hover:text-primary-strong";
    return (
        <button type="button" className={`${base} ${styles} ${className}`} {...rest}>
            {icon && <Icon name={icon} size={16} />}
            {children}
        </button>
    );
}

/* 表格内文字链接按钮 */
export function TableLink({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="text-14 font-medium text-primary-strong underline-offset-2 transition hover:underline"
        >
            {children}
        </button>
    );
}

/* 交付进度条（.ledger-track）；交付完成走 success 绿（全量交付一眼可辨，未完成走主题色渐变） */
export function ProgressTrack({ value, done }: { value: number; done?: boolean }) {
    return (
        <div className="ledger-track h-0.75 w-full max-w-30 overflow-hidden rounded-full bg-soft">
            <div
                className={`h-full rounded-full ${done ? " bg-success" : "bg-linear-to-r from-[var(--color-primary)] to-[color-mix(in_srgb,var(--color-primary)_60%,white)]"}`}
                style={{ width: `${Math.min(100, Math.round(value * 100))}%` }}
            />
        </div>
    );
}

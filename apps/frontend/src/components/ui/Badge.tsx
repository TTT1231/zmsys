import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "@/lib/icons";
import type { StatusKey } from "@/api";

/* 状态徽章：配色沿用 saas-theme.css 的 status token */
const STATUS_STYLES: Record<string, string> = {
    done: "bg-accent-soft text-sky-700 border-sky-200",
    ready: "bg-accent-soft text-sky-700 border-sky-200",
    progress: "bg-[#f2f4f7] text-td-strong border-line",
    pending: "bg-[#fff6e7] text-[#a15c07] border-[#fedf89]",
    cancelled: "bg-danger-soft text-danger border-[#fecdca]",
    danger: "bg-danger-soft text-danger border-[#fecdca]",
    success: "bg-success-soft text-success border-[#abefc6]",
};

const STATUS_LABELS: Record<StatusKey, string> = {
    done: "已完成",
    progress: "部分发货",
    ready: "可发货",
    pending: "待备货",
    cancelled: "已取消",
};

export function StatusBadge({ status, label }: { status: StatusKey; label?: string }) {
    return (
        <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.75 text-12 font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}
        >
            {label || STATUS_LABELS[status]}
        </span>
    );
}

export function Badge({ tone = "progress", children }: { tone?: string; children: ReactNode }) {
    return (
        <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.75 text-12 font-medium whitespace-nowrap ${STATUS_STYLES[tone] || STATUS_STYLES.progress}`}
        >
            {children}
        </span>
    );
}

/* 主按钮 / 次按钮 */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary";
    icon?: string;
}

export function Button({ variant = "primary", icon, children, className = "", ...rest }: ButtonProps) {
    const base =
        "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-btn px-4 text-13 font-medium transition disabled:cursor-not-allowed disabled:opacity-60";
    const styles =
        variant === "primary"
            ? "bg-primary text-white hover:bg-primary-hover"
            : "border border-line-strong bg-white text-ink hover:border-indigo-300 hover:text-primary-strong";
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
            className="text-13 font-medium text-primary-strong underline-offset-2 transition hover:underline"
        >
            {children}
        </button>
    );
}

/* 交付进度条（.ledger-track） */
export function ProgressTrack({ value, done }: { value: number; done?: boolean }) {
    return (
        <div className="h-0.75 w-full max-w-30 overflow-hidden rounded-full bg-[#eef2f6]">
            <div
                className={`h-full rounded-full ${done ? " bg-accent" : "bg-linear-to-r from-indigo-500 to-indigo-400"}`}
                style={{ width: `${Math.min(100, Math.round(value * 100))}%` }}
            />
        </div>
    );
}

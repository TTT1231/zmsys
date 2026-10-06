import type { ButtonHTMLAttributes } from "react";
import { Icon } from "@/lib/icons";

/* 主按钮 / 次按钮；sm = 40px（Modal footer / 筛选面板的原型档），默认 md = 44px */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "danger" | "danger-soft";
    size?: "md" | "sm";
    icon?: string;
}

export function Button({ variant = "primary", size = "md", icon, children, className = "", ...rest }: ButtonProps) {
    const base = `inline-flex ${size === "sm" ? "min-h-10" : "min-h-11"} items-center justify-center gap-1.5 rounded-btn px-4 text-14 font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60`;
    const styles =
        variant === "primary"
            ? "bg-primary text-white hover:bg-primary-hover"
            : variant === "danger"
              ? "bg-danger text-white hover:bg-danger/90"
              : variant === "danger-soft"
                ? /* 详情弹窗 footer 的危险入口：软红底描边，弱于实心 danger 的一级破坏性 */
                  "border border-danger/30 bg-danger-soft text-danger"
                : "border border-line-strong bg-surface text-ink hover:border-primary-border hover:text-primary-strong";
    return (
        <button type="button" className={`${base} ${styles} ${className}`} {...rest}>
            {icon && <Icon name={icon} size={16} />}
            {children}
        </button>
    );
}

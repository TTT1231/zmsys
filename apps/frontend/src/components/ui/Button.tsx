import type { ButtonHTMLAttributes, ReactNode } from "react";
import { extendTailwindMerge } from "tailwind-merge";
import { Icon } from "@/lib/icons";

/* 全站唯一按钮出口（antd Button 式）：形态全走变体枚举，尺寸/内边距/hover/禁用只有这一份定义。
   primary / secondary / danger / danger-soft：实底或描边的动作按钮（弹窗 footer、工具栏、表单提交）；
   ghost：透明底文字操作（弹窗 footer 的次要/危险入口），tone 区分危险语气；
   link：行内文字链接（表格/详情的查看、跳转入口），不带盒子尺寸，字号字色可由 className 覆写；
   iconOnly：纯图标按钮（44px 方形命中区 + 幽灵 hover），紧凑场景用 className 覆写尺寸。 */

/* 项目字号是数字类名（text-14 即 14px），裸 tailwind-merge 分不清它与 text-danger 这类颜色 token
   （会判成同组互相顶掉）；这里把 text-{数字} 归入 font-size 组再合并，作用域仅限本组件 */
const isNumericFontSize = (value: string) => /^\d+(\.\d+)?$/.test(value);
const mergeClasses = extendTailwindMerge({
    extend: { classGroups: { "font-size": [{ text: [isNumericFontSize] }] } },
});

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "danger" | "danger-soft" | "ghost" | "link";
    tone?: "default" | "danger";
    size?: "md" | "sm";
    icon?: string;
    /** 纯图标按钮：无可见文字，必须传 aria-label；focus 环走全局 :focus-visible */
    iconOnly?: boolean;
}

/* sm = 40px（Modal footer / 筛选面板的原型档），默认 md = 44px */
export function Button({
    variant = "primary",
    tone = "default",
    size = "md",
    icon,
    iconOnly = false,
    children,
    className,
    ...rest
}: ButtonProps) {
    const box = iconOnly
        ? "inline-flex size-11 shrink-0 items-center justify-center rounded-btn text-muted transition hover:bg-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
        : variant === "link"
          ? "text-14 font-medium underline-offset-2 transition"
          : `inline-flex ${size === "sm" ? "min-h-10" : "min-h-11"} items-center justify-center gap-1.5 rounded-btn px-4 text-14 font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60`;
    const styles =
        variant === "primary"
            ? "bg-primary text-white hover:bg-primary-hover"
            : variant === "danger"
              ? "bg-danger text-white hover:bg-danger/90"
              : variant === "danger-soft"
                ? /* 详情弹窗 footer 的危险入口：软红底描边，弱于实心 danger 的一级破坏性 */
                  "border border-danger/30 bg-danger-soft text-danger"
                : variant === "ghost"
                  ? tone === "danger"
                      ? "text-danger hover:bg-danger-soft"
                      : "text-muted hover:bg-soft hover:text-ink"
                  : variant === "link"
                    ? tone === "danger"
                        ? "text-danger hover:underline"
                        : "text-primary-strong hover:underline"
                    : "border border-line-strong bg-surface text-ink hover:border-primary-border hover:text-primary-strong";
    return (
        <button type="button" className={mergeClasses(box, styles, className)} {...rest}>
            {icon && <Icon name={icon} size={16} />}
            {children}
        </button>
    );
}

/* 表格内文字链接按钮（兼容出口）：等价于 Button variant="link"，新代码直接用 Button */
export function TableLink({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
    return (
        <Button variant="link" onClick={onClick}>
            {children}
        </Button>
    );
}

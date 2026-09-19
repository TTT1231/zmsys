import type { ReactNode } from "react";

/* 开关行：label 即按钮（点击整行切换），滑块用 translate 过渡；
   role="switch" 语义下 aria-checked 由受控方维护 */
interface SwitchProps {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    children: ReactNode;
}

export function Switch({ checked, onCheckedChange, children }: SwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onCheckedChange(!checked)}
            className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 py-1 text-left text-13.5 text-ink"
        >
            <span className="min-w-0 flex-1">{children}</span>
            <span
                className={`flex h-5.5 w-9.5 shrink-0 items-center rounded-full px-0.5 transition-colors duration-200 ${
                    checked ? "bg-primary" : "bg-line-strong"
                }`}
            >
                <span
                    className={`h-4.5 w-4.5 rounded-full bg-white shadow-xs transition-transform duration-200 ${
                        checked ? "translate-x-4" : "translate-x-0"
                    }`}
                />
            </span>
        </button>
    );
}

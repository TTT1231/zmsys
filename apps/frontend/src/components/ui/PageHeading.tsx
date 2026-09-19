import type { ReactNode } from "react";
import { useContentMaximize } from "@/context/useContentMaximize";
import { Icon } from "@/lib/icons";

interface PageHeadingProps {
    eyebrow?: string;
    title: string;
    description?: string;
    actions?: ReactNode;
    /** 右上角的内容最大化按钮（收起侧边栏与顶栏、表格撑满视口）；非列表页可传 false 关闭 */
    maximizable?: boolean;
}

/* 页头：眉题(主题色，可选) + 大标题 + 动作按钮 + 内容最大化切换 */
export function PageHeading({ eyebrow, title, description, actions, maximizable = true }: PageHeadingProps) {
    const { maximized, toggle } = useContentMaximize();

    return (
        <section className="page-heading flex flex-wrap items-end justify-between gap-4">
            <div className="page-heading-copy">
                {eyebrow && (
                    <div className="text-12 font-semibold tracking-[0.08em] text-primary-strong">{eyebrow}</div>
                )}
                <h1
                    className={`text-[clamp(25px,2.2vw,32px)] leading-tight font-bold tracking-[-0.035em] text-ink ${eyebrow ? "mt-1" : ""}`}
                >
                    {title}
                </h1>
                {description && <p className="mt-1.5 max-w-160 text-13 text-muted">{description}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
                {actions}
                {maximizable && (
                    <button
                        type="button"
                        aria-label={maximized ? "退出内容最大化" : "内容最大化"}
                        aria-pressed={maximized}
                        title={maximized ? "退出内容最大化（Esc）" : "内容最大化：收起侧边栏与顶栏"}
                        onClick={toggle}
                        className="hidden h-10 w-10 items-center justify-center rounded-btn border border-line bg-surface text-muted transition hover:bg-soft hover:text-ink active:scale-90 lg:flex"
                    >
                        <Icon name={maximized ? "minimize" : "maximize"} size={17} />
                    </button>
                )}
            </div>
        </section>
    );
}

import type { ReactNode } from "react";

interface PageHeadingProps {
    eyebrow?: string;
    title: string;
    description?: string;
    actions?: ReactNode;
}

/* 非列表页页头：列表页位置标题由顶栏面包屑承担，业务动作放入表格卡片。 */
export function PageHeading({ eyebrow, title, description, actions }: PageHeadingProps) {
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
            {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
        </section>
    );
}

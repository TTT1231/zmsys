import type { ReactNode } from "react";

interface PageHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

/* 页头：眉题(主题色，可选) + 大标题 + 动作按钮 */
export function PageHeading({ eyebrow, title, description, actions }: PageHeadingProps) {
  return (
    <section className="flex flex-wrap items-end justify-between gap-4">
      <div className="page-heading-copy">
        {eyebrow && <div className="text-[12px] font-semibold tracking-[0.08em] text-primary">{eyebrow}</div>}
        <h1 className={`text-[clamp(25px,2.2vw,32px)] leading-tight font-bold tracking-[-0.035em] text-ink ${eyebrow ? "mt-1" : ""}`}>{title}</h1>
        {description && <p className="mt-1.5 max-w-[640px] text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </section>
  );
}

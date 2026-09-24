import { Icon } from "@/lib/icons";

/** 危险确认弹窗统一的影响卡片；后果、说明和补救动作保持清楚的阅读层级。 */
export function DangerNote({
    impact,
    note,
    action,
    className = "",
}: {
    impact: string;
    note?: string;
    action?: string;
    className?: string;
}) {
    return (
        <div className={`rounded-card border border-danger/20 bg-danger-soft p-4 ${className}`}>
            <div className="flex items-start gap-3">
                <span
                    aria-hidden="true"
                    className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-danger text-white"
                >
                    <Icon name="alert" size={18} strokeWidth={2.1} />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-14 leading-5 font-semibold text-ink">{impact}</p>
                    {note && <p className="mt-1 text-13 leading-5 text-muted">{note}</p>}
                    {action && (
                        <p className="mt-2 flex items-start gap-1.5 border-t border-danger/20 pt-2 text-13 leading-5 font-medium text-danger">
                            <Icon name="chevron-right" size={14} className="mt-0.5 shrink-0" />
                            {action}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

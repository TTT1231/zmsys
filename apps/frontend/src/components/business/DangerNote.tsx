import { Icon } from "@/lib/icons";

/**
 * 危险确认弹窗（作废/删除）的统一影响声明：图标与后果句同行成组，
 * 补充行缩进到文字列起点，不再套底色描边——弹窗本身已是容器，
 * 红色只留给图标与确认按钮，深浅色主题下都不发闷。
 * action 是「被拦截时该怎么办」的出路行：原因（note）与出路分行、箭头引导，
 * 让补救动作从条件说明里跳出来。
 */
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
        <div className={className}>
            <p className="flex items-start gap-1.5 text-13 leading-5 font-semibold text-ink">
                <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-danger" />
                {impact}
            </p>
            {note && <p className="mt-1 pl-5 text-12 leading-5 text-muted">{note}</p>}
            {action && (
                <p className="mt-1 flex items-start gap-1 pl-5 text-12 leading-5 font-medium text-td">
                    <Icon name="chevron-right" size={12} className="mt-0.5 shrink-0 text-subtle" />
                    {action}
                </p>
            )}
        </div>
    );
}

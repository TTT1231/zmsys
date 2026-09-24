import { Icon } from "@/lib/icons";

/**
 * 危险确认弹窗（作废/删除）的统一影响条：一行加粗后果句 + 可选灰字补充。
 * 与 BomRemarkNote 同构（窄条 + alert 图标），把散落的警示散文收进一个视觉块，
 * 全弹窗红色只保留此处软底与确认按钮两处。
 */
export function DangerNote({ impact, note, className = "" }: { impact: string; note?: string; className?: string }) {
    return (
        <div className={`rounded-btn border border-danger/20 bg-danger-soft/50 px-3 py-2.5 ${className}`}>
            <div className="flex gap-2.5">
                <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-danger" />
                <div className="min-w-0">
                    <p className="text-13 leading-5 font-semibold text-ink">{impact}</p>
                    {note && <p className="mt-0.5 text-12 leading-5 text-muted">{note}</p>}
                </div>
            </div>
        </div>
    );
}

/* 交货日期区间筛选（销售订单 / 归档订单共用）：details 摘要按钮 + 窄屏贴底弹层
 * （同 Modal：scrim 关闭 + 顶圆角），宽屏锚定按钮右侧下拉；快捷区间芯片可选 */
import { Icon } from "@/lib/icons";
import { shortDate } from "@/lib/date";
import { Field } from "./Field";
import { Button } from "./Button";

export interface QuickRange {
    label: string;
    start: string;
    end: string;
}

export function DateRangeFilter({
    start,
    end,
    onChange,
    quickRanges,
    label = "交期",
}: {
    start: string;
    end: string;
    /** 任一日期变更（快捷芯片 / 双输入 / 清除）；分页回 1、作废手动行序等页面联动在此处理 */
    onChange: (next: { start: string; end: string }) => void;
    /** 快捷区间芯片（销售订单页专属） */
    quickRanges?: QuickRange[];
    /** 摘要按钮的无值文案 */
    label?: string;
}) {
    const active = !!start || !!end;
    const summary =
        start && end
            ? `${label}：${shortDate(start)}–${shortDate(end)}`
            : start
              ? `${label}：${shortDate(start)} 起`
              : end
                ? `${label}：至 ${shortDate(end)}`
                : label;
    const close = (event: { currentTarget: Element }) =>
        event.currentTarget.closest("details")?.removeAttribute("open");

    return (
        <details className="relative">
            <summary
                className={`flex h-10 list-none items-center gap-1.5 rounded-btn px-3 text-14 transition ${
                    active ? "bg-primary-soft text-primary-strong" : "text-ink hover:text-primary-strong"
                }`}
            >
                <Icon name="calendar" size={15} />
                {summary}
            </summary>
            {/* 移动端贴底弹层（同 Modal：scrim 关闭 + 顶圆角），宽屏锚定按钮右侧下拉；
                section 有 overflow-hidden，下拉面板在窄屏会被裁剪，故窄屏走 fixed 贴底 */}
            <div
                className="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px] lg:hidden"
                onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}
            />
            <div className="absolute top-12 right-0 z-50 grid w-75 grid-cols-1 gap-2 rounded-xl border border-line bg-surface p-3 shadow-modal max-lg:fixed max-lg:inset-x-0 max-lg:top-auto max-lg:bottom-0 max-lg:left-0 max-lg:w-auto max-lg:gap-3 max-lg:rounded-b-none max-lg:rounded-t-[22px] max-lg:border-x-0 max-lg:border-b-0 max-lg:p-4 max-lg:pb-[max(16px,env(safe-area-inset-bottom))]">
                <div className="flex items-center justify-between lg:hidden">
                    <span className="text-14 font-semibold text-ink">按交货日期筛选</span>
                    <Button iconOnly aria-label="关闭" onClick={close} className="size-9 rounded-full">
                        <Icon name="close" size={16} />
                    </Button>
                </div>
                {quickRanges && quickRanges.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {quickRanges.map(item => {
                            const chipActive = start === item.start && end === item.end;
                            return (
                                <button
                                    type="button"
                                    key={item.label}
                                    aria-pressed={chipActive}
                                    onClick={() => onChange({ start: item.start, end: item.end })}
                                    className={`min-h-8 rounded-full border px-3 text-13 font-medium transition ${
                                        chipActive
                                            ? "border-primary-border bg-primary-soft text-primary-strong"
                                            : "border-line-strong bg-surface text-muted hover:text-primary-strong"
                                    }`}
                                >
                                    {item.label}
                                </button>
                            );
                        })}
                    </div>
                )}
                <Field label="开始">
                    <input
                        type="date"
                        value={start}
                        onChange={event => onChange({ start: event.target.value, end })}
                        className="w-full rounded-input border border-line-strong px-2.5 py-2 text-14"
                    />
                </Field>
                <Field label="结束">
                    <input
                        type="date"
                        value={end}
                        onChange={event => onChange({ start, end: event.target.value })}
                        className="w-full rounded-input border border-line-strong px-2.5 py-2 text-14"
                    />
                </Field>
                <div className="flex gap-2">
                    {active && (
                        <Button
                            size="sm"
                            variant="secondary"
                            icon="reset"
                            className="flex-1"
                            onClick={() => onChange({ start: "", end: "" })}
                        >
                            清除
                        </Button>
                    )}
                    <Button size="sm" className="flex-1" onClick={close}>
                        完成筛选
                    </Button>
                </div>
            </div>
        </details>
    );
}

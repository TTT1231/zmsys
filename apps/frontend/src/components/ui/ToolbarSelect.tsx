const DEFAULT_LABELS: Record<string, string> = {
    全部状态: "状态",
    全部品类: "品类",
    全部登记人: "登记人",
    全部操作人: "登记人",
    全部操作: "操作",
};

/** 展示名称与筛选值分离，短文案不改变既有查询语义。 */
export function ToolbarSelect({
    value,
    onChange,
    label,
    options,
    className = "",
}: {
    value: string;
    onChange: (value: string) => void;
    /** 无障碍名（aria-label） */
    label: string;
    options: Array<string | { value: string; label: string }>;
    /** 追加类（如 max-lg:hidden：移动端不进该筛选的页面用它整控件隐藏） */
    className?: string;
}) {
    return (
        <select
            value={value}
            onChange={event => onChange(event.target.value)}
            aria-label={label}
            className={`h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink ${className}`}
        >
            {options.map(option => {
                const value = typeof option === "string" ? option : option.value;
                const label = typeof option === "string" ? (DEFAULT_LABELS[option] ?? option) : option.label;
                return (
                    <option key={value} value={value}>
                        {label}
                    </option>
                );
            })}
        </select>
    );
}

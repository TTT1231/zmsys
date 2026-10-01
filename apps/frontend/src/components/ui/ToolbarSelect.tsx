/** 工具栏筛选下拉：选项即值（label === value），类串与各列表页原实现逐字一致 */
export function ToolbarSelect({
    value,
    onChange,
    label,
    options,
}: {
    value: string;
    onChange: (value: string) => void;
    /** 无障碍名（aria-label） */
    label: string;
    options: string[];
}) {
    return (
        <select
            value={value}
            onChange={event => onChange(event.target.value)}
            aria-label={label}
            className="h-10 rounded-btn border border-line-strong bg-surface px-3 text-14 text-ink"
        >
            {options.map(option => (
                <option key={option}>{option}</option>
            ))}
        </select>
    );
}

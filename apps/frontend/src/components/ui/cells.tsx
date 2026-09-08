import { num } from "@/lib/format";
import { Badge, TableLink } from "@/components/ui/Badge";

/* 表格单元格：客户/单号双行 */
export function CustomerCell({ name, sub, onClick }: { name: string; sub?: string; onClick?: () => void }) {
    const nameNode = onClick ? (
        <button
            type="button"
            onClick={onClick}
            className="font-medium text-ink underline-offset-2 hover:text-primary hover:underline"
        >
            {name}
        </button>
    ) : (
        <span className="font-medium text-ink">{name}</span>
    );
    return (
        <div className="min-w-0">
            <div className="truncate">{nameNode}</div>
            {sub && <div className="tnum mt-0.5 truncate text-[11.5px] text-[#475467]">{sub}</div>}
        </div>
    );
}

/* 数量单元格 */
export function QtyCell({ value, unit, danger }: { value: number; unit?: string; danger?: boolean }) {
    return (
        <span className={`tnum text-[13px] font-bold ${danger ? "text-danger" : "text-ink"}`}>
            {num(value)}
            {unit && <i className="ml-0.5 text-[11px] font-normal text-subtle not-italic">{unit}</i>}
        </span>
    );
}

/* 日期单元格（可带已逾期徽章） */
export function DateCell({ date, overdue }: { date: string; overdue?: boolean }) {
    return (
        <span className="tnum inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap text-td">
            {date}
            {overdue && <Badge tone="danger">已逾期</Badge>}
        </span>
    );
}

export { TableLink };

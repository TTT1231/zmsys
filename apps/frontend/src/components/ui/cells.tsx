import { num } from "@/lib/format";
import { Badge, TableLink } from "@/components/ui/Badge";

/* 表格单元格：客户/单号双行；note 是低频编码（如客户编码），紧凑档随 customer-cell-note 隐藏；
   remark 是订单备注行（虚线分隔的正文小字），紧凑档随 remark-sub-note 隐藏（全文走 title/详情） */
export function CustomerCell({
    name,
    sub,
    note,
    remark,
    onClick,
}: {
    name: string;
    sub?: string;
    note?: string;
    remark?: string;
    onClick?: () => void;
}) {
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
    const subText = [sub, note].filter(Boolean).join(" · ");
    const remarkText = remark?.trim();
    return (
        <div className="customer-cell min-w-0">
            <div className="truncate" title={name}>
                {nameNode}
            </div>
            {(sub || note) && (
                <div className="customer-cell-sub tnum mt-0.5 truncate text-12 text-td-strong" title={subText}>
                    {sub}
                    {note && (
                        <span className="customer-cell-note">
                            {sub ? " · " : ""}
                            {note}
                        </span>
                    )}
                </div>
            )}
            {remarkText && (
                <div
                    className="remark-sub-note mt-1 truncate border-t border-dashed border-line pt-0.5 text-12 text-td"
                    title={remarkText}
                >
                    {remarkText}
                </div>
            )}
        </div>
    );
}

/* 数量单元格 */
export function QtyCell({ value, unit, danger }: { value: number; unit?: string; danger?: boolean }) {
    return (
        <span className={`tnum text-14 font-bold ${danger ? "text-danger" : "text-ink"}`}>
            {num(value)}
            {unit && <i className="ml-0.5 text-12 font-normal text-subtle not-italic">{unit}</i>}
        </span>
    );
}

/* 日期单元格（可带已逾期徽章） */
export function DateCell({ date, overdue }: { date: string; overdue?: boolean }) {
    return (
        <span className="tnum inline-flex flex-wrap items-center gap-1.5 text-14 text-td">
            <span className="whitespace-nowrap">{date}</span>
            {overdue && <Badge tone="danger">已逾期</Badge>}
        </span>
    );
}

export { TableLink };

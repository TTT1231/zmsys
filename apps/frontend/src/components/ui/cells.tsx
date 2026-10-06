import { num } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

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
        <Button variant="link" onClick={onClick} className="text-ink hover:text-primary">
            {name}
        </Button>
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
                <div className="remark-sub-note mt-0.5 truncate text-12 text-td" title={remarkText}>
                    {remarkText}
                </div>
            )}
        </div>
    );
}

/* 数量单元格：tone 是可选语义字色档（如订单库存列 缺货/不足/充裕），不传保持正文色 */
export function QtyCell({
    value,
    unit,
    tone,
}: {
    value: number;
    unit?: string;
    tone?: "success" | "warning" | "danger";
}) {
    const toneClass =
        tone === "success"
            ? "text-success"
            : tone === "warning"
              ? "text-warning"
              : tone === "danger"
                ? "text-danger"
                : "text-ink";
    return (
        <span className={`tnum text-14 font-bold ${toneClass}`}>
            {num(value)}
            {unit && <i className="ml-0.5 text-12 font-normal text-subtle not-italic">{unit}</i>}
        </span>
    );
}

/* 日期单元格（可带已逾期徽章）：日期与徽章上下两行，比挤一行更直观清爽 */
export function DateCell({ date, overdue }: { date: string; overdue?: boolean }) {
    return (
        <span className="tnum inline-flex flex-col items-start gap-1 text-14 text-td">
            <span className="whitespace-nowrap">{date}</span>
            {overdue && <Badge tone="danger">已逾期</Badge>}
        </span>
    );
}

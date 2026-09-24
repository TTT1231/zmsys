/* 表格空态占位行：row-empty 把本行排除出行悬停，并配合 :has() 让表格撑满表体视口高度、内容居中（见 index.css）。
   在 DataTable 内使用时 colSpan 会被克隆改写为实际渲染列数（含弹性填充列）；独立挂在裸表格上时按列数传入。
   imageSize：小面板/弹窗明细表传 120，整页列表用默认 160（透传 EmptyState） */
import { EmptyState } from "./EmptyState";

export function EmptyRow({
    colSpan = 1,
    description,
    imageSize,
}: {
    colSpan?: number;
    description: string;
    imageSize?: number;
}) {
    return (
        <tr className="row-empty">
            <td colSpan={colSpan} className="py-10 text-center">
                <EmptyState description={description} imageSize={imageSize} />
            </td>
        </tr>
    );
}

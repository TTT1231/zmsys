/**
 * 表格内备注单元格（全站统一出口）：两种视觉语义覆盖四类备注。
 *
 * 语义规范（改备注样式只改这里，勿在页面内联手写）：
 * - variant="warning"：工艺警示语义，仅 BOM 备注（同构成不同备注 = 不同 BOM）。
 *   橙色 + font-medium，不放图标——列头即警示语境；图标属弹窗块级警示条 BomRemarkNote。
 * - variant="plain"：普通业务备注（订单备注 / 出库备注）。
 * - 空值渲染占位符不挂 title；非空悬停看全文，「查看详情」弹窗为完整出口。
 *
 * 密度与作废行由 index.css 统一驱动，组件零感知：
 * - 标准 2 行 / 宽松 3 行（.remark-clamp 规则）；紧凑账本档全局单行（td nowrap + 收纳规则）
 * - 作废行（.row-voided）内警示自动降级为灰字，内容保留
 *
 * 各页备注列清单（验收回归对照）：
 * | 页面      | 列头     | variant | 数据                         |
 * | 销售订单  | BOM 备注 | warning | bomByCode(snap, ...)?.remark |
 * | 成品出库  | BOM 备注 | warning | bomByCode(snap, ...)?.remark |
 * | 成品出库  | 出库备注 | plain   | row.remark                   |
 * | 成品入库  | BOM 备注 | warning | bomByCode(snap, ...)?.remark |
 * | 库存      | BOM 备注 | warning | row.remark                   |
 * | 物料与BOM | BOM 备注 | warning | bom.remark                   |
 * | 销售订单  | 订单备注 | plain   | order.remark                 |
 * | 归档订单  | 订单备注 | plain   | order.remark                 |
 */
export function RemarkCell({ remark, variant = "plain" }: { remark?: string | null; variant?: "warning" | "plain" }) {
    const text = remark?.trim();
    if (!text) return <span className="text-placeholder">—</span>;
    return (
        <span
            title={text}
            className={`remark-cell remark-clamp line-clamp-2 whitespace-pre-line leading-5 ${
                variant === "warning" ? "font-medium text-warning" : "text-td"
            }`}
        >
            {text}
        </span>
    );
}

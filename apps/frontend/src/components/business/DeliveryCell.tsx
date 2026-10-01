import { ProgressTrack } from "@/components/ui/Badge";
import { QtyCell } from "@/components/ui/cells";
import { num } from "@/lib/format";
import { remainingOf } from "@/data/views";
import type { Order } from "@/api";

/** 交付情况单元格（订单桌面表格）：已发满只留绿色满条（悬停 title 兜底语义），有欠量才展开明细。
 *  完成判定用累计已发 ≥ 订单量——归档单 remainingOf 恒为 0，不能用欠量判完成 */
export function DeliveryCell({ order }: { order: Order }) {
    return (
        <td className="delivery-cell">
            {order.outbound >= order.qty ? (
                <div className="delivery-track" title="已全部交付">
                    <ProgressTrack value={1} done />
                </div>
            ) : (
                <>
                    <div className="text-13 text-muted">
                        待交 <QtyCell value={remainingOf(order)} />
                    </div>
                    <div className="delivery-shipped tnum mt-0.5 text-12 text-muted">
                        已发 {num(order.outbound)} / {num(order.qty)}
                    </div>
                    <div className="delivery-track mt-1.5">
                        <ProgressTrack value={order.qty === 0 ? 0 : order.outbound / order.qty} />
                    </div>
                </>
            )}
        </td>
    );
}

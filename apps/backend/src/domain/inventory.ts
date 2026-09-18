import { ConflictException } from "@nestjs/common";
import type { Tx } from "../prisma/transaction.runner";

/**
 * 库存与可发量（db-scheme.md §6.2）：同一 BOM 的库存由全部活动订单共享，
 * 计算与落库必须处于同一事务且已持有该 BOM 行锁；不得信任前端传入的
 * 库存、累计已发或客户名称。
 */

/** BOM 当前库存：有效入库 + 库存调整 − 有效出库（v_bom_stock，无行则 0） */
export async function getStockQty(tx: Tx, bomId: bigint): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ stock_qty: bigint | number }>>`
        SELECT stock_qty FROM v_bom_stock WHERE bom_id = ${bomId}
    `;
    return rows.length === 0 ? 0 : Number(rows[0]!.stock_qty);
}

interface ActiveOrderRow {
    id: bigint;
    /** INT UNSIGNED 经原生查询可能映射为 BigInt（driver 决定），统一显式转换 */
    qty: number | bigint;
    outbound_qty: bigint | number;
}

/**
 * §6.2 出库可发量分配：活动订单按交货截止日期升序、同日按订单号升序，
 * 从库存池依次分配（每单最多 `qty − 有效出库净额`），返回目标订单本次
 * 最多可发数量；请求量超出分配额抛 409（客户端刷新后重试）。
 * 目标订单不在活动列表（不存在/已取消）同样 409。
 */
export async function computeShippableQty(
    tx: Tx,
    params: {
        bomId: bigint;
        targetOrderId: bigint;
        requestedQty: number;
    },
): Promise<number> {
    if (params.requestedQty <= 0) {
        throw new ConflictException("发货数量必须大于 0");
    }
    const orders = await tx.$queryRaw<ActiveOrderRow[]>`
        SELECT o.id, o.qty, COALESCE(v.outbound_qty, 0) AS outbound_qty
        FROM sales_order_table AS o
        LEFT JOIN v_order_outbound_qty AS v ON v.order_id = o.id
        WHERE o.bom_id = ${params.bomId} AND o.lifecycle_status = 'ACTIVE'
        ORDER BY o.deliver_date ASC, o.order_no ASC
    `;
    let pool = await getStockQty(tx, params.bomId);
    for (const order of orders) {
        const remaining = Math.max(Number(order.qty) - Number(order.outbound_qty), 0);
        if (order.id === params.targetOrderId) {
            const allowance = Math.min(pool, remaining);
            if (params.requestedQty > allowance) {
                throw new ConflictException("库存可发量不足，请刷新后重试");
            }
            return allowance;
        }
        pool -= remaining;
    }
    throw new ConflictException("目标订单不存在或已取消");
}

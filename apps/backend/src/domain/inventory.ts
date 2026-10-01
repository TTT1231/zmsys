import { ConflictException } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import type { Tx } from "../prisma/transaction.runner";

/**
 * 库存与可发量（db-scheme.md §6.2）：同一 BOM 的库存由全部活动订单共享，
 * 计算与落库必须处于同一事务且已持有该 BOM 行锁；不得信任前端传入的
 * 库存、累计已发或客户名称。
 */

/** 可执行原生视图查询的最小客户端：PrismaService（列表页）与事务 Tx（锁内）均满足 */
type RawQueryDb = Pick<Prisma.TransactionClient, "$queryRaw">;

/** BOM 当前库存：有效入库 + 库存调整 − 有效出库（v_bom_stock，无行则 0） */
export async function getStockQty(tx: Tx, bomId: bigint): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ stock_qty: bigint | number }>>`
        SELECT stock_qty FROM v_bom_stock WHERE bom_id = ${bomId}
    `;
    return rows.length === 0 ? 0 : Number(rows[0]!.stock_qty);
}

/** v_bom_stock 按 bom_code 的库存映射（boms 列表/工作台共用）；无流水的 BOM 不在视图，缺行按 0 */
export async function stockByBomCodeMap(db: RawQueryDb): Promise<Map<string, number>> {
    const rows = await db.$queryRaw<Array<{ bom_code: string; stock_qty: bigint | number }>>`
        SELECT b.bom_code, v.stock_qty
        FROM v_bom_stock AS v
        JOIN bom_table AS b ON b.id = v.bom_id
    `;
    return new Map(rows.map(row => [row.bom_code, Number(row.stock_qty)]));
}

/** v_order_outbound_qty 全量映射（订单列表/工作台共用）；无流水订单不在视图，缺行按 0 理解 */
export async function outboundQtyByOrderMap(db: RawQueryDb): Promise<Map<bigint, number>> {
    const rows = await db.$queryRaw<Array<{ order_id: bigint; outbound_qty: bigint | number }>>`
        SELECT order_id, outbound_qty FROM v_order_outbound_qty
    `;
    return new Map(rows.map(row => [row.order_id, Number(row.outbound_qty)]));
}

/** 单订单有效出库净额（锁内事务路径）：v_order_outbound_qty 统一口径，无流水视为 0（db-scheme.md §7.2） */
export async function outboundNetOf(tx: Tx, orderId: bigint): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ outbound_qty: bigint | number }>>`
        SELECT outbound_qty FROM v_order_outbound_qty WHERE order_id = ${orderId}
    `;
    return rows[0] ? Number(rows[0].outbound_qty) : 0;
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
        WHERE o.bom_id = ${params.bomId} AND o.lifecycle_status = 'ACTIVE' AND o.deleted_at IS NULL
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

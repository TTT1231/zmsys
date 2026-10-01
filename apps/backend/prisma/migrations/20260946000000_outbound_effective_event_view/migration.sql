-- 有效出库净额口径收敛（db-scheme.md §6/§7.2）：此前"有效出库净额"两种惯用法并存——
-- v_order_outbound_qty / v_bom_stock / 工作台 movements 对出库事件全量求和，依赖
-- "作废 = NORMAL + 等额 CORRECTION 冲销"的零和不变量（无代码强制）把作废单抵消为 0；
-- BOM 台账流水的出库臂却显式 `deleted_at IS NULL AND state = 'REGISTERED'`。引入部分
-- 冲销或放宽删除前置时，两边会向相反方向无声漂移。本迁移：
-- ① 新建 v_outbound_effective_event 承载显式判据：未软删出库单的全部台账事件
--   （不按 state 过滤——作废单净额 = NORMAL + CORRECTION，未来部分冲销时其残值
--   即实际出库，按 REGISTERED 过滤会把残值滤丢）；
-- ② v_order_outbound_qty / v_bom_stock 出库臂改为从该视图取数；
-- ③ v_bom_stock 入库臂显式补 `deleted_at IS NULL`（软删行必为 VOIDED，数值等价的
--   防御性收敛，与出库臂判据对称）。
-- 等价性：软删出库单仅可为 VOIDED（删除前置约束），其事件净和为 0，显式排除后
-- 各视图数值与重建前完全一致；同时新增 shipment_no/operator/remark/customer 展示列，
-- 台账流水与工作台 movements 的出库臂统一改从本视图取数（见服务层同步改动）。

CREATE SQL SECURITY INVOKER VIEW v_outbound_effective_event AS
SELECT
    shipment.shipment_no,
    shipment.order_id,
    sales_order.bom_id,
    event.entry_type,
    event.qty_delta,
    event.business_date,
    event.created_at,
    operator.name AS operator,
    -- 冲销行展示作废原因（台账流水的备注列），正常行展示发货备注
    CASE WHEN event.entry_type = 'CORRECTION' THEN event.correction_reason ELSE event.remark END AS remark,
    sales_order.customer_name_snapshot AS customer
FROM outbound_ledger AS event
JOIN outbound_shipment AS shipment ON shipment.id = event.shipment_id
JOIN sales_order_table AS sales_order ON sales_order.id = shipment.order_id
JOIN sys_user AS operator ON operator.id = event.operator_id
WHERE shipment.deleted_at IS NULL;

DROP VIEW v_order_outbound_qty;
CREATE SQL SECURITY INVOKER VIEW v_order_outbound_qty AS
SELECT
    event.order_id,
    COALESCE(SUM(event.qty_delta), 0) AS outbound_qty
FROM v_outbound_effective_event AS event
GROUP BY event.order_id;

DROP VIEW v_bom_stock;
CREATE SQL SECURITY INVOKER VIEW v_bom_stock AS
SELECT movement.bom_id, SUM(movement.qty_delta) AS stock_qty
FROM (
    SELECT inbound.bom_id, CAST(inbound.qty AS SIGNED) AS qty_delta
    FROM inbound_ledger AS inbound
    WHERE inbound.status = 'ACTIVE' AND inbound.deleted_at IS NULL
    UNION ALL
    SELECT adjustment.bom_id, adjustment.qty_delta
    FROM stock_adjustment AS adjustment
    UNION ALL
    SELECT event.bom_id, -event.qty_delta AS qty_delta
    FROM v_outbound_effective_event AS event
) AS movement
GROUP BY movement.bom_id;

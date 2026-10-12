-- 三类单据删除由软删除改为物理硬删除，拆除软删机制（2026-10-12，业务定论）：
-- 动机：两次生产事故（XK2014 2026-10-05、KWO003 2026-10-10）——"未使用"BOM 删除报
-- 409，排查后均系软删订单物理占着 fk_sales_order_bom 外键（界面全局过滤不可见，
-- deleteBom 的 raw 计数按物理行算）。业务确认：删错单据直接重建、不做回收站
-- （过度设计），系统本无软删恢复通道；7 天保留期仅对"悔期内还有已删出库单挂
-- 外键/有编辑历史"的单据有实际意义。故：
--   ① deleteOrder/deleteInbound/deleteOutbound 改为事务内物理删除（子行同删，
--      顺序与本迁移 A 段一致），op_log 的 delete_* 快照是删除后唯一审计残留；
--   ② 三表 deleted_at 列、idx_*_deleted 索引、全局软删过滤（prisma-extensions）
--      与 7 天清理任务（LedgerPurgeService，退役为幂等记录清理）一并移除。
--
-- 本迁移三段顺序不可换：
--   A) DML 存量软删行物理清理（事务内）：口径逐句对齐退役前的 LedgerPurgeService
--      三臂（出库→入库→订单的臂序 = 外键依赖序：软删订单名下可能仍有软删出库单，
--      先清出库臂，订单臂的 NOT EXISTS 只剩活动出库防御）。防御条件：
--      入库臂 NOT EXISTS stock_adjustment.related_inbound_id（调整单不可变，引用中
--      的入库单永不删）；订单臂 NOT EXISTS outbound_shipment.order_id。
--      生产实测（2026-10-10）：软删订单 1 张（无出库）、软删入库 5 张（全 VOIDED、
--      全无调整单引用）、软删出库 0 张——三臂全量命中、NOT EXISTS 防御零跳过。
--   B) 残留断言（仍在事务内）：被 NOT EXISTS 跳过的行若放任删列，会在界面"复活"
--      （软删过滤随列一起消失）——宁可响亮失败：残留 > 0 时 EXECUTE 命中不存在的
--      断言表报 1146 中止脚本，断连回滚 A 段、_prisma_migrations 无记录、backend
--      起不来（容器 CMD migrate deploy && node），人工清掉被引用软删行后重部署即可。
--   C) 视图重建 → DDL 删列：v_outbound_effective_event/v_bom_stock 旧定义引用
--      deleted_at，先按新定义重建（数值与重建前恒等：被滤掉的行已物理清空），
--      再 DROP 三表列与索引。
--
-- 幂等/重放论证：A 段条件含 deleted_at IS NOT NULL，未遂重放 0 行；B 段断言重放
-- 仍成立；C 段视图 DROP+CREATE 幂等；唯 DDL 部分应用后重放报 1091（列不存在），
-- 属 prisma migrations 单向执行语义下的既定人工介入路径（与视图/数据修正型迁移
-- 同惯例）。测试库（*_test）重放：空库/无软删行时 A 段 0 行空转，列由链上
-- 20260940000000/20260941000000 先加后删，链一致。
-- MySQL DDL 隐式提交：A/B 段包事务，C/D 段各语句自提交；部署停机窗口执行无并发。

START TRANSACTION;

-- A1 出库臂：状态日志 → CORRECTION（子）→ NORMAL（父）→ 单头；出库单头无外部
-- 表引用（order 外键方向为 shipment→order），无条件清理
DELETE osl FROM outbound_state_log osl
JOIN outbound_shipment os ON os.id = osl.shipment_id
WHERE os.deleted_at IS NOT NULL;
DELETE ol FROM outbound_ledger ol
JOIN outbound_shipment os ON os.id = ol.shipment_id
WHERE os.deleted_at IS NOT NULL AND ol.correction_of_id IS NOT NULL;
DELETE ol FROM outbound_ledger ol
JOIN outbound_shipment os ON os.id = ol.shipment_id
WHERE os.deleted_at IS NOT NULL;
DELETE os FROM outbound_shipment os
WHERE os.deleted_at IS NOT NULL;

-- A2 入库臂：变更日志子行 → 行（口径同 purgeInbound：被调整单引用的行跳过，
-- 由 B 段断言兜底——存量脏数据防御，生产实测为 0）
DELETE icl FROM inbound_change_log icl
JOIN inbound_ledger il ON il.id = icl.inbound_id
WHERE il.deleted_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM stock_adjustment sa WHERE sa.related_inbound_id = il.id);
DELETE il FROM inbound_ledger il
WHERE il.deleted_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM stock_adjustment sa WHERE sa.related_inbound_id = il.id);

-- A3 订单臂：变更日志子行 → 行（口径同 purgeOrders：A1 已清软删出库，
-- NOT EXISTS 只剩活动出库防御——源头不可能命中，保防御姿态）
DELETE scl FROM sales_order_change_log scl
JOIN sales_order_table so ON so.id = scl.order_id
WHERE so.deleted_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM outbound_shipment os WHERE os.order_id = so.id);
DELETE so FROM sales_order_table so
WHERE so.deleted_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM outbound_shipment os WHERE os.order_id = so.id);

-- B 残留断言：三表软删残留必须为 0，否则中止回滚（防"删列后复活"）
SET @soft_delete_residue := (
    SELECT (SELECT COUNT(*) FROM sales_order_table WHERE deleted_at IS NOT NULL)
         + (SELECT COUNT(*) FROM inbound_ledger WHERE deleted_at IS NOT NULL)
         + (SELECT COUNT(*) FROM outbound_shipment WHERE deleted_at IS NOT NULL)
);
SET @residue_check := IF(@soft_delete_residue = 0,
    'SELECT ''soft-delete residue = 0'' AS assertion',
    'SELECT ''soft-delete residue > 0: referenced rows remain, aborting'' AS assertion
       FROM assert_soft_delete_residue_nonzero');
PREPARE residue_stmt FROM @residue_check;
EXECUTE residue_stmt;
DEALLOCATE PREPARE residue_stmt;

COMMIT;

-- C 视图重建（新定义不再引用 deleted_at；与旧视图数值恒等——被滤行已物理清空）
DROP VIEW v_order_outbound_qty;
DROP VIEW v_bom_stock;
DROP VIEW v_outbound_effective_event;
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
JOIN sys_user AS operator ON operator.id = event.operator_id;

CREATE SQL SECURITY INVOKER VIEW v_order_outbound_qty AS
SELECT
    event.order_id,
    COALESCE(SUM(event.qty_delta), 0) AS outbound_qty
FROM v_outbound_effective_event AS event
GROUP BY event.order_id;

CREATE SQL SECURITY INVOKER VIEW v_bom_stock AS
SELECT movement.bom_id, SUM(movement.qty_delta) AS stock_qty
FROM (
    SELECT inbound.bom_id, CAST(inbound.qty AS SIGNED) AS qty_delta
    FROM inbound_ledger AS inbound
    WHERE inbound.status = 'ACTIVE'
    UNION ALL
    SELECT adjustment.bom_id, adjustment.qty_delta
    FROM stock_adjustment AS adjustment
    UNION ALL
    SELECT event.bom_id, -event.qty_delta AS qty_delta
    FROM v_outbound_effective_event AS event
) AS movement
GROUP BY movement.bom_id;

-- D 删列删索引（软删机制物理终结）
ALTER TABLE sales_order_table DROP KEY idx_sales_order_deleted, DROP COLUMN deleted_at;
ALTER TABLE inbound_ledger DROP KEY idx_inbound_deleted, DROP COLUMN deleted_at;
ALTER TABLE outbound_shipment DROP KEY idx_outbound_deleted, DROP COLUMN deleted_at;

-- 物理删除作废出库单 CK26092213 及其全部关联日志（业务数据修正，超管确认）：
-- 2026-09-22 登记数量 2100 有误（void_reason=数量不对），登记 8 分钟后作废；
-- 台账 NORMAL +2100 / CORRECTION -2100 净值为 0，不触及任何库存口径
-- （v_bom_stock / v_order_outbound_qty 实时计算），订单 227700173701124096 不受影响。
-- 关联数据链（生产实测 2026-09-28）：
--   outbound_shipment 1 行（id=228005152458543104，VOIDED）
--   outbound_ledger 2 行（E1 NORMAL / E2 CORRECTION 冲销）
--   outbound_state_log 2 行（REGISTER + VOID_PRE_PRINT）
--   op_log 1 行（ship 里程碑）
--   api_idempotency 2 行（outbound:create / outbound:void:CK26092213，均已过期）
-- 语句按外键依赖排序（冲销行先于正常行，correction_of 自引用）；以 shipment_no 定位，
-- 测试库无此单据，重放全部 0 行幂等；单号序列不回退，CK26092213 永不复用。

-- 1. 幂等记录（短期缓存，永不入备份，随单据一并清理）
DELETE FROM `api_idempotency` WHERE `resource_code` = 'CK26092213';

-- 2. 业务里程碑日志（无外键，逻辑关联）
DELETE FROM `op_log` WHERE `target_type` = 'outbound' AND `target_code` = 'CK26092213';

-- 3. 出库状态机日志（FK → outbound_shipment）
DELETE FROM `outbound_state_log`
WHERE `shipment_id` = (SELECT `id` FROM `outbound_shipment` WHERE `shipment_no` = 'CK26092213');

-- 4. 出库台账：先冲销行再正常行（correction_of 自引用 FK）
DELETE FROM `outbound_ledger`
WHERE `entry_type` = 'CORRECTION'
  AND `shipment_id` = (SELECT `id` FROM `outbound_shipment` WHERE `shipment_no` = 'CK26092213');
DELETE FROM `outbound_ledger`
WHERE `shipment_id` = (SELECT `id` FROM `outbound_shipment` WHERE `shipment_no` = 'CK26092213');

-- 5. 单头（限定 VOIDED，防御同名活跃单）
DELETE FROM `outbound_shipment` WHERE `shipment_no` = 'CK26092213' AND `state` = 'VOIDED';

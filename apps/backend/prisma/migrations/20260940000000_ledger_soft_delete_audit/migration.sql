-- 出入库已作废单软删除 + op_log 审计覆盖统一化（db-scheme.md §7/§7.1）：
-- 已作废的入库/出库单可由仓管/超管"删除"——台账行打 deleted_at 标记（7 天后悔期，
-- 期间 DBA 可手工恢复），列表接口过滤；7 天后由 maintenance 定时任务物理清理
-- （连带 changeLog/stateLog/数量流水同删，op_log 的 delete 快照成为唯一残留）。
-- op_log 按审计清单补齐动作：入库创建/作废/删除、出库作废/删除、BOM 创建、客户更新。
-- 本迁移：
-- ① 两张台账加 deleted_at 列 + 单列索引（服务清理查询与列表过滤）；
-- ② op_log.action 枚举扩充 7 值（旧值全部保留给存量行）；
-- ③ uk_op_log_action_target 降为普通索引——update_customer 同一目标可多次记录，
--   唯一键防重职责归还幂等层（业务操作本就经 idempotency 表防重放）；
-- ④ 权限目录：inbound:delete/outbound:delete（非受保护，默认 BOOTSTRAP 授仓管，
--   超管可按需授予其他角色）与 inbound:void-any-day（受保护，仅超管 bypass 持有）。
-- 设计说明：
-- ① 全部语句为纯增量（加列/扩枚举/换索引类型/INSERT seed），无数据改写无破坏性；
-- ② 软删除行不参与任何统计（v_bom_stock 只计 ACTIVE，出库 NORMAL+CORRECTION 零和），
--   视图与 workbench SQL 零改动；
-- ③ deleteBom 的入库流水校验保持不过滤软删除行——与 fk_inbound_bom 的
--   ON DELETE RESTRICT 口径一致，BOM 待物理清理后自然放行。

-- 1. 台账软删除列 + 索引
ALTER TABLE `inbound_ledger`
    ADD COLUMN `deleted_at` DATETIME(3) NULL AFTER `updated_at`,
    ADD KEY `idx_inbound_deleted` (`deleted_at`);

ALTER TABLE `outbound_shipment`
    ADD COLUMN `deleted_at` DATETIME(3) NULL AFTER `voided_at`,
    ADD KEY `idx_outbound_deleted` (`deleted_at`);

-- 2. op_log 动作枚举扩充（列全量值，旧值保留）
ALTER TABLE `op_log`
    MODIFY COLUMN `action` ENUM(
        'ship', 'create_customer', 'create_order', 'delete_order', 'delete_bom', 'archive_order',
        'create_inbound', 'void_inbound', 'delete_inbound',
        'void_outbound', 'delete_outbound',
        'create_bom', 'update_customer'
    ) NOT NULL;

-- 3. uk 降普通索引（update_customer 允许同目标多条；防重由幂等层承担）
ALTER TABLE `op_log`
    DROP INDEX `uk_op_log_action_target`,
    ADD KEY `idx_op_log_action_target` (`action`, `target_id`);

-- 4. 权限目录与默认授权
INSERT INTO `sys_permission` (`code`, `kind`, `menu_key`, `action_id`, `label`, `protected`) VALUES
    ('inbound:delete', 'ACTION', 'inbound', 'delete', '删除入库记录', 0),
    ('outbound:delete', 'ACTION', 'outbound', 'delete', '删除出库记录', 0),
    ('inbound:void-any-day', 'ACTION', 'inbound', 'void-any-day', '跨天作废入库', 1);

INSERT INTO `sys_grant` (`role_code`, `permission_code`, `grant_source`, `granted_by`) VALUES
    ('warehouse', 'inbound:delete', 'BOOTSTRAP', NULL),
    ('warehouse', 'outbound:delete', 'BOOTSTRAP', NULL);

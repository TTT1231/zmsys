-- 订单归档回退（db-scheme.md §6.1）：归档不再是绝对终态——归档操作人本人
-- （archived_by 判等，超管同样受限）可把误归档的订单回退回 ACTIVE，订单返回
-- 销售订单页恢复编辑/发货。回退受限保护动作 orders:unarchive（protected=1，
-- 普通角色不可持有；super 不依赖授权行，无需 sys_grant，同 orders:archive 先例）。
-- 回退时归档三要素（archived_at/archived_by/archive_reason）由
-- ck_sales_order_archive 强制置 NULL，归档语境由 ARCHIVE/UNARCHIVE 变更日志
-- 快照保留。op_log 追加 unarchive_order 动作；UNARCHIVE 与 ARCHIVE 同为
-- 幂等终态事件，request_key 必填（reason 沿用列默认空串，可空）。
ALTER TABLE `sales_order_change_log`
    MODIFY COLUMN `event_type` ENUM('CREATE', 'UPDATE', 'ARCHIVE', 'UNARCHIVE') NOT NULL;

ALTER TABLE `sales_order_change_log` DROP CONSTRAINT `ck_sales_order_change_versions`;
ALTER TABLE `sales_order_change_log`
    ADD CONSTRAINT `ck_sales_order_change_versions` CHECK (
        (event_type = 'CREATE' AND before_version IS NULL AND after_version = 1)
        OR (event_type IN ('UPDATE', 'ARCHIVE', 'UNARCHIVE') AND before_version IS NOT NULL AND after_version = before_version + 1)
    );

ALTER TABLE `sales_order_change_log` DROP CONSTRAINT `ck_sales_order_change_request`;
ALTER TABLE `sales_order_change_log`
    ADD CONSTRAINT `ck_sales_order_change_request` CHECK (
        (request_key IS NULL OR CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
        AND (event_type NOT IN ('CREATE', 'ARCHIVE', 'UNARCHIVE') OR request_key IS NOT NULL)
    );

ALTER TABLE `op_log`
    MODIFY COLUMN `action` ENUM(
        'ship', 'create_customer', 'create_order', 'delete_order', 'delete_bom', 'archive_order',
        'unarchive_order',
        'create_inbound', 'void_inbound', 'delete_inbound',
        'void_outbound', 'delete_outbound',
        'create_bom', 'update_customer',
        'db_backup', 'db_restore'
    ) NOT NULL;

INSERT INTO `sys_permission` (`code`, `kind`, `menu_key`, `action_id`, `label`, `protected`) VALUES
    ('orders:unarchive', 'ACTION', 'orders', 'unarchive', '归档回退', 1);

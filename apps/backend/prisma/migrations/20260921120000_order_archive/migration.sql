-- 订单归档（db-scheme.md §6.1）：已完成/部分发货/已取消的订单由超级管理员归档，
-- 终态不可恢复，归档单移出销售订单活跃视图仅供查询。归档三要素（archived_at/
-- archived_by/archive_reason，备注选填）与取消三要素并列；曾取消再归档的订单
-- 保留取消语境。op_log 追加 archive_order 动作；播种受保护动作 orders:archive
-- （protected=1，普通角色不可持有；super 不依赖授权行，无需 sys_grant）与普通
-- 菜单 menu:archived-orders（四个非 super 角色对齐 menu:orders 先例）。
ALTER TABLE `sales_order_table`
    MODIFY COLUMN `lifecycle_status` ENUM('ACTIVE', 'CANCELLED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE `sales_order_table`
    ADD COLUMN `archived_at` DATETIME(3) NULL AFTER `cancel_reason`,
    ADD COLUMN `archived_by` BIGINT NULL AFTER `archived_at`,
    ADD COLUMN `archive_reason` VARCHAR(500) NULL AFTER `archived_by`,
    ADD CONSTRAINT `fk_sales_order_archived_by` FOREIGN KEY (`archived_by`) REFERENCES `sys_user` (`id`)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ARCHIVED 态下取消三要素可空（直接归档）可非空（曾取消再归档），其余两态维持原约束
ALTER TABLE `sales_order_table` DROP CONSTRAINT `ck_sales_order_cancel`;
ALTER TABLE `sales_order_table`
    ADD CONSTRAINT `ck_sales_order_cancel` CHECK (
        (lifecycle_status = 'ACTIVE' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
        OR
        (lifecycle_status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
            AND CHAR_LENGTH(TRIM(cancel_reason)) BETWEEN 2 AND 500)
        OR
        (lifecycle_status = 'ARCHIVED')
    );

-- 归档备注选填：仅要求 ARCHIVED 时 archived_at/by 非空，reason 允许 NULL
ALTER TABLE `sales_order_table`
    ADD CONSTRAINT `ck_sales_order_archive` CHECK (
        (lifecycle_status <> 'ARCHIVED' AND archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL)
        OR
        (lifecycle_status = 'ARCHIVED' AND archived_at IS NOT NULL AND archived_by IS NOT NULL)
    );

ALTER TABLE `sales_order_change_log`
    MODIFY COLUMN `event_type` ENUM('CREATE', 'UPDATE', 'CANCEL', 'ARCHIVE') NOT NULL;

ALTER TABLE `sales_order_change_log` DROP CONSTRAINT `ck_sales_order_change_versions`;
ALTER TABLE `sales_order_change_log`
    ADD CONSTRAINT `ck_sales_order_change_versions` CHECK (
        (event_type = 'CREATE' AND before_version IS NULL AND after_version = 1)
        OR (event_type IN ('UPDATE', 'CANCEL', 'ARCHIVE') AND before_version IS NOT NULL AND after_version = before_version + 1)
    );

-- ARCHIVE 与 CANCEL 同为幂等终态事件：request_key 必填（reason 沿用列默认空串，可空）
ALTER TABLE `sales_order_change_log` DROP CONSTRAINT `ck_sales_order_change_request`;
ALTER TABLE `sales_order_change_log`
    ADD CONSTRAINT `ck_sales_order_change_request` CHECK (
        (request_key IS NULL OR CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
        AND (event_type NOT IN ('CREATE', 'CANCEL', 'ARCHIVE') OR request_key IS NOT NULL)
    );

ALTER TABLE `op_log`
    MODIFY COLUMN `action` ENUM('ship', 'create_customer', 'create_order', 'delete_bom', 'delete_order', 'archive_order') NOT NULL;

INSERT INTO `sys_permission` (`code`, `kind`, `menu_key`, `action_id`, `label`, `protected`) VALUES
    ('menu:archived-orders', 'MENU', 'archived-orders', NULL, '归档订单', 0),
    ('orders:archive', 'ACTION', 'orders', 'archive', '归档订单', 1);

INSERT INTO `sys_grant` (`role_code`, `permission_code`, `grant_source`, `granted_by`) VALUES
    ('admin', 'menu:archived-orders', 'BOOTSTRAP', NULL),
    ('warehouse', 'menu:archived-orders', 'BOOTSTRAP', NULL),
    ('sales', 'menu:archived-orders', 'BOOTSTRAP', NULL),
    ('staff', 'menu:archived-orders', 'BOOTSTRAP', NULL);

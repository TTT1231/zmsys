-- 已作废出库单软删除后，订单可立即从业务列表删除；保留外键引用与审计链，
-- 待出库单 7 天保留期满被清理后，再由维护任务物理清理订单及变更日志。
ALTER TABLE `sales_order_table`
    ADD COLUMN `deleted_at` DATETIME(3) NULL AFTER `archive_reason`,
    ADD KEY `idx_sales_order_deleted` (`deleted_at`);

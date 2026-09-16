-- 订单删除（db-scheme.md §6.1）：仅超级管理员可删除完全未发货（累计已发为 0、
-- 无任何出库单引用）的订单（清理手误创建）。op_log 追加 delete_order 动作；
-- 播种受保护权限 orders:delete（protected=1，普通角色不可持有；super 不依赖
-- 授权行，无需 sys_grant）。
ALTER TABLE `op_log`
    MODIFY COLUMN `action` ENUM('ship', 'create_customer', 'create_order', 'delete_bom', 'delete_order') NOT NULL;

INSERT INTO `sys_permission` (`code`, `kind`, `menu_key`, `action_id`, `label`, `protected`) VALUES
    ('orders:delete', 'ACTION', 'orders', 'delete', '删除订单', 1);

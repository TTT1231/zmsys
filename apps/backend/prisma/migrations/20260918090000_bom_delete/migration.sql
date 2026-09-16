-- BOM 删除（db-scheme.md §5.2）：仅超级管理员可删除未被销售订单与出入库/调整流水
-- 引用的 BOM（清理手误建档）。op_log 追加 delete_bom 动作；播种受保护权限
-- bom:delete（protected=1，普通角色不可持有；super 不依赖授权行，无需 sys_grant）。
ALTER TABLE `op_log`
    MODIFY COLUMN `action` ENUM('ship', 'create_customer', 'create_order', 'delete_bom') NOT NULL;

INSERT INTO `sys_permission` (`code`, `kind`, `menu_key`, `action_id`, `label`, `protected`) VALUES
    ('bom:delete', 'ACTION', 'bom', 'delete', '删除BOM', 1);

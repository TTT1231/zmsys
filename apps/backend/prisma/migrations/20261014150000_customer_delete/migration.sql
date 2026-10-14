-- 客户档案删除（db-scheme.md §4.1）：清理手误建档——无任何销售订单（含已归档；
-- 订单删除为物理删除，已删除订单视同无订单）的客户可删。op_log 追加 delete_customer
-- 动作；播种受保护权限 customers:delete（protected=1，普通角色不可持有；super 不依赖
-- 授权行，无需 sys_grant）。
-- MySQL ENUM 按序号存储，只能尾部追加（中段插入会重排既有行序号）；全量列出既有值。
ALTER TABLE op_log
  MODIFY COLUMN action ENUM(
    'ship',
    'create_customer',
    'create_order',
    'delete_bom',
    'delete_order',
    'archive_order',
    'unarchive_order',
    'create_inbound',
    'void_inbound',
    'delete_inbound',
    'void_outbound',
    'delete_outbound',
    'create_bom',
    'update_customer',
    'db_backup',
    'db_restore',
    'create_bom_category',
    'update_bom_structure',
    'delete_bom_category',
    'delete_customer'
  ) NOT NULL;

INSERT INTO sys_permission (code, kind, menu_key, action_id, label, protected) VALUES
    ('customers:delete', 'ACTION', 'customers', 'delete', '删除客户', 1);

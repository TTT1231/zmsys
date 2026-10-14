-- 品类删除审计（2026-10-14）：op_log.action 枚举尾部追加 delete_bom_category。
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
    'delete_bom_category'
  ) NOT NULL;

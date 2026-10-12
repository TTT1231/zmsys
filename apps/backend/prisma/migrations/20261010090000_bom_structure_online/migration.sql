-- BOM 结构在线维护（db-scheme.md §5.4）：目录修改通道从「只走迁移」扩展为
-- 「迁移或超管在线维护（POST /bom-structure/*，受保护权限 bom-structure:manage）」。
-- 生效口径：结构变更只影响保存后新建的 BOM；旧 BOM/订单/出入库/库存走冻结数据不动。
--
-- ENUM 新值必须追加在末尾：MySQL 按序号存储，中间插值/换序会重排既有行并触发表复制
-- （末尾追加可走 INSTANT/INPLACE）。前 16 项与现行列定义逐字一致（20261006000000 起
-- 的现序），基线 docs/mysql-8-schema.sql 同步同序。
ALTER TABLE `op_log`
    MODIFY COLUMN `action` ENUM(
        'ship', 'create_customer', 'create_order', 'delete_order', 'delete_bom', 'archive_order',
        'unarchive_order',
        'create_inbound', 'void_inbound', 'delete_inbound',
        'void_outbound', 'delete_outbound',
        'create_bom', 'update_customer',
        'db_backup', 'db_restore',
        'create_bom_category', 'update_bom_structure'
    ) NOT NULL;

-- 超管专属权限播种（db-scheme.md §3.3）：三行均 protected=1，不播普通角色 BOOTSTRAP 行
-- ——super 不依赖授权行（服务端视为全量），普通角色不可获授。INSERT IGNORE 幂等
-- （模板同 20261008090000_analytics_menu；e2e 每轮整库重建，语义等价）。
INSERT IGNORE INTO `sys_permission` (`code`, `kind`, `menu_key`, `action_id`, `label`, `protected`) VALUES
    ('menu:bom-structure', 'MENU', 'bom-structure', NULL, 'BOM 结构', 1),
    ('bom-structure:view', 'ACTION', 'bom-structure', 'view', '查看BOM结构', 1),
    ('bom-structure:manage', 'ACTION', 'bom-structure', 'manage', '维护BOM结构', 1);

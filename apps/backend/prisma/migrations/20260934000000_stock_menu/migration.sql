-- 库存菜单（menu:stock）：BOM 维度库存余量与出入库流水的独立只读页。
-- super 固定全量（不依赖 sys_grant 行）；四个业务角色随 BOOTSTRAP 播种授权，
-- 与 menu:bom / menu:inbound / menu:outbound 的默认授权面保持一致。

INSERT INTO sys_permission (code, kind, menu_key, action_id, label, protected) VALUES
    ('menu:stock', 'MENU', 'stock', NULL, '库存', 0);

INSERT INTO sys_grant (role_code, permission_code, grant_source, granted_by) VALUES
    ('admin', 'menu:stock', 'BOOTSTRAP', NULL),
    ('warehouse', 'menu:stock', 'BOOTSTRAP', NULL),
    ('sales', 'menu:stock', 'BOOTSTRAP', NULL),
    ('staff', 'menu:stock', 'BOOTSTRAP', NULL);

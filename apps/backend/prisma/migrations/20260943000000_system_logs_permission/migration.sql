-- 系统日志页权限播种（db-scheme.md §3.3/§8）：新增受保护菜单 menu:system-logs 与
-- 受保护动作 system-logs:view，均 protected=1——照 menu:permissions 受保护先例不播
-- sys_grant 行（super 不依赖授权行，服务端视为全量；普通角色自然不可见、不可调用，
-- 聚合端点 GET /system-logs 以 system-logs:view 校验）。
-- INSERT IGNORE 幂等：开发环境手工预播种过这两行时重放不冲突（e2e 每次整库重建，
-- 语义等价）。
INSERT IGNORE INTO `sys_permission` (`code`, `kind`, `menu_key`, `action_id`, `label`, `protected`) VALUES
    ('menu:system-logs', 'MENU', 'system-logs', NULL, '系统日志', 1),
    ('system-logs:view', 'ACTION', 'system-logs', 'view', '查看', 1);

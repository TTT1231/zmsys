-- 分析页权限播种（db-scheme.md §3.3）：交付甘特图自工作台二级视图迁出为独立菜单
-- menu:analytics。普通可授权菜单（protected=0），但不播普通角色 BOOTSTRAP 行——
-- 默认仅超管可见（super 不依赖授权行，服务端视为全量）；需要时由超管在
-- 「用户与权限」→「角色与权限」勾选授予。页面数据仍来自 GET /workbench/overview
-- （校验 menu:workbench），授予分析页的角色需同时保留工作台菜单。
-- INSERT IGNORE 幂等：开发环境手工预播种过该行时重放不冲突（e2e 每次整库重建，
-- 语义等价）。
INSERT IGNORE INTO `sys_permission` (`code`, `kind`, `menu_key`, `action_id`, `label`, `protected`) VALUES
    ('menu:analytics', 'MENU', 'analytics', NULL, '分析页', 0);

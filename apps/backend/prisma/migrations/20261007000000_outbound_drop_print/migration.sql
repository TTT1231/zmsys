-- 出库打印功能整体移除（人为审核定稿）：前端按钮/API/权限码同步删除，
-- 本迁移清理权限目录残留。先清 sys_grant 兜底 fk_sys_grant_permission 的
-- ON DELETE RESTRICT（预期 1 行 admin BOOTSTRAP，若超管曾通过界面授予
-- 其他角色则一并清除），再删 sys_permission。
DELETE FROM `sys_grant` WHERE `permission_code` = 'outbound:print';
DELETE FROM `sys_permission` WHERE `code` = 'outbound:print';

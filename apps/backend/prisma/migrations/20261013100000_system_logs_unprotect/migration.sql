-- 系统日志权限降级（db-scheme.md §3.3）：menu:system-logs 与 system-logs:view 由受保护码
-- （protected=1，须先在「受保护权限」解锁才能授予）降为普通可授权码（protected=0）——
-- 照 menu:analytics 先例，超管可直接在「角色与权限」编辑器勾选授予其他角色。
-- 不播 BOOTSTRAP sys_grant 行：默认仍仅超管可见（super 不依赖授权行，服务端视为全量）。
-- 无需清理授权行或递增 grant_version：受保护态下这两个码不可能存在 sys_grant 行
-- （saveGrant 拒写受保护码，重新加锁时同事务清理），翻转 1→0 不改变任何非 super
-- 用户的有效权限集；「受保护权限」页签与编辑器灰显由 protected 标志派生，自动适配。
UPDATE `sys_permission` SET `protected` = 0 WHERE `code` IN ('menu:system-logs', 'system-logs:view');

-- 受保护权限运行时开关（db-scheme.md §3.3/§3.6）：
-- 1) 备份/恢复菜单码并入受保护目录——此前仅为前端 onlyFor 锁（目录中 protected=0），
--    收敛为单一机制；同版本前端移除 onlyFor 前端锁，默认行为不变（仍仅超管可见）。
-- 2) 新增 sys_permission_change_log 审计解锁/加锁动作（与 sys_grant_log 分表：
--    后者只记角色授权整组保存，本表只记目录级保护状态翻转）。
UPDATE `sys_permission` SET `protected` = 1
 WHERE `code` IN ('menu:system-backup', 'menu:system-restore');

-- 防御性清理：saveGrant 一直拒绝受保护码，正常库无此类授权行；直改库/迁移错写时兜底，
-- 保证受保护码在全库范围内无授权残留。
DELETE `sg` FROM `sys_grant` `sg`
  JOIN `sys_permission` `sp` ON `sp`.`code` = `sg`.`permission_code`
 WHERE `sp`.`protected` = 1;

CREATE TABLE sys_permission_change_log (
    id BIGINT NOT NULL,
    operator_id BIGINT NOT NULL,
    permission_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    before_protected TINYINT UNSIGNED NOT NULL,
    after_protected TINYINT UNSIGNED NOT NULL,
    cleaned_grants INT UNSIGNED NOT NULL DEFAULT 0,
    reason VARCHAR(500) NOT NULL DEFAULT '',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_sys_permission_change_log_perm_time (permission_code, created_at DESC),
    KEY idx_sys_permission_change_log_operator_time (operator_id, created_at DESC),
    CONSTRAINT fk_sys_permission_change_log_operator FOREIGN KEY (operator_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_sys_permission_change_log_permission FOREIGN KEY (permission_code) REFERENCES sys_permission (code)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_sys_permission_change_log_values CHECK (
        before_protected IN (0, 1) AND after_protected IN (0, 1) AND after_protected <> before_protected
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

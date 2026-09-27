-- 应用内数据库备份/恢复（仅超管）+ 恢复 CLI：持久凭证表、审计动作与权限目录。
-- 本迁移：
-- ① sys_restore_job 恢复任务持久凭证表：无外键（replace 整表清空业务数据时不受牵连，
--    也不随备份导出）；request_key 单列唯一 + ascii/ascii_bin 精确比较，
--    成功凭证与恢复数据同事务写入，FAILED 行在确认未提交后单独补写；
-- ② op_log.action 枚举扩充 db_backup / db_restore（旧值全部保留给存量行）；
-- ③ 权限目录 4 行：系统组「备份」「恢复」菜单与对应 ACTION（后两 protected=1，
--    仅 super 持有）；不播 sys_grant——菜单仅 super 经全量目录可见。

CREATE TABLE sys_restore_job (
    id BIGINT NOT NULL,
    request_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    file_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mode ENUM('merge', 'replace') NOT NULL,
    status ENUM('SUCCEEDED', 'SUCCEEDED_AUDIT_FAILED', 'FAILED') NOT NULL,
    operator_id BIGINT NOT NULL,
    operator_name VARCHAR(64) NOT NULL,
    report_json JSON NOT NULL,
    error_text TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL,
    finished_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_sys_restore_job_request (request_key),
    KEY idx_sys_restore_job_created (created_at DESC),
    CONSTRAINT ck_sys_restore_job_sha CHECK (file_sha256 REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- op_log 动作枚举扩充（列全量值，旧值保留）
ALTER TABLE `op_log`
    MODIFY COLUMN `action` ENUM(
        'ship', 'create_customer', 'create_order', 'delete_order', 'delete_bom', 'archive_order',
        'create_inbound', 'void_inbound', 'delete_inbound',
        'void_outbound', 'delete_outbound',
        'create_bom', 'update_customer',
        'db_backup', 'db_restore'
    ) NOT NULL;

INSERT INTO sys_permission (code, kind, menu_key, action_id, label, protected) VALUES
    ('menu:system-backup', 'MENU', 'system-backup', NULL, '备份', 0),
    ('menu:system-restore', 'MENU', 'system-restore', NULL, '恢复', 0),
    ('system-backup:run', 'ACTION', 'system-backup', 'run', '执行备份', 1),
    ('system-restore:run', 'ACTION', 'system-restore', 'run', '执行恢复', 1);

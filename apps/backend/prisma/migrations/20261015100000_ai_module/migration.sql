-- AI 助手（众茂AI）后端能力：对话代理配置/用量记账表 + AI 工作台受保护菜单 + 配置审计动作。
-- 本迁移：
-- ① ai_provider_config 对话代理配置单行表：仅超管在 AI 工作台维护；api_key 只存
--    服务端，任何读接口不透出原文（脱敏返回）；id 固定 1，CHECK 兜底单行语义。
--    备份分类为运行态表（backup.catalog.ts RUNTIME_TABLES）：永不入应用备份，
--    replace 恢复不清理——明文 key 不随备份文件分发，系统级配置在恢复后保持现状；
-- ② ai_usage_log 用量记账：每次对话代理请求一行（成功与上游失败都记，失败 token 为 0、
--    用量未知在 error_message 标注），按登录人归属；备份分类归 system 组（与 op_log 同类）；
-- ③ op_log 动作枚举扩充 update_ai_config：AI 工作台配置变更审计（脱敏快照，绝不写入
--    key 内容）。系统审计动作，不进入系统日志业务时间线（同 db_backup/db_restore）；
-- ④ 权限目录 1 行：系统组「AI 工作台」受保护菜单（protected=1，默认仅 super，
--    超管可解锁下放）；不播 sys_grant——菜单仅 super 经全量目录可见。
--    对话与 agent 查询端点不挂新权限码：对话走登录态（@AuthenticatedOnly），
--    agent 查询沿用各域既有 view 权限码（agent 与登录用户同权）。

CREATE TABLE ai_provider_config (
    id TINYINT UNSIGNED NOT NULL,
    base_url VARCHAR(255) NOT NULL,
    api_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    model VARCHAR(64) NOT NULL,
    enabled TINYINT UNSIGNED NOT NULL DEFAULT 0,
    updated_by BIGINT NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    CONSTRAINT fk_ai_provider_config_updated_by FOREIGN KEY (updated_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_ai_provider_config_singleton CHECK (id = 1),
    CONSTRAINT ck_ai_provider_config_enabled CHECK (enabled IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE ai_usage_log (
    id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    model VARCHAR(64) NOT NULL,
    prompt_tokens INT UNSIGNED NOT NULL DEFAULT 0,
    completion_tokens INT UNSIGNED NOT NULL DEFAULT 0,
    total_tokens INT UNSIGNED NOT NULL DEFAULT 0,
    status ENUM('success', 'error') NOT NULL,
    error_message VARCHAR(500) NULL,
    duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_ai_usage_user_time (user_id, created_at DESC),
    KEY idx_ai_usage_time (created_at DESC),
    CONSTRAINT fk_ai_usage_user FOREIGN KEY (user_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- op_log 动作枚举扩充（列全量值，旧值保留）
ALTER TABLE `op_log`
    MODIFY COLUMN `action` ENUM(
        'ship', 'create_customer', 'create_order', 'delete_order', 'delete_bom', 'archive_order',
        'unarchive_order',
        'create_inbound', 'void_inbound', 'delete_inbound',
        'void_outbound', 'delete_outbound',
        'create_bom', 'update_customer',
        'db_backup', 'db_restore',
        'create_bom_category', 'update_bom_structure', 'delete_bom_category', 'delete_customer',
        'update_ai_config'
    ) NOT NULL;


INSERT INTO sys_permission (code, kind, menu_key, action_id, label, protected) VALUES
    ('menu:ai-workbench', 'MENU', 'ai-workbench', NULL, 'AI 工作台', 1);

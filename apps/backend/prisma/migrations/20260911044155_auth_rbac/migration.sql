-- 认证与授权基线（内容与 docs/db/mysql-8-schema.sql 逐字一致，仅截取本模块相关表）。
-- Prisma 无法表达 CHECK 约束与 ascii_bin 字符集，因此迁移 SQL 手写。

-- DropTable（临时验证模型，验证链路已完成）
DROP TABLE `user`;

-- CreateTable
CREATE TABLE sys_role (
    code VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(32) NOT NULL,
    locked TINYINT NOT NULL DEFAULT 0,
    grant_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (code),
    UNIQUE KEY uk_sys_role_name (name),
    CONSTRAINT ck_sys_role_locked CHECK (locked IN (0, 1)),
    CONSTRAINT ck_sys_role_builtin CHECK (
        code IN ('super', 'admin', 'warehouse', 'sales', 'staff')
        AND ((code = 'super' AND locked = 1) OR (code <> 'super' AND locked = 0))
    ),
    CONSTRAINT ck_sys_role_grant_version CHECK (grant_version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO sys_role (code, name, locked) VALUES
    ('super', '超级管理员', 1),
    ('admin', '管理员', 0),
    ('warehouse', '仓管', 0),
    ('sales', '销售', 0),
    ('staff', '员工', 0);

-- CreateTable
CREATE TABLE sys_user (
    id BIGINT NOT NULL,
    account VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(64) NOT NULL,
    role_code VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status TINYINT NOT NULL DEFAULT 1,
    token_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    password_changed_at DATETIME(3) NULL,
    last_login_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_sys_user_account (account),
    KEY idx_sys_user_role_status (role_code, status),
    CONSTRAINT fk_sys_user_role FOREIGN KEY (role_code) REFERENCES sys_role (code)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_sys_user_account CHECK (REGEXP_LIKE(account, '^[A-Za-z0-9_]{3,64}$')),
    CONSTRAINT ck_sys_user_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 20),
    CONSTRAINT ck_sys_user_status CHECK (status IN (0, 1)),
    CONSTRAINT ck_sys_user_versions CHECK (token_version > 0 AND row_version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE sys_user_change_log (
    id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    operator_id BIGINT NOT NULL,
    event_type ENUM('CREATE', 'PROFILE_UPDATE', 'ROLE_CHANGE', 'STATUS_CHANGE', 'PASSWORD_CHANGE', 'PASSWORD_RESET') NOT NULL,
    before_version BIGINT UNSIGNED NULL,
    after_version BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(500) NOT NULL DEFAULT '',
    before_json JSON NULL,
    after_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_sys_user_change_user_time (user_id, created_at DESC),
    KEY idx_sys_user_change_operator_time (operator_id, created_at DESC),
    CONSTRAINT fk_sys_user_change_user FOREIGN KEY (user_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_sys_user_change_operator FOREIGN KEY (operator_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_sys_user_change_before CHECK (before_json IS NULL OR JSON_TYPE(before_json) = 'OBJECT'),
    CONSTRAINT ck_sys_user_change_after CHECK (JSON_TYPE(after_json) = 'OBJECT'),
    CONSTRAINT ck_sys_user_change_no_secret CHECK (
        (before_json IS NULL OR JSON_CONTAINS_PATH(before_json, 'one', '$.password_hash') = 0)
        AND JSON_CONTAINS_PATH(after_json, 'one', '$.after_json') = 0
        AND JSON_CONTAINS_PATH(after_json, 'one', '$.password_hash') = 0
    ),
    CONSTRAINT ck_sys_user_change_versions CHECK (
        (before_version IS NULL AND after_version = 1)
        OR (before_version IS NOT NULL AND after_version = before_version + 1)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE sys_permission (
    code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    kind ENUM('MENU', 'ACTION') NOT NULL,
    menu_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    action_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    label VARCHAR(64) NOT NULL,
    protected TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (code),
    UNIQUE KEY uk_sys_permission_parts (kind, menu_key, action_id),
    CONSTRAINT ck_sys_permission_protected CHECK (protected IN (0, 1)),
    CONSTRAINT ck_sys_permission_shape CHECK (
        (kind = 'MENU' AND action_id IS NULL AND code = CONCAT('menu:', menu_key))
        OR (kind = 'ACTION' AND action_id IS NOT NULL AND code = CONCAT(menu_key, ':', action_id))
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO sys_permission (code, kind, menu_key, action_id, label, protected) VALUES
    ('menu:workbench', 'MENU', 'workbench', NULL, '工作台', 0),
    ('menu:orders', 'MENU', 'orders', NULL, '销售订单', 0),
    ('menu:customers', 'MENU', 'customers', NULL, '客户档案', 0),
    ('menu:bom', 'MENU', 'bom', NULL, '物料与BOM', 0),
    ('menu:inbound', 'MENU', 'inbound', NULL, '成品入库', 0),
    ('menu:outbound', 'MENU', 'outbound', NULL, '成品出库', 0),
    ('menu:permissions', 'MENU', 'permissions', NULL, '用户与权限', 1),
    ('menu:permissions-accounts', 'MENU', 'permissions-accounts', NULL, '账号管理', 1),
    ('menu:permissions-roles', 'MENU', 'permissions-roles', NULL, '角色与权限', 1),
    ('menu:permissions-matrix', 'MENU', 'permissions-matrix', NULL, '权限矩阵', 1),
    ('orders:view', 'ACTION', 'orders', 'view', '查看', 0),
    ('orders:create', 'ACTION', 'orders', 'create', '新建订单', 0),
    ('orders:edit', 'ACTION', 'orders', 'edit', '编辑订单', 0),
    ('orders:cancel', 'ACTION', 'orders', 'cancel', '取消订单', 0),
    ('customers:view', 'ACTION', 'customers', 'view', '查看', 0),
    ('customers:create', 'ACTION', 'customers', 'create', '新建客户', 0),
    ('customers:edit', 'ACTION', 'customers', 'edit', '编辑客户', 0),
    ('customers:bulk-transfer', 'ACTION', 'customers', 'bulk-transfer', '批量移交负责人', 1),
    ('bom:view', 'ACTION', 'bom', 'view', '查看', 0),
    ('bom:create', 'ACTION', 'bom', 'create', '新建BOM', 0),
    ('inbound:view', 'ACTION', 'inbound', 'view', '查看台账', 0),
    ('inbound:register', 'ACTION', 'inbound', 'register', '检验入库', 0),
    ('inbound:edit', 'ACTION', 'inbound', 'edit', '当天修正或作废', 0),
    ('inbound:adjust', 'ACTION', 'inbound', 'adjust', '跨日库存调整', 1),
    ('outbound:view', 'ACTION', 'outbound', 'view', '查看台账', 0),
    ('outbound:ship', 'ACTION', 'outbound', 'ship', '登记发货', 0),
    ('outbound:void', 'ACTION', 'outbound', 'void', '作废未打印出库', 0),
    ('outbound:print', 'ACTION', 'outbound', 'print', '打印出库单', 0),
    ('outbound:emergency-void', 'ACTION', 'outbound', 'emergency-void', '紧急撤销已打印出库', 1),
    ('permissions:view', 'ACTION', 'permissions', 'view', '查看', 1),
    ('permissions:manage', 'ACTION', 'permissions', 'manage', '用户与角色管理', 1);

-- CreateTable
CREATE TABLE sys_grant (
    role_code VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    permission_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    grant_source ENUM('BOOTSTRAP', 'USER') NOT NULL DEFAULT 'USER',
    granted_by BIGINT NULL,
    granted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (role_code, permission_code),
    KEY idx_sys_grant_permission (permission_code),
    KEY idx_sys_grant_operator (granted_by),
    CONSTRAINT fk_sys_grant_role FOREIGN KEY (role_code) REFERENCES sys_role (code)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_sys_grant_permission FOREIGN KEY (permission_code) REFERENCES sys_permission (code)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_sys_grant_operator FOREIGN KEY (granted_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_sys_grant_source CHECK (
        (grant_source = 'BOOTSTRAP' AND granted_by IS NULL)
        OR (grant_source = 'USER' AND granted_by IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO sys_grant (role_code, permission_code, grant_source, granted_by) VALUES
    ('admin', 'menu:workbench', 'BOOTSTRAP', NULL),
    ('admin', 'menu:orders', 'BOOTSTRAP', NULL),
    ('admin', 'menu:customers', 'BOOTSTRAP', NULL),
    ('admin', 'menu:bom', 'BOOTSTRAP', NULL),
    ('admin', 'menu:inbound', 'BOOTSTRAP', NULL),
    ('admin', 'menu:outbound', 'BOOTSTRAP', NULL),
    ('admin', 'orders:view', 'BOOTSTRAP', NULL),
    ('admin', 'orders:create', 'BOOTSTRAP', NULL),
    ('admin', 'orders:edit', 'BOOTSTRAP', NULL),
    ('admin', 'orders:cancel', 'BOOTSTRAP', NULL),
    ('admin', 'customers:view', 'BOOTSTRAP', NULL),
    ('admin', 'customers:create', 'BOOTSTRAP', NULL),
    ('admin', 'customers:edit', 'BOOTSTRAP', NULL),
    ('admin', 'bom:view', 'BOOTSTRAP', NULL),
    ('admin', 'bom:create', 'BOOTSTRAP', NULL),
    ('admin', 'inbound:view', 'BOOTSTRAP', NULL),
    ('admin', 'outbound:view', 'BOOTSTRAP', NULL),
    ('admin', 'outbound:print', 'BOOTSTRAP', NULL),
    ('warehouse', 'menu:workbench', 'BOOTSTRAP', NULL),
    ('warehouse', 'menu:orders', 'BOOTSTRAP', NULL),
    ('warehouse', 'menu:bom', 'BOOTSTRAP', NULL),
    ('warehouse', 'menu:inbound', 'BOOTSTRAP', NULL),
    ('warehouse', 'menu:outbound', 'BOOTSTRAP', NULL),
    ('warehouse', 'orders:view', 'BOOTSTRAP', NULL),
    ('warehouse', 'bom:view', 'BOOTSTRAP', NULL),
    ('warehouse', 'inbound:view', 'BOOTSTRAP', NULL),
    ('warehouse', 'inbound:register', 'BOOTSTRAP', NULL),
    ('warehouse', 'inbound:edit', 'BOOTSTRAP', NULL),
    ('warehouse', 'outbound:view', 'BOOTSTRAP', NULL),
    ('warehouse', 'outbound:ship', 'BOOTSTRAP', NULL),
    ('warehouse', 'outbound:void', 'BOOTSTRAP', NULL),
    ('sales', 'menu:workbench', 'BOOTSTRAP', NULL),
    ('sales', 'menu:orders', 'BOOTSTRAP', NULL),
    ('sales', 'menu:customers', 'BOOTSTRAP', NULL),
    ('sales', 'menu:bom', 'BOOTSTRAP', NULL),
    ('sales', 'menu:inbound', 'BOOTSTRAP', NULL),
    ('sales', 'menu:outbound', 'BOOTSTRAP', NULL),
    ('sales', 'orders:view', 'BOOTSTRAP', NULL),
    ('sales', 'orders:create', 'BOOTSTRAP', NULL),
    ('sales', 'orders:edit', 'BOOTSTRAP', NULL),
    ('sales', 'orders:cancel', 'BOOTSTRAP', NULL),
    ('sales', 'customers:view', 'BOOTSTRAP', NULL),
    ('sales', 'customers:create', 'BOOTSTRAP', NULL),
    ('sales', 'customers:edit', 'BOOTSTRAP', NULL),
    ('sales', 'bom:view', 'BOOTSTRAP', NULL),
    ('sales', 'bom:create', 'BOOTSTRAP', NULL),
    ('sales', 'inbound:view', 'BOOTSTRAP', NULL),
    ('sales', 'outbound:view', 'BOOTSTRAP', NULL),
    ('staff', 'menu:workbench', 'BOOTSTRAP', NULL),
    ('staff', 'menu:orders', 'BOOTSTRAP', NULL),
    ('staff', 'menu:bom', 'BOOTSTRAP', NULL),
    ('staff', 'menu:inbound', 'BOOTSTRAP', NULL),
    ('staff', 'menu:outbound', 'BOOTSTRAP', NULL),
    ('staff', 'orders:view', 'BOOTSTRAP', NULL),
    ('staff', 'bom:view', 'BOOTSTRAP', NULL),
    ('staff', 'inbound:view', 'BOOTSTRAP', NULL),
    ('staff', 'outbound:view', 'BOOTSTRAP', NULL);

-- CreateTable
CREATE TABLE sys_grant_log (
    id BIGINT NOT NULL,
    operator_id BIGINT NOT NULL,
    role_code VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    before_version BIGINT UNSIGNED NOT NULL,
    after_version BIGINT UNSIGNED NOT NULL,
    server_note VARCHAR(1000) NOT NULL,
    client_reason VARCHAR(500) NOT NULL DEFAULT '',
    before_json JSON NOT NULL,
    after_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_sys_grant_log_role_time (role_code, created_at DESC),
    KEY idx_sys_grant_log_operator_time (operator_id, created_at DESC),
    CONSTRAINT fk_sys_grant_log_operator FOREIGN KEY (operator_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_sys_grant_log_role FOREIGN KEY (role_code) REFERENCES sys_role (code)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_sys_grant_log_versions CHECK (
        before_version > 0 AND after_version IN (before_version, before_version + 1)
    ),
    CONSTRAINT ck_sys_grant_log_before CHECK (JSON_TYPE(before_json) = 'OBJECT'),
    CONSTRAINT ck_sys_grant_log_after CHECK (JSON_TYPE(after_json) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

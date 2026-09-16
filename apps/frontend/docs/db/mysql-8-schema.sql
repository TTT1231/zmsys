-- 智造管理系统 · MySQL 8.0.16+ 建表基线
-- 时间统一存 UTC DATETIME(3)；Snowflake id 由应用传入；所有表使用 InnoDB。

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE sys_role (
    code VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(32) NOT NULL,
    locked TINYINT UNSIGNED NOT NULL DEFAULT 0,
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

CREATE TABLE sys_user (
    id BIGINT NOT NULL,
    account VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(64) NOT NULL,
    role_code VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status TINYINT UNSIGNED NOT NULL DEFAULT 1,
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

CREATE TABLE api_idempotency (
    id BIGINT NOT NULL,
    actor_id BIGINT NOT NULL,
    operation_key VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_hash BINARY(32) NOT NULL,
    state ENUM('PROCESSING', 'SUCCEEDED') NOT NULL DEFAULT 'PROCESSING',
    http_status SMALLINT UNSIGNED NULL,
    response_json JSON NULL,
    resource_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    resource_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_api_idempotency_request (actor_id, operation_key, idempotency_key),
    KEY idx_api_idempotency_expiry (expires_at),
    CONSTRAINT fk_api_idempotency_actor FOREIGN KEY (actor_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_api_idempotency_key CHECK (CHAR_LENGTH(TRIM(idempotency_key)) BETWEEN 8 AND 128),
    CONSTRAINT ck_api_idempotency_response CHECK (
        (state = 'PROCESSING' AND http_status IS NULL AND response_json IS NULL)
        OR
        (state = 'SUCCEEDED' AND http_status BETWEEN 200 AND 299 AND JSON_TYPE(response_json) = 'OBJECT')
    ),
    CONSTRAINT ck_api_idempotency_expiry CHECK (expires_at > created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
        AND JSON_CONTAINS_PATH(after_json, 'one', '$.password_hash') = 0
    ),
    CONSTRAINT ck_sys_user_change_versions CHECK (
        (before_version IS NULL AND after_version = 1)
        OR (before_version IS NOT NULL AND after_version = before_version + 1)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE biz_sequence (
    sequence_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    next_value BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (sequence_key),
    CONSTRAINT ck_biz_sequence_next CHECK (next_value > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sys_permission (
    code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    kind ENUM('MENU', 'ACTION') NOT NULL,
    menu_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    action_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    label VARCHAR(64) NOT NULL,
    protected TINYINT UNSIGNED NOT NULL DEFAULT 0,
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

CREATE TABLE bom_category (
    id BIGINT NOT NULL,
    category_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(64) NOT NULL,
    code_prefix VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    seq_width TINYINT UNSIGNED NOT NULL DEFAULT 3,
    child_categories JSON NULL,
    status TINYINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_bom_category_key (category_key),
    UNIQUE KEY uk_bom_category_name (name),
    UNIQUE KEY uk_bom_category_prefix (code_prefix),
    CONSTRAINT ck_bom_category_width CHECK (seq_width BETWEEN 3 AND 8),
    CONSTRAINT ck_bom_category_children CHECK (
        child_categories IS NULL OR JSON_TYPE(child_categories) = 'ARRAY'
    ),
    CONSTRAINT ck_bom_category_status CHECK (status IN (0, 1)),
    CONSTRAINT ck_bom_category_version CHECK (row_version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 1–9999 为内置参考数据保留 id；业务 Snowflake id 不得使用该区间。
-- 物料目录模式：5 品类。
INSERT INTO bom_category (id, category_key, name, code_prefix, seq_width, child_categories) VALUES
    (1001, 'rotary-switch', '旋转XK2', 'XK2', 3),
    (1002, 'rotary-xk3', '旋转XK3', 'XK3', 3),
    (1003, 'new-micro-switch', '新微动', 'KW', 4),
    (1004, 'old-micro-switch', '老微动', 'KW16', 3),
    (1005, 'safety-switch', '安全开关', 'AQ', 3),
    (1006, 'tipover-switch', '跌倒开关', 'KD', 3, '["new-micro-switch", "old-micro-switch"]');

-- 物料目录节点：分区（SECTION，仅展示与折叠、不挂物料）或分组（GROUP，挂可选物料）。
-- 分组 key 为稳定标识（model 用于型号派生）；目录修改只走迁移（不可变边界见 db-scheme.md §5）。
CREATE TABLE material_group (
    id BIGINT NOT NULL,
    category_id BIGINT NOT NULL,
    parent_id BIGINT NULL,
    kind ENUM('SECTION', 'GROUP') NOT NULL,
    name VARCHAR(64) NOT NULL,
    group_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    multi TINYINT UNSIGNED NULL,
    sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    status TINYINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_material_group_name (category_id, name),
    UNIQUE KEY uk_material_group_key (category_id, group_key),
    KEY idx_material_group_category_status (category_id, status),
    CONSTRAINT fk_material_group_category FOREIGN KEY (category_id) REFERENCES bom_category (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_material_group_parent FOREIGN KEY (parent_id) REFERENCES material_group (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_material_group_kind CHECK (
        (kind = 'SECTION' AND parent_id IS NULL AND group_key IS NULL AND multi IS NULL)
        OR (kind = 'GROUP' AND group_key IS NOT NULL AND multi IN (0, 1))
    ),
    CONSTRAINT ck_material_group_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 64),
    CONSTRAINT ck_material_group_status CHECK (status IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 可选物料项：建档时冻结名称到 bom_item，此处改名/停用不影响已建 BOM；
-- 已被引用的物料不得改名、移组或复用 id（规格变化 = 新增项 + 旧项停用）。
CREATE TABLE material_item (
    id BIGINT NOT NULL,
    group_id BIGINT NOT NULL,
    name VARCHAR(64) NOT NULL,
    sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    status TINYINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_material_item_name (group_id, name),
    KEY idx_material_item_group_status (group_id, status),
    CONSTRAINT fk_material_item_group FOREIGN KEY (group_id) REFERENCES material_group (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_material_item_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 64),
    CONSTRAINT ck_material_item_status CHECK (status IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- BOM 档案 = 品类 + 选中物料集合（无数量）；(category_id, spec_hash) 业务去重，
-- spec_hash 为规范化物料 id 集合（BigInt 十进制、去重、数值升序 JSON 数组）的 SHA-256。
CREATE TABLE bom_table (
    id BIGINT NOT NULL,
    bom_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    category_id BIGINT NOT NULL,
    spec_hash BINARY(32) NOT NULL,
    unit VARCHAR(16) NOT NULL DEFAULT '个',
    status TINYINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_by BIGINT NOT NULL,
    updated_by BIGINT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_bom_code (bom_code),
    UNIQUE KEY uk_bom_identity (category_id, spec_hash),
    UNIQUE KEY uk_bom_request (request_key),
    KEY idx_bom_category_status (category_id, status),
    CONSTRAINT fk_bom_category FOREIGN KEY (category_id) REFERENCES bom_category (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_bom_creator FOREIGN KEY (created_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_bom_updater FOREIGN KEY (updated_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_bom_status CHECK (status IN (0, 1)),
    CONSTRAINT ck_bom_version CHECK (row_version > 0),
    CONSTRAINT ck_bom_request CHECK (CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- BOM 明细行（无数量）：建档冻结 group_key/group_name/name/position，
-- 展示与摘要（“组名：物料名”按 position 排序）不依赖当前目录。
CREATE TABLE bom_item (
    id BIGINT NOT NULL,
    bom_id BIGINT NOT NULL,
    material_id BIGINT NOT NULL,
    group_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    group_name VARCHAR(64) NOT NULL,
    name VARCHAR(64) NOT NULL,
    position INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_bom_item_once (bom_id, material_id),
    KEY idx_bom_item_material (material_id),
    CONSTRAINT fk_bom_item_bom FOREIGN KEY (bom_id) REFERENCES bom_table (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_bom_item_material FOREIGN KEY (material_id) REFERENCES material_item (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_bom_item_names CHECK (
        CHAR_LENGTH(TRIM(group_name)) BETWEEN 1 AND 64 AND CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 64
    ),
    CONSTRAINT ck_bom_item_position CHECK (position >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 目录种子（id 段 2001+ 分区/组、3001+ 物料）。
-- 旋转XK2（1001 / XK2 / 3）：无分区，7 个单选组；A面/B面共用同一组触点与盖板选项。
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, sort_order) VALUES
    (2001, 1001, NULL, 'GROUP', '型号', 'model', 0, 1),
    (2008, 1001, NULL, 'GROUP', '规格', 'spec', 0, 2),
    (2009, 1001, NULL, 'GROUP', '方向', 'direction', 0, 3),
    (2004, 1001, NULL, 'GROUP', '杆子点位厚度', 'lever-point-thickness', 0, 4),
    (2005, 1001, NULL, 'GROUP', 'A面', 'face-a', 0, 5),
    (2006, 1001, NULL, 'GROUP', 'B面', 'face-b', 0, 6),
    (2007, 1001, NULL, 'GROUP', '弹簧', 'spring', 0, 7);

INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    -- 型号全集（含「无」；1-1 / 2-1 保留原 id 3001 / 3002）
    (3051, 2001, '0-2', 2),
    (3052, 2001, '0-3', 3),
    (3053, 2001, '0-4', 4),
    (3054, 2001, '0-4-1', 5),
    (3055, 2001, '0-5', 6),
    (3056, 2001, '0-6', 7),
    (3057, 2001, '0-7', 8),
    (3058, 2001, '0-8', 9),
    (3059, 2001, '0-9', 10),
    (3001, 2001, '1-1', 11),
    (3002, 2001, '2-1', 12),
    (3060, 2001, '2-2', 13),
    (3061, 2001, '3-1', 14),
    (3062, 2001, '3-2', 15),
    (3063, 2001, '4-1', 16),
    (3064, 2001, '4-2', 17),
    (3065, 2001, '4-3', 18),
    (3066, 2001, '4-4', 19),
    (3067, 2001, '4-8', 20),
    (3068, 2001, '4-9', 21),
    (3069, 2001, '无', 22),
    -- 规格（含「无」，按业务清单顺序）
    (3071, 2008, '211-1', 1),
    (3072, 2008, '222-1', 2),
    (3073, 2008, '2-1-4', 3),
    (3074, 2008, '222-2', 4),
    (3075, 2008, '233-4', 5),
    (3076, 2008, '233-1-B', 6),
    (3077, 2008, '233-1', 7),
    (3078, 2008, '243-1-2', 8),
    (3079, 2008, '243-5B', 9),
    (3080, 2008, '243-5A', 10),
    (3081, 2008, '243-5', 11),
    (3082, 2008, '243-1', 12),
    (3083, 2008, '全方位/冷风扇/284-1B', 13),
    (3084, 2008, '全方位/284-2B', 14),
    (3085, 2008, '212-1', 15),
    (3086, 2008, '263-1-A', 16),
    (3087, 2008, '284-1A', 17),
    (3088, 2008, '284-2', 18),
    (3089, 2008, '284-1', 19),
    (3090, 2008, '284-3', 20),
    (3091, 2008, '284-4', 21),
    (3092, 2008, '无', 22),
    -- 方向
    (3093, 2009, '正面', 1),
    (3094, 2009, '反面', 2),
    (3095, 2009, '正面反轴', 3),
    (3096, 2009, '反面转90°扁位朝上', 4),
    (3097, 2009, '正面转90°扁位朝上', 5),
    -- 杆子点位厚度
    (3005, 2004, '4.8', 1),
    (3023, 2004, '4.9', 2),
    (3031, 2005, '三脚银点', 1),
    (3032, 2005, '三脚铜点', 2),
    (3033, 2005, '塑料盖板', 3),
    (3034, 2005, '全方位左脚银点', 4),
    (3035, 2005, '全方位右脚银点', 5),
    (3036, 2005, '左脚银点（全银点）', 6),
    (3037, 2005, '右脚银点', 7),
    (3038, 2005, '右脚铜点', 8),
    (3039, 2005, '全方位左脚铜点', 9),
    (3041, 2006, '三脚银点', 1),
    (3042, 2006, '三脚铜点', 2),
    (3043, 2006, '塑料盖板', 3),
    (3044, 2006, '全方位左脚银点', 4),
    (3045, 2006, '全方位右脚银点', 5),
    (3046, 2006, '左脚银点（全银点）', 6),
    (3047, 2006, '右脚银点', 7),
    (3048, 2006, '右脚铜点', 8),
    (3049, 2006, '全方位左脚铜点', 9),
    (3008, 2007, '0.5', 1),
    (3009, 2007, '0.55', 2),
    (3010, 2007, '0.6', 3);

-- 新微动（1003 / KW / 4）：PA66塑料 / 五金件 两分区，分区内按部件类型单选组。
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, sort_order) VALUES
    (2101, 1003, NULL, 'SECTION', 'PA66塑料', NULL, NULL, 1),
    (2111, 1003, 2101, 'GROUP', '底座', 'base', 0, 1),
    (2112, 1003, 2101, 'GROUP', '盖子', 'cover', 0, 2),
    (2113, 1003, 2101, 'GROUP', '按钮', 'button', 0, 3),
    (2102, 1003, NULL, 'SECTION', '五金件', NULL, NULL, 2),
    (2114, 1003, 2102, 'GROUP', '支架', 'bracket', 0, 1),
    (2115, 1003, 2102, 'GROUP', '静片', 'static-plate', 0, 2),
    (2116, 1003, 2102, 'GROUP', '动片', 'moving-plate', 0, 3),
    (2117, 1003, 2102, 'GROUP', '摆片', 'swing-plate', 0, 4),
    (2118, 1003, 2102, 'GROUP', '弹片', 'spring-plate', 0, 5),
    (2103, 1003, NULL, 'SECTION', '触点', NULL, NULL, 3),
    (2119, 1003, 2103, 'GROUP', '触点大小', 'contact-size', 0, 1),
    (2120, 1003, 2103, 'GROUP', '触点厚度', 'contact-thickness', 0, 2),
    (2121, 1003, 2103, 'GROUP', '触点类别', 'contact-kind', 0, 3);

INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    (3101, 2111, '二脚底座（无挡脚）', 1),
    (3102, 2111, '三脚底座（有挡脚）', 2),
    (3103, 2112, '盖子', 1),
    (3104, 2113, '7.6mm（常用装跌倒）', 1),
    (3105, 2113, '8.0mm', 2),
    (3106, 2113, '8.1mm', 3),
    (3107, 2113, '8.2mm圆弧', 4),
    (3108, 2113, '8.3mm', 5),
    (3109, 2113, '8.5mm', 6),
    (3110, 2113, '8.8mm', 7),
    (3111, 2113, '9.1mm', 8),
    (3112, 2114, '6.3支架：铜镀银', 1),
    (3113, 2114, '6.3支架：铜镀镍', 2),
    (3114, 2114, '6.3支架：复合铜镀镍', 3),
    (3115, 2114, '4.8支架：铜镀镍', 4),
    (3116, 2114, '4.8支架：复合铜镀镍', 5),
    (3117, 2115, '6.3静片：铜镀银', 1),
    (3118, 2115, '6.3静片：铜镀镍', 2),
    (3119, 2115, '6.3静片：复合铜镀镍', 3),
    (3120, 2115, '4.8静片：铜镀镍', 4),
    (3121, 2115, '4.8静片：复合铜镀镍', 5),
    (3122, 2116, '铜镀银', 1),
    (3123, 2116, '镀锡', 2),
    (3124, 2117, '铜镀银摆片', 1),
    (3125, 2117, '铁镀镍摆片', 2),
    (3126, 2117, '复合铜镀镍摆片', 3),
    (3127, 2118, '0.12', 1),
    (3128, 2118, '0.15', 2),
    (3129, 2118, '0.2', 3),
    (3131, 2119, '0.3', 1),
    (3132, 2119, '0.35', 2),
    (3133, 2120, '0.15', 1),
    (3134, 2120, '0.2', 2),
    (3135, 2120, '0.3', 3),
    (3136, 2121, '铜', 1),
    (3137, 2121, '银', 2);

-- 老微动（1004 / KW16 / 3）
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, sort_order) VALUES
    (2201, 1004, NULL, 'SECTION', 'PA66塑料', NULL, NULL, 1),
    (2211, 1004, 2201, 'GROUP', '底座', 'base', 0, 1),
    (2212, 1004, 2201, 'GROUP', '盖子', 'cover', 0, 2),
    (2213, 1004, 2201, 'GROUP', '按钮', 'button', 0, 3),
    (2202, 1004, NULL, 'SECTION', '五金件', NULL, NULL, 2),
    (2214, 1004, 2202, 'GROUP', '支架', 'bracket', 0, 1),
    (2215, 1004, 2202, 'GROUP', '静片', 'static-plate', 0, 2),
    (2216, 1004, 2202, 'GROUP', '弹片', 'spring-plate', 0, 3),
    (2217, 1004, 2202, 'GROUP', '弹簧', 'spring', 0, 4),
    (2218, 1004, 2202, 'GROUP', '挡脚', 'stop-foot', 0, 5),
    (2203, 1004, NULL, 'SECTION', '触点', NULL, NULL, 3),
    (2219, 1004, 2203, 'GROUP', '触点大小', 'contact-size', 0, 1),
    (2220, 1004, 2203, 'GROUP', '触点厚度', 'contact-thickness', 0, 2),
    (2221, 1004, 2203, 'GROUP', '触点类别', 'contact-kind', 0, 3);

INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    (3201, 2211, '带CB', 1),
    (3202, 2211, '不带CB', 2),
    (3203, 2212, '盖子', 1),
    (3204, 2213, '8.5mm（常用装跌倒）', 1),
    (3205, 2213, '8.9mm', 2),
    (3206, 2213, '9.6mm', 3),
    (3207, 2214, '6.3镀银支架', 1),
    (3208, 2215, '6.3镀银静片', 1),
    (3209, 2216, '0.12', 1),
    (3210, 2217, '0.25', 1),
    (3211, 2217, '0.27', 2),
    (3212, 2218, '挡脚', 1),
    (3141, 2219, '0.3', 1),
    (3142, 2219, '0.35', 2),
    (3143, 2220, '0.15', 1),
    (3144, 2220, '0.2', 2),
    (3145, 2220, '0.3', 3),
    (3146, 2221, '铜', 1),
    (3147, 2221, '银', 2);

-- 旋转XK3（1002 / XK3 / 3）：PC塑料外壳、PC塑料底座、PA66塑料杆子三个根分组
-- + 五金件分区（小静片/半圆静片/动片 各 不电镀·镀锡、带圈动片、钢球、卡线片、弹簧）+ 触点分区。
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, sort_order) VALUES
    (2401, 1002, NULL, 'GROUP', 'PC塑料外壳', 'pc-shell', 0, 1),
    (2402, 1002, NULL, 'GROUP', 'PC塑料底座', 'pc-base', 0, 2),
    (2403, 1002, NULL, 'GROUP', 'PA66塑料杆子', 'pa66-lever', 0, 3),
    (2404, 1002, NULL, 'SECTION', '五金件', NULL, NULL, 4),
    (2411, 1002, 2404, 'GROUP', '小静片', 'small-static-plate', 0, 1),
    (2412, 1002, 2404, 'GROUP', '半圆静片', 'half-round-static-plate', 0, 2),
    (2413, 1002, 2404, 'GROUP', '动片', 'moving-plate', 0, 3),
    (2414, 1002, 2404, 'GROUP', '带圈动片', 'ring-moving-plate', 0, 4),
    (2415, 1002, 2404, 'GROUP', '钢球', 'steel-ball', 0, 5),
    (2416, 1002, 2404, 'GROUP', '卡线片', 'wire-clip', 0, 6),
    (2417, 1002, 2404, 'GROUP', '弹簧', 'spring', 0, 7),
    (2405, 1002, NULL, 'SECTION', '触点', NULL, NULL, 5),
    (2418, 1002, 2405, 'GROUP', '触点大小', 'contact-size', 0, 1),
    (2419, 1002, 2405, 'GROUP', '触点厚度', 'contact-thickness', 0, 2),
    (2420, 1002, 2405, 'GROUP', '触点类别', 'contact-kind', 0, 3);

INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    (3401, 2401, '圆孔长外壳（茶色）', 1),
    (3402, 2401, '圆孔长外壳（透明）', 2),
    (3403, 2401, '圆孔短外壳（茶色）', 3),
    (3404, 2401, '椭圆孔长外壳无CB字（茶色）', 4),
    (3405, 2401, '无耳外壳无CB字（茶色）', 5),
    (3406, 2402, '底座：茶色', 1),
    (3407, 2402, '底座：透明', 2),
    (3408, 2403, '圆轴长杆子', 1),
    (3409, 2403, '圆轴短杆子', 2),
    (3410, 2403, '扁轴4.8', 3),
    (3411, 2403, '扁轴4.8转90°', 4),
    (3412, 2411, '不电镀', 1),
    (3413, 2411, '镀锡', 2),
    (3414, 2412, '不电镀', 1),
    (3415, 2412, '镀锡', 2),
    (3416, 2413, '不电镀', 1),
    (3417, 2413, '镀锡', 2),
    (3418, 2414, '不电镀', 1),
    (3419, 2415, '4.0mm电镀钢球', 1),
    (3420, 2416, '0.15', 1),
    (3421, 2416, '0.2', 2),
    (3422, 2417, '0.45长弹簧', 1),
    (3423, 2417, '0.45短弹簧', 2),
    (3424, 2418, '0.3', 1),
    (3425, 2418, '0.35', 2),
    (3426, 2419, '0.15', 1),
    (3427, 2419, '0.2', 2),
    (3428, 2419, '0.3', 3),
    (3429, 2420, '铜', 1),
    (3430, 2420, '银', 2);

-- 安全开关（1005 / AQ / 3）：PC塑料（外壳类）根分组 + PA66塑料分区（盖板）
-- + 五金件分区（短款/31mm系列、长款/43mm系列 两个多选组）+ 触点分区。
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, sort_order) VALUES
    (2501, 1005, NULL, 'GROUP', 'PC塑料（外壳类）', 'pc-shell', 0, 1),
    (2502, 1005, NULL, 'SECTION', 'PA66塑料', NULL, NULL, 2),
    (2511, 1005, 2502, 'GROUP', '盖板', 'cover', 0, 1),
    (2503, 1005, NULL, 'SECTION', '五金件', NULL, NULL, 3),
    (2512, 1005, 2503, 'GROUP', '短款/31mm系列配件', 'short-31-parts', 1, 1),
    (2513, 1005, 2503, 'GROUP', '长款/43mm系列配件', 'long-43-parts', 1, 2),
    (2504, 1005, NULL, 'SECTION', '触点', NULL, NULL, 4),
    (2514, 1005, 2504, 'GROUP', '触点大小', 'contact-size', 0, 1),
    (2515, 1005, 2504, 'GROUP', '触点厚度', 'contact-thickness', 0, 2),
    (2516, 1005, 2504, 'GROUP', '触点类别', 'contact-kind', 0, 3);

INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    (3501, 2501, '安全开关KD-2 (30mm/31mm) 外壳 / 茶色', 1),
    (3502, 2501, '安全开关KW16 (31mm) 外壳 / 茶色', 2),
    (3503, 2501, '安全开关KW16 (31mm) 外壳 / 透明', 3),
    (3504, 2501, '安全开关KD-2 (40mm/43mm) 外壳 / 茶色', 4),
    (3505, 2501, '安全开关KW16 (43mm) 外壳 / 茶色', 5),
    (3506, 2511, '盖板', 1),
    (3507, 2512, '动片', 1),
    (3508, 2512, '静片', 2),
    (3509, 2512, '短杆子', 3),
    (3510, 2512, '短帽子', 4),
    (3511, 2512, '短弹簧', 5),
    (3512, 2513, '动片', 1),
    (3513, 2513, '静片', 2),
    (3514, 2513, '长杆子', 3),
    (3515, 2513, '长帽子', 4),
    (3516, 2513, '长弹簧', 5),
    (3517, 2514, '0.3', 1),
    (3518, 2514, '0.35', 2),
    (3519, 2515, '0.15', 1),
    (3520, 2515, '0.2', 2),
    (3521, 2515, '0.3', 3),
    (3522, 2516, '铜', 1),
    (3523, 2516, '银', 2);

-- 跌倒开关（1006 / DD / 3）：四个根单选组；建档另须选一个微动开关 BOM 作子件（child_categories 标记）。
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, sort_order) VALUES
    (2601, 1006, NULL, 'GROUP', '跌倒盖', 'tipover-cover', 0, 1),
    (2602, 1006, NULL, 'GROUP', '跌倒底', 'tipover-base', 0, 2),
    (2603, 1006, NULL, 'GROUP', '钢球', 'steel-ball', 0, 3),
    (2604, 1006, NULL, 'GROUP', '翘板', 'rocker', 0, 4);

INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    (3601, 2601, '跌倒盖KW16 / 有CB字', 1),
    (3602, 2601, '跌倒盖KW16 / 无CB字', 2),
    (3603, 2601, '跌倒盖KB-1', 3),
    (3604, 2602, '跌倒底', 1),
    (3605, 2603, '18mm钢球', 1),
    (3606, 2604, '翘板', 1);

CREATE TABLE custom_table (
    id BIGINT NOT NULL,
    customer_code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(160) NOT NULL,
    contact_person VARCHAR(64) NOT NULL,
    contact_phone VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    province VARCHAR(64) NOT NULL,
    city VARCHAR(64) NOT NULL,
    district VARCHAR(64) NULL,
    town VARCHAR(96) NULL,
    address VARCHAR(300) NOT NULL,
    owner_id BIGINT NOT NULL,
    pay_terms VARCHAR(160) NOT NULL DEFAULT '',
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_by BIGINT NOT NULL,
    updated_by BIGINT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_customer_code (customer_code),
    UNIQUE KEY uk_customer_request (request_key),
    KEY idx_customer_owner (owner_id),
    KEY idx_customer_name (name),
    CONSTRAINT fk_customer_owner FOREIGN KEY (owner_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_customer_creator FOREIGN KEY (created_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_customer_updater FOREIGN KEY (updated_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_customer_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 4 AND 80),
    CONSTRAINT ck_customer_contact CHECK (CHAR_LENGTH(TRIM(contact_person)) BETWEEN 1 AND 32),
    CONSTRAINT ck_customer_phone CHECK (REGEXP_LIKE(contact_phone, '^1[0-9]{10}$')),
    CONSTRAINT ck_customer_region CHECK (CHAR_LENGTH(TRIM(province)) > 0 AND CHAR_LENGTH(TRIM(city)) > 0),
    CONSTRAINT ck_customer_address CHECK (CHAR_LENGTH(TRIM(address)) > 0),
    CONSTRAINT ck_customer_version CHECK (row_version > 0),
    CONSTRAINT ck_customer_request CHECK (CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE customer_owner_history (
    id BIGINT NOT NULL,
    batch_id BIGINT NOT NULL,
    customer_id BIGINT NOT NULL,
    from_owner_id BIGINT NOT NULL,
    to_owner_id BIGINT NOT NULL,
    operator_id BIGINT NOT NULL,
    reason VARCHAR(500) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_customer_owner_history_batch_customer (batch_id, customer_id),
    KEY idx_customer_owner_history_customer_time (customer_id, created_at DESC),
    KEY idx_customer_owner_history_from_time (from_owner_id, created_at DESC),
    CONSTRAINT fk_customer_owner_history_customer FOREIGN KEY (customer_id) REFERENCES custom_table (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_customer_owner_history_from FOREIGN KEY (from_owner_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_customer_owner_history_to FOREIGN KEY (to_owner_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_customer_owner_history_operator FOREIGN KEY (operator_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_customer_owner_history_distinct CHECK (from_owner_id <> to_owner_id),
    CONSTRAINT ck_customer_owner_history_reason CHECK (CHAR_LENGTH(TRIM(reason)) BETWEEN 2 AND 500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sales_order_table (
    id BIGINT NOT NULL,
    order_no VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    customer_id BIGINT NOT NULL,
    bom_id BIGINT NOT NULL,
    qty INT UNSIGNED NOT NULL,
    lifecycle_status ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    order_date DATE NOT NULL,
    deliver_date DATE NOT NULL,
    remark TEXT NOT NULL,
    customer_name_snapshot VARCHAR(160) NOT NULL,
    bom_name_snapshot VARCHAR(64) NOT NULL,
    bom_model_snapshot VARCHAR(64) NOT NULL,
    bom_spec_snapshot JSON NOT NULL,
    cancelled_at DATETIME(3) NULL,
    cancelled_by BIGINT NULL,
    cancel_reason VARCHAR(500) NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_by BIGINT NOT NULL,
    updated_by BIGINT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_sales_order_no (order_no),
    UNIQUE KEY uk_sales_order_request (request_key),
    KEY idx_sales_order_bom_queue (bom_id, lifecycle_status, deliver_date, order_no),
    KEY idx_sales_order_customer_date (customer_id, order_date),
    CONSTRAINT fk_sales_order_customer FOREIGN KEY (customer_id) REFERENCES custom_table (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_sales_order_bom FOREIGN KEY (bom_id) REFERENCES bom_table (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_sales_order_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_sales_order_creator FOREIGN KEY (created_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_sales_order_updater FOREIGN KEY (updated_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_sales_order_qty CHECK (qty > 0),
    CONSTRAINT ck_sales_order_bom_snapshot CHECK (JSON_TYPE(bom_spec_snapshot) = 'OBJECT'),
    CONSTRAINT ck_sales_order_cancel CHECK (
        (lifecycle_status = 'ACTIVE' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
        OR
        (lifecycle_status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
            AND CHAR_LENGTH(TRIM(cancel_reason)) BETWEEN 2 AND 500)
    ),
    CONSTRAINT ck_sales_order_version CHECK (row_version > 0),
    CONSTRAINT ck_sales_order_request CHECK (CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sales_order_change_log (
    id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    operator_id BIGINT NOT NULL,
    event_type ENUM('CREATE', 'UPDATE', 'CANCEL') NOT NULL,
    before_version BIGINT UNSIGNED NULL,
    after_version BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(500) NOT NULL DEFAULT '',
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    before_json JSON NULL,
    after_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_sales_order_change_request (request_key),
    KEY idx_sales_order_change_order_time (order_id, created_at DESC),
    KEY idx_sales_order_change_operator_time (operator_id, created_at DESC),
    CONSTRAINT fk_sales_order_change_order FOREIGN KEY (order_id) REFERENCES sales_order_table (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_sales_order_change_operator FOREIGN KEY (operator_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_sales_order_change_before CHECK (before_json IS NULL OR JSON_TYPE(before_json) = 'OBJECT'),
    CONSTRAINT ck_sales_order_change_after CHECK (JSON_TYPE(after_json) = 'OBJECT'),
    CONSTRAINT ck_sales_order_change_versions CHECK (
        (event_type = 'CREATE' AND before_version IS NULL AND after_version = 1)
        OR (event_type IN ('UPDATE', 'CANCEL') AND before_version IS NOT NULL AND after_version = before_version + 1)
    ),
    CONSTRAINT ck_sales_order_change_reason CHECK (
        event_type <> 'CANCEL'
        OR (CHAR_LENGTH(TRIM(reason)) BETWEEN 2 AND 500 AND request_key IS NOT NULL)
    ),
    CONSTRAINT ck_sales_order_change_request CHECK (
        (request_key IS NULL OR CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
        AND (event_type NOT IN ('CREATE', 'CANCEL') OR request_key IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE inbound_ledger (
    id BIGINT NOT NULL,
    entry_no VARCHAR(28) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    bom_id BIGINT NOT NULL,
    qty INT UNSIGNED NOT NULL,
    business_date DATE NOT NULL,
    operator_id BIGINT NOT NULL,
    remark VARCHAR(500) NOT NULL DEFAULT '',
    status ENUM('ACTIVE', 'VOIDED') NOT NULL DEFAULT 'ACTIVE',
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    updated_by BIGINT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_inbound_entry_no (entry_no),
    UNIQUE KEY uk_inbound_request (request_key),
    KEY idx_inbound_bom_status_date (bom_id, status, business_date, id),
    CONSTRAINT fk_inbound_bom FOREIGN KEY (bom_id) REFERENCES bom_table (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_inbound_operator FOREIGN KEY (operator_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_inbound_updater FOREIGN KEY (updated_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_inbound_qty CHECK (qty > 0),
    CONSTRAINT ck_inbound_version CHECK (row_version > 0),
    CONSTRAINT ck_inbound_request CHECK (CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE inbound_change_log (
    id BIGINT NOT NULL,
    inbound_id BIGINT NOT NULL,
    operator_id BIGINT NOT NULL,
    event_type ENUM('UPDATE', 'VOID') NOT NULL,
    before_version BIGINT UNSIGNED NOT NULL,
    after_version BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(500) NOT NULL,
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    before_json JSON NOT NULL,
    after_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_inbound_change_request (request_key),
    KEY idx_inbound_change_entry_time (inbound_id, created_at DESC),
    KEY idx_inbound_change_operator_time (operator_id, created_at DESC),
    CONSTRAINT fk_inbound_change_entry FOREIGN KEY (inbound_id) REFERENCES inbound_ledger (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_inbound_change_operator FOREIGN KEY (operator_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_inbound_change_versions CHECK (after_version = before_version + 1),
    CONSTRAINT ck_inbound_change_reason CHECK (CHAR_LENGTH(TRIM(reason)) BETWEEN 2 AND 500),
    CONSTRAINT ck_inbound_change_request CHECK (
        (request_key IS NULL OR CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
        AND (event_type <> 'VOID' OR request_key IS NOT NULL)
    ),
    CONSTRAINT ck_inbound_change_before CHECK (JSON_TYPE(before_json) = 'OBJECT'),
    CONSTRAINT ck_inbound_change_after CHECK (JSON_TYPE(after_json) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE stock_adjustment (
    id BIGINT NOT NULL,
    adjustment_no VARCHAR(28) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    bom_id BIGINT NOT NULL,
    qty_delta INT NOT NULL,
    business_date DATE NOT NULL,
    related_inbound_id BIGINT NULL,
    reversal_of_id BIGINT NULL,
    operator_id BIGINT NOT NULL,
    reason VARCHAR(500) NOT NULL,
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_stock_adjustment_no (adjustment_no),
    UNIQUE KEY uk_stock_adjustment_request (request_key),
    UNIQUE KEY uk_stock_adjustment_reversal_once (reversal_of_id),
    KEY idx_stock_adjustment_bom_date (bom_id, business_date, id),
    KEY idx_stock_adjustment_inbound (related_inbound_id, created_at DESC),
    CONSTRAINT fk_stock_adjustment_bom FOREIGN KEY (bom_id) REFERENCES bom_table (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_stock_adjustment_inbound FOREIGN KEY (related_inbound_id) REFERENCES inbound_ledger (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_stock_adjustment_reversal FOREIGN KEY (reversal_of_id) REFERENCES stock_adjustment (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_stock_adjustment_operator FOREIGN KEY (operator_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_stock_adjustment_qty CHECK (qty_delta <> 0),
    CONSTRAINT ck_stock_adjustment_reason CHECK (CHAR_LENGTH(TRIM(reason)) BETWEEN 2 AND 500),
    CONSTRAINT ck_stock_adjustment_request CHECK (CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE outbound_shipment (
    id BIGINT NOT NULL,
    shipment_no VARCHAR(28) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    order_id BIGINT NOT NULL,
    original_qty INT UNSIGNED NOT NULL,
    business_date DATE NOT NULL,
    state ENUM('REGISTERED', 'PRINTED', 'VOIDED') NOT NULL DEFAULT 'REGISTERED',
    void_mode ENUM('PRE_PRINT', 'EMERGENCY') NULL,
    voided_by BIGINT NULL,
    void_reason VARCHAR(500) NULL,
    goods_not_departed TINYINT UNSIGNED NULL,
    paper_invalidated TINYINT UNSIGNED NULL,
    voided_at DATETIME(3) NULL,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    registered_by BIGINT NOT NULL,
    registered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_outbound_shipment_no (shipment_no),
    UNIQUE KEY uk_outbound_shipment_request (request_key),
    KEY idx_outbound_shipment_order_state_date (order_id, state, business_date, id),
    KEY idx_outbound_shipment_state_time (state, registered_at),
    CONSTRAINT fk_outbound_shipment_order FOREIGN KEY (order_id) REFERENCES sales_order_table (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_outbound_shipment_registrar FOREIGN KEY (registered_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_outbound_shipment_voider FOREIGN KEY (voided_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_outbound_shipment_qty CHECK (original_qty > 0),
    CONSTRAINT ck_outbound_shipment_version CHECK (row_version > 0),
    CONSTRAINT ck_outbound_shipment_flags CHECK (
        (goods_not_departed IS NULL OR goods_not_departed IN (0, 1))
        AND (paper_invalidated IS NULL OR paper_invalidated IN (0, 1))
    ),
    CONSTRAINT ck_outbound_shipment_void CHECK (
        (state <> 'VOIDED' AND void_mode IS NULL AND voided_by IS NULL AND void_reason IS NULL
            AND goods_not_departed IS NULL AND paper_invalidated IS NULL AND voided_at IS NULL)
        OR
        (state = 'VOIDED' AND void_mode = 'PRE_PRINT' AND voided_by IS NOT NULL
            AND CHAR_LENGTH(TRIM(void_reason)) BETWEEN 2 AND 500
            AND goods_not_departed IS NULL AND paper_invalidated IS NULL AND voided_at IS NOT NULL)
        OR
        (state = 'VOIDED' AND void_mode = 'EMERGENCY' AND voided_by IS NOT NULL
            AND CHAR_LENGTH(TRIM(void_reason)) BETWEEN 2 AND 500
            AND goods_not_departed = 1 AND paper_invalidated = 1 AND voided_at IS NOT NULL)
    ),
    CONSTRAINT ck_outbound_shipment_request CHECK (CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE outbound_ledger (
    id BIGINT NOT NULL,
    event_no VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    shipment_id BIGINT NOT NULL,
    entry_type ENUM('NORMAL', 'CORRECTION') NOT NULL,
    correction_of_id BIGINT NULL,
    qty_delta INT NOT NULL,
    business_date DATE NOT NULL,
    operator_id BIGINT NOT NULL,
    remark VARCHAR(500) NOT NULL DEFAULT '',
    correction_reason VARCHAR(500) NULL,
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_outbound_event_no (event_no),
    UNIQUE KEY uk_outbound_request (request_key),
    KEY idx_outbound_shipment_date (shipment_id, business_date, id),
    UNIQUE KEY uk_outbound_correction_once (correction_of_id),
    CONSTRAINT fk_outbound_shipment FOREIGN KEY (shipment_id) REFERENCES outbound_shipment (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_outbound_operator FOREIGN KEY (operator_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_outbound_correction FOREIGN KEY (correction_of_id) REFERENCES outbound_ledger (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_outbound_entry CHECK (
        (entry_type = 'NORMAL' AND correction_of_id IS NULL AND qty_delta > 0 AND correction_reason IS NULL)
        OR
        (entry_type = 'CORRECTION' AND correction_of_id IS NOT NULL AND qty_delta < 0
            AND CHAR_LENGTH(TRIM(correction_reason)) BETWEEN 2 AND 500)
    ),
    CONSTRAINT ck_outbound_ledger_request CHECK (CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE SQL SECURITY INVOKER VIEW v_order_outbound_qty AS
SELECT
    shipment.order_id,
    COALESCE(SUM(event.qty_delta), 0) AS outbound_qty
FROM outbound_shipment AS shipment
JOIN outbound_ledger AS event ON event.shipment_id = shipment.id
GROUP BY shipment.order_id;

CREATE SQL SECURITY INVOKER VIEW v_bom_stock AS
SELECT movement.bom_id, SUM(movement.qty_delta) AS stock_qty
FROM (
    SELECT inbound.bom_id, CAST(inbound.qty AS SIGNED) AS qty_delta
    FROM inbound_ledger AS inbound
    WHERE inbound.status = 'ACTIVE'
    UNION ALL
    SELECT adjustment.bom_id, adjustment.qty_delta
    FROM stock_adjustment AS adjustment
    UNION ALL
    SELECT sales_order.bom_id, -event.qty_delta AS qty_delta
    FROM outbound_ledger AS event
    JOIN outbound_shipment AS shipment ON shipment.id = event.shipment_id
    JOIN sales_order_table AS sales_order ON sales_order.id = shipment.order_id
) AS movement
GROUP BY movement.bom_id;

CREATE TABLE outbound_print_log (
    id BIGINT NOT NULL,
    shipment_id BIGINT NOT NULL,
    print_seq INT UNSIGNED NOT NULL,
    printed_by BIGINT NOT NULL,
    reason VARCHAR(500) NOT NULL DEFAULT '',
    document_snapshot JSON NOT NULL,
    document_hash BINARY(32) NOT NULL,
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    printed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_outbound_print_seq (shipment_id, print_seq),
    UNIQUE KEY uk_outbound_print_request (request_key),
    KEY idx_outbound_print_operator_time (printed_by, printed_at DESC),
    CONSTRAINT fk_outbound_print_shipment FOREIGN KEY (shipment_id) REFERENCES outbound_shipment (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_outbound_print_operator FOREIGN KEY (printed_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_outbound_print_seq CHECK (print_seq > 0),
    CONSTRAINT ck_outbound_print_snapshot CHECK (JSON_TYPE(document_snapshot) = 'OBJECT'),
    CONSTRAINT ck_outbound_print_request CHECK (CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE outbound_state_log (
    id BIGINT NOT NULL,
    shipment_id BIGINT NOT NULL,
    operator_id BIGINT NOT NULL,
    event_type ENUM('REGISTER', 'PRINT', 'REPRINT', 'VOID_PRE_PRINT', 'VOID_EMERGENCY') NOT NULL,
    before_state ENUM('REGISTERED', 'PRINTED', 'VOIDED') NULL,
    after_state ENUM('REGISTERED', 'PRINTED', 'VOIDED') NOT NULL,
    before_version BIGINT UNSIGNED NULL,
    after_version BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(500) NOT NULL DEFAULT '',
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    detail_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_outbound_state_request (request_key),
    KEY idx_outbound_state_shipment_time (shipment_id, created_at DESC),
    KEY idx_outbound_state_operator_time (operator_id, created_at DESC),
    CONSTRAINT fk_outbound_state_shipment FOREIGN KEY (shipment_id) REFERENCES outbound_shipment (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_outbound_state_operator FOREIGN KEY (operator_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_outbound_state_detail CHECK (JSON_TYPE(detail_json) = 'OBJECT'),
    CONSTRAINT ck_outbound_state_request CHECK (
        CHAR_LENGTH(request_key) BETWEEN 8 AND 128
    ),
    CONSTRAINT ck_outbound_state_versions CHECK (
        (event_type = 'REGISTER' AND before_version IS NULL AND after_version = 1)
        OR (event_type <> 'REGISTER' AND before_version IS NOT NULL AND after_version = before_version + 1)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE op_log (
    id BIGINT NOT NULL,
    operator_id BIGINT NOT NULL,
    operator_name_snapshot VARCHAR(64) NOT NULL,
    operator_role_snapshot VARCHAR(32) NOT NULL,
    action ENUM('ship', 'create_customer', 'create_order') NOT NULL,
    target_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    target_id BIGINT NOT NULL,
    target_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    detail_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_op_log_action_target (action, target_id),
    KEY idx_op_log_time (created_at DESC),
    KEY idx_op_log_operator_time (operator_id, created_at DESC),
    CONSTRAINT fk_op_log_operator FOREIGN KEY (operator_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_op_log_detail CHECK (JSON_TYPE(detail_json) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 生产运行账号权限原则（实际账号名由部署环境替换）：
-- 1. 不授予 custom_table / bom_table / sales_order_table / sys_user 的 DELETE。
-- 2. inbound_ledger 仅由带当天窗口、版本检查和审计日志的业务事务 UPDATE；不授予 DELETE。
-- 3. 不授予 stock_adjustment / outbound_ledger / 各日志表的 UPDATE 或 DELETE。
-- 4. 仅迁移账号拥有 ALTER / DROP / REFERENCES。

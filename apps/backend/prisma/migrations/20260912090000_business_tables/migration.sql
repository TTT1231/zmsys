-- 业务数据层：14 张业务表 + 2 个聚合视图 + bom_category 内置品类种子。
-- 内容与 docs/db/mysql-8-schema.sql 逐字一致，仅截取本批次对象（自 bom_category 起）。
-- 外键全部 RESTRICT；request_key 唯一键即幂等键的业务行落地（db-scheme.md §1.3）。
-- 订单交货日期为单个日历日 deliver_date（2026-09-12 契约变更，替换原起止两列）。

CREATE TABLE bom_category (
    id BIGINT NOT NULL,
    category_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(64) NOT NULL,
    code_prefix VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    seq_width TINYINT UNSIGNED NOT NULL DEFAULT 3,
    spec_schema JSON NOT NULL,
    status TINYINT UNSIGNED NOT NULL DEFAULT 1,
    row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_bom_category_key (category_key),
    UNIQUE KEY uk_bom_category_name (name),
    UNIQUE KEY uk_bom_category_prefix (code_prefix),
    CONSTRAINT ck_bom_category_width CHECK (seq_width BETWEEN 3 AND 8),
    CONSTRAINT ck_bom_category_schema CHECK (JSON_TYPE(spec_schema) = 'OBJECT'),
    CONSTRAINT ck_bom_category_status CHECK (status IN (0, 1)),
    CONSTRAINT ck_bom_category_version CHECK (row_version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 1–9999 为内置参考数据保留 id；业务 Snowflake id 不得使用该区间。
INSERT INTO bom_category (id, category_key, name, code_prefix, seq_width, spec_schema) VALUES
    (
        1001, 'rotary-switch', '旋转开关', 'XK2', 3,
        '{"fields":[{"key":"脚位","label":"脚位","type":"select","options":["二脚","三脚","四脚","五脚","六脚"],"required":true},{"key":"档位","label":"档位","type":"select","options":["一档","两档","三档","四档","五档","六档","八档"],"required":true},{"key":"规格","label":"规格","type":"text","placeholder":"如 222-1"},{"key":"方向","label":"方向","type":"text","placeholder":"如 正面"},{"key":"银点厚度","label":"银点厚度","type":"select","options":["0.2","0.3"],"initial":"0.2"},{"key":"弹簧","label":"弹簧","type":"select","options":["0.5","0.55","0.6"],"initial":"0.5"},{"key":"杆子高度","label":"杆子高度","type":"text","defaultValue":"4.8"},{"key":"A面触点","label":"A面触点","type":"text","defaultValue":"A面银点"},{"key":"B面触点","label":"B面触点","type":"text","defaultValue":"B面塑料盖板"}]}'
    ),
    (
        1002, 'xk3', 'XK3', 'XK3', 3,
        '{"fields":[{"key":"外壳","label":"外壳","type":"select","options":["圆孔长外壳（茶色）","圆孔长外壳（透明）","圆孔短外壳（茶色）","椭圆孔长外壳无CB字（茶色）","无耳外壳无CB字（茶色）"],"required":true},{"key":"底座","label":"底座","type":"select","options":["茶色","透明"],"required":true},{"key":"杆子","label":"杆子","type":"select","options":["圆轴长杆子","圆轴短杆子","扁轴4.8","扁轴4.8转90°"],"required":true},{"key":"小静片","label":"小静片","type":"select","options":["不电镀","镀锡"],"required":true},{"key":"半圆静片","label":"半圆静片","type":"select","options":["不电镀","镀锡"],"required":true},{"key":"动片","label":"动片","type":"select","options":["不电镀","镀锡"],"required":true},{"key":"卡线片","label":"卡线片","type":"select","options":["0.15","0.2"],"required":true},{"key":"弹簧","label":"弹簧","type":"select","options":["0.45长弹簧","0.45短弹簧"],"required":true},{"key":"带圈动片","label":"带圈动片","type":"text","defaultValue":"不电镀"},{"key":"钢球","label":"钢球","type":"text","defaultValue":"4.0mm电镀钢球"}]}'
    ),
    (
        1003, 'new-micro-switch', '新微动', 'KW', 4,
        '{"fields":[{"key":"底座","label":"底座","type":"select","options":["二脚底座（无挡脚）","三脚底座（有挡脚）"],"required":true},{"key":"按钮高度","label":"按钮高度","type":"select","options":["7.6mm（常用装跌倒）","8.0mm","8.1mm","8.2mm圆弧","8.3mm","8.5mm","8.8mm","9.1mm"],"required":true},{"key":"支架","label":"支架","type":"select","options":["6.3支架：铜镀银","6.3支架：铜镀镍","6.3支架：复合铜镀镍","4.8支架：铜镀镍","4.8支架：复合铜镀镍"],"required":true},{"key":"静片","label":"静片","type":"select","options":["6.3静片：铜镀银","6.3静片：铜镀镍","6.3静片：复合铜镀镍","4.8静片：铜镀镍","4.8静片：复合铜镀镍"],"required":true},{"key":"动片","label":"动片","type":"select","options":["铜镀银","镀锡"],"required":true},{"key":"摆片","label":"摆片","type":"select","options":["铜镀银摆片","铁镀镍摆片","复合铜镀镍摆片"],"required":true},{"key":"弹片","label":"弹片","type":"select","options":["0.12","0.15","0.2"],"required":true}]}'
    ),
    (
        1004, 'old-micro-switch', '老微动', 'KW16', 3,
        '{"fields":[{"key":"底座","label":"底座","type":"select","options":["带CB","不带CB"],"required":true},{"key":"按钮","label":"按钮","type":"select","options":["8.5mm（常用装跌倒）","8.9mm","9.6mm"],"required":true},{"key":"弹簧","label":"弹簧","type":"select","options":["0.25","0.27"],"initial":"0.25"},{"key":"支架","label":"支架","type":"text","defaultValue":"6.3镀银"},{"key":"静片","label":"静片","type":"text","defaultValue":"6.3镀银"},{"key":"弹片","label":"弹片","type":"text","defaultValue":"0.12"}]}'
    ),
    (
        1005, 'piano-key-switch', '琴键开关', 'KQ', 3,
        '{"fields":[{"key":"类型","label":"类型","type":"select","options":["四键焊线","四键插线","小太阳四键三档（摇头）","小太阳四键二档（不摇头）","冷风扇琴键（茶色）","冷风扇琴键（透明大功率带触点）"],"required":true},{"key":"卡板","label":"卡板","type":"select","options":["大卡板18mm+小卡板18mm+短卡板16mm","小卡板18mm+短卡板16mm","小卡板18mm+大卡板18mm"]},{"key":"弹簧","label":"弹簧","type":"select","options":["0.3","0.35"]},{"key":"触点","label":"触点","type":"select","options":["带点","不带点"]},{"key":"五金件明细","label":"五金件明细","type":"text","placeholder":"如 扣板×2+连锁片+带点静片+带点动片（数量 1 省略不写）"}]}'
    );

CREATE TABLE bom_table (
    id BIGINT NOT NULL,
    bom_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    category_id BIGINT NOT NULL,
    model_code VARCHAR(64) NOT NULL,
    spec JSON NOT NULL,
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
    UNIQUE KEY uk_bom_identity (category_id, model_code, spec_hash),
    UNIQUE KEY uk_bom_request (request_key),
    KEY idx_bom_category_status (category_id, status),
    KEY idx_bom_model (model_code),
    CONSTRAINT fk_bom_category FOREIGN KEY (category_id) REFERENCES bom_category (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_bom_creator FOREIGN KEY (created_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_bom_updater FOREIGN KEY (updated_by) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_bom_spec CHECK (JSON_TYPE(spec) = 'OBJECT'),
    CONSTRAINT ck_bom_model CHECK (CHAR_LENGTH(TRIM(model_code)) BETWEEN 1 AND 64),
    CONSTRAINT ck_bom_status CHECK (status IN (0, 1)),
    CONSTRAINT ck_bom_version CHECK (row_version > 0),
    CONSTRAINT ck_bom_request CHECK (CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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

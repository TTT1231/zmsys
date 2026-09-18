-- 物料目录改造（一次性 dev 重置迁移，破坏性、不可回滚）：
-- 1) 库名守卫：仅允许 zmdb（开发）/ zmdb_test（e2e），其余库插入 NULL 触发错误中止；
-- 2) 清空全部业务数据（含真实表名全量依赖清单，见下）；
-- 3) bom_category 去 spec_schema、删除 xk3 / 琴键开关 品类；
-- 4) bom_table 去 model_code / spec，判重键改为 (category_id, spec_hash)；
-- 5) 新建 material_group / material_item / bom_item 并播种 3 品类物料目录。
-- 目录不可变边界（db-scheme.md §5）：已被 bom_item 引用的物料不得改名/移组/复用 id，
-- 规格变化 = 新增物料项 + 旧项停用；停用只影响新建，已建 BOM 依靠快照完整展示。

-- ── 库名守卫 ────────────────────────────────────────────────────────────────
CREATE TABLE _dev_reset_guard (db_name VARCHAR(64) NOT NULL);
INSERT INTO _dev_reset_guard (db_name)
SELECT NULL WHERE DATABASE() NOT REGEXP '^zmdb(_test)?$';

-- ── 清空业务数据（TRUNCATE 隐式提交；同连接关/恢复外键检查） ────────────────
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE op_log;
TRUNCATE TABLE outbound_state_log;
TRUNCATE TABLE outbound_print_log;
TRUNCATE TABLE outbound_ledger;
TRUNCATE TABLE outbound_shipment;
TRUNCATE TABLE stock_adjustment;
TRUNCATE TABLE inbound_change_log;
TRUNCATE TABLE inbound_ledger;
TRUNCATE TABLE sales_order_change_log;
TRUNCATE TABLE sales_order_table;
TRUNCATE TABLE bom_table;
TRUNCATE TABLE api_idempotency;
-- 业务序列按前缀清理（customer:global 保留）
DELETE FROM biz_sequence
WHERE sequence_key LIKE 'bom:%'
   OR sequence_key LIKE 'order:%'
   OR sequence_key LIKE 'inbound:%'
   OR sequence_key LIKE 'outbound:%'
   OR sequence_key LIKE 'adjust:%';
SET FOREIGN_KEY_CHECKS = 1;

-- ── 清理后残留校验：任一业务表仍有行则中止 ──────────────────────────────────
INSERT INTO _dev_reset_guard (db_name)
SELECT NULL
WHERE EXISTS (SELECT 1 FROM sales_order_table)
   OR EXISTS (SELECT 1 FROM inbound_ledger)
   OR EXISTS (SELECT 1 FROM outbound_shipment)
   OR EXISTS (SELECT 1 FROM outbound_ledger)
   OR EXISTS (SELECT 1 FROM stock_adjustment)
   OR EXISTS (SELECT 1 FROM bom_table)
   OR EXISTS (SELECT 1 FROM api_idempotency)
   OR EXISTS (SELECT 1 FROM biz_sequence WHERE sequence_key LIKE 'bom:%');

-- ── bom_category：去 spec_schema，删除 xk3 / 琴键开关 ───────────────────────
ALTER TABLE bom_category
    DROP CHECK ck_bom_category_schema,
    DROP COLUMN spec_schema;

DELETE FROM bom_category WHERE category_key IN ('xk3', 'piano-key-switch');

-- ── bom_table：去 model_code / spec，判重键改为 (category_id, spec_hash) ────
ALTER TABLE bom_table
    DROP KEY idx_bom_model,
    DROP KEY uk_bom_identity,
    DROP CHECK ck_bom_spec,
    DROP CHECK ck_bom_model,
    DROP COLUMN model_code,
    DROP COLUMN spec,
    ADD UNIQUE KEY uk_bom_identity (category_id, spec_hash);

-- ── 物料目录三张表 ──────────────────────────────────────────────────────────
-- 分区（SECTION）只能是根节点、不挂物料、无 key/multi；分组（GROUP）必须有
-- group_key/multi，可直接挂品类或挂同品类分区下（跨品类/超两级由种子与校验保证）
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

-- BOM 明细（无数量）：建档冻结 group_key/group_name/name/position，与目录解耦
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

-- ── 目录种子：仅 3 品类；id 段 2001+ 分区/组、3001+ 物料 ────────────────────
-- 旋转开关（1001 / XK2 / 3）：无分区，7 个单选组；触点大小待补选项值
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, sort_order) VALUES
    (2001, 1001, NULL, 'GROUP', '型号', 'model', 0, 1),
    (2002, 1001, NULL, 'GROUP', '触点大小', 'contact-size', 0, 2),
    (2003, 1001, NULL, 'GROUP', '银丝厚度', 'silver-wire-thickness', 0, 3),
    (2004, 1001, NULL, 'GROUP', '杆子点位厚度', 'lever-point-thickness', 0, 4),
    (2005, 1001, NULL, 'GROUP', 'A面', 'face-a', 0, 5),
    (2006, 1001, NULL, 'GROUP', 'B面', 'face-b', 0, 6),
    (2007, 1001, NULL, 'GROUP', '弹簧', 'spring', 0, 7);

INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    (3001, 2001, '1-1', 1),
    (3002, 2001, '2-1', 2),
    (3003, 2003, '0.2', 1),
    (3004, 2003, '0.3', 2),
    (3005, 2004, '4.8', 1),
    (3006, 2005, 'A面银点', 1),
    (3007, 2006, 'B面塑料盖板', 1),
    (3008, 2007, '0.5', 1),
    (3009, 2007, '0.55', 2),
    (3010, 2007, '0.6', 3);

-- 新微动（1003 / KW / 4）：PA66塑料 / 五金件 两分区，分区内按部件类型单选组
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
    (2118, 1003, 2102, 'GROUP', '弹片', 'spring-plate', 0, 5);

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
    (3129, 2118, '0.2', 3);

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
    (2218, 1004, 2202, 'GROUP', '挡脚', 'stop-foot', 0, 5);

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
    (3212, 2218, '挡脚', 1);

DROP TABLE _dev_reset_guard;

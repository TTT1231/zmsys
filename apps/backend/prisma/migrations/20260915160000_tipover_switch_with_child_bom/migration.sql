-- 新增「跌倒开关」品类（2026-09-15）：BOM 嵌套 BOM 的首个用例。
-- 跌倒开关 = 跌倒盖/跌倒底/18mm钢球/翘板 等普通物料 + 一个已建档的微动开关 BOM（新微动或老微动）作为子件。
-- - bom_category 新列 child_categories（JSON 数组，品类 key 列表）：标记该品类建档必须选择列表内
--   品类的某个 BOM 作为子件；列表由迁移维护，不含自身 → 结构上杜绝引用环。
-- - bom_table 新列 child_bom_id（可空，自引用 FK）：子件引用；判重 hash 将该 id 并入物料 id 集合
--   （同物料集合、不同微动子件 = 两个不同档案）。
-- 编码前缀 DD（KW16 已被老微动占用），如需更换走迁移调整。

ALTER TABLE bom_category
    ADD COLUMN child_categories JSON NULL
        AFTER seq_width,
    ADD CONSTRAINT ck_bom_category_children CHECK (
        child_categories IS NULL OR JSON_TYPE(child_categories) = 'ARRAY'
    );

ALTER TABLE bom_table
    ADD COLUMN child_bom_id BIGINT NULL AFTER category_id,
    ADD CONSTRAINT fk_bom_child FOREIGN KEY (child_bom_id) REFERENCES bom_table (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD KEY idx_bom_child (child_bom_id);

INSERT INTO bom_category (id, category_key, name, code_prefix, seq_width, child_categories) VALUES
    (1006, 'tipover-switch', '跌倒开关', 'DD', 3, '["new-micro-switch", "old-micro-switch"]');

-- 跌倒开关普通物料目录：四个根单选组
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

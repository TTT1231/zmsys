-- 跌倒开关改为「品类子选合并目录」模式（2026-09-16 业务纠正）：
-- 建跌倒开关 BOM 时，先选微动开关类型（新微动 / 老微动，childCategory 二选一），
-- 可选物料 = 跌倒开关自身目录 + 所选微动品类的完整目录（分区/分组/物料原样并入树中），
-- 全部走普通物料勾选，不引用任何已建 BOM。
-- - 删除 bom_table.child_bom_id（上一版的子件 BOM 引用方案废弃）
-- - bom_category.child_categories 保留：标记该品类建档需附带选择一个子品类目录

ALTER TABLE bom_table
    DROP FOREIGN KEY fk_bom_child,
    DROP KEY idx_bom_child,
    DROP COLUMN child_bom_id;

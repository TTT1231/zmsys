-- 安全开关五金件分组重建（生产库 2026-09-16 应用的迁移回填仓库）：
-- 废弃旧分组 2512/2513（31mm/43mm 系列），四个系列（30/31/41/43mm）统一为
-- 多选组 2611-2614 挂 2503 五金件分区下；原 2512/2513 的物料 3507-3516
-- 平移到新组（3507-3511 → 2612，3512-3516 → 2614），id 与名称不变。
-- 旧组先改名/改 key 让出唯一键（uk_material_group_name / _key），物料移组后删除
UPDATE material_group SET name = '短款/31mm系列配件（重建中）', group_key = 'short-31-parts-old' WHERE id = 2512;
UPDATE material_group SET name = '长款/43mm系列配件（重建中）', group_key = 'long-43-parts-old' WHERE id = 2513;

INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, sort_order) VALUES
    (2612, 1005, 2503, 'GROUP', '短款/31mm系列配件', 'short-31-parts', 1, 2),
    (2614, 1005, 2503, 'GROUP', '长款/43mm系列配件', 'long-43-parts', 1, 4);

UPDATE material_item SET group_id = 2612 WHERE id IN (3507, 3508, 3509, 3510, 3511);
UPDATE material_item SET group_id = 2614 WHERE id IN (3512, 3513, 3514, 3515, 3516);

DELETE FROM material_group WHERE id IN (2512, 2513);

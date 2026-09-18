-- 旋转XK2 补充触点分区（生产库 2026-09-16 应用的目录迁移回填仓库）：
-- SECTION 2607 触点 + 大小/厚度/类别三个单选组，挂 2007 弹簧之后（sort_order 8）
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, sort_order) VALUES
    (2607, 1001, NULL, 'SECTION', '触点', NULL, NULL, 8),
    (2608, 1001, 2607, 'GROUP', '触点大小', 'contact-size', 0, 1),
    (2609, 1001, 2607, 'GROUP', '触点厚度', 'contact-thickness', 0, 2),
    (2610, 1001, 2607, 'GROUP', '触点类别', 'contact-kind', 0, 3);

INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    (3617, 2608, '0.3', 1),
    (3618, 2608, '0.35', 2),
    (3619, 2609, '0.15', 1),
    (3620, 2609, '0.2', 2),
    (3621, 2609, '0.3', 3),
    (3622, 2610, '铜', 1),
    (3623, 2610, '银', 2);

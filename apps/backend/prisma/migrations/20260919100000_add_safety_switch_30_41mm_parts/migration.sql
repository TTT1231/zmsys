-- 安全开关五金件补充短款 30mm / 长款 41mm 系列配件分组与物料
-- （生产库 2026-09-16 应用的目录迁移回填仓库；后续 20260919140000 重建分组结构）
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, sort_order) VALUES
    (2611, 1005, 2503, 'GROUP', '短款/30mm系列配件', 'short-30-parts', 1, 1),
    (2613, 1005, 2503, 'GROUP', '长款/41mm系列配件', 'long-41-parts', 1, 3);

INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    (3607, 2611, '动片', 1),
    (3608, 2611, '静片', 2),
    (3609, 2611, '短杆子', 3),
    (3610, 2611, '短帽子', 4),
    (3611, 2611, '短弹簧', 5),
    (3612, 2613, '动片', 1),
    (3613, 2613, '静片', 2),
    (3614, 2613, '长杆子', 3),
    (3615, 2613, '长帽子', 4),
    (3616, 2613, '长弹簧', 5);

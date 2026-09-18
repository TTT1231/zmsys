-- 触点目录调整（2026-09-15 三次口述）：
-- 1) 旋转XK2 删除「触点大小」（组 2002）与「银丝厚度」（组 2003）及其物料；
--    引用这些物料的 bom_item 一并删除（当前仅 dev 演示档案，业务确认可弃）。
-- 2) 新微动 / 老微动各新增「触点」分区，内含三个单选组：
--    大小（0.3、0.35）、厚度（0.15、0.2、0.3）、类别（铜、银）。

-- ── 旋转XK2：删组并收拢序号 ────────────────────────────────────────────────
DELETE bi FROM bom_item bi
JOIN material_item mi ON mi.id = bi.material_id
WHERE mi.group_id IN (2002, 2003);

DELETE FROM material_item WHERE group_id IN (2002, 2003);
DELETE FROM material_group WHERE id IN (2002, 2003);
UPDATE material_group SET sort_order = sort_order - 2 WHERE category_id = 1001 AND sort_order > 5;

-- ── 新微动（1003）：触点分区（2103）+ 大小/厚度/类别（2119-2121）──────────
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, sort_order) VALUES
    (2103, 1003, NULL, 'SECTION', '触点', NULL, NULL, 3),
    (2119, 1003, 2103, 'GROUP', '大小', 'contact-size', 0, 1),
    (2120, 1003, 2103, 'GROUP', '厚度', 'contact-thickness', 0, 2),
    (2121, 1003, 2103, 'GROUP', '类别', 'contact-kind', 0, 3);

INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    (3131, 2119, '0.3', 1),
    (3132, 2119, '0.35', 2),
    (3133, 2120, '0.15', 1),
    (3134, 2120, '0.2', 2),
    (3135, 2120, '0.3', 3),
    (3136, 2121, '铜', 1),
    (3137, 2121, '银', 2);

-- ── 老微动（1004）：触点分区（2203）+ 大小/厚度/类别（2219-2221）──────────
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, sort_order) VALUES
    (2203, 1004, NULL, 'SECTION', '触点', NULL, NULL, 3),
    (2219, 1004, 2203, 'GROUP', '大小', 'contact-size', 0, 1),
    (2220, 1004, 2203, 'GROUP', '厚度', 'contact-thickness', 0, 2),
    (2221, 1004, 2203, 'GROUP', '类别', 'contact-kind', 0, 3);

INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    (3141, 2219, '0.3', 1),
    (3142, 2219, '0.35', 2),
    (3143, 2220, '0.15', 1),
    (3144, 2220, '0.2', 2),
    (3145, 2220, '0.3', 3),
    (3146, 2221, '铜', 1),
    (3147, 2221, '银', 2);

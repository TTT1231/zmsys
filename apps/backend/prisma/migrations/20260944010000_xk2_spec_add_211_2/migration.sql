-- 旋转XK2 规格分组（组 2008）在「211-1」(3071) 之后新增「211-2」（新规格目录项）：
-- 纯目录新增，无既有 BOM 引用；id 顺延当前 MAX(material_item.id)=3764 取 3765。
-- 插入位 sort_order=2，同组 3072-3092 依次后移一位（幂等重申终态，参照 20260919150000）。

UPDATE material_item SET sort_order = 3 WHERE id = 3072;
UPDATE material_item SET sort_order = 4 WHERE id = 3073;
UPDATE material_item SET sort_order = 5 WHERE id = 3074;
UPDATE material_item SET sort_order = 6 WHERE id = 3075;
UPDATE material_item SET sort_order = 7 WHERE id = 3076;
UPDATE material_item SET sort_order = 8 WHERE id = 3077;
UPDATE material_item SET sort_order = 9 WHERE id = 3078;
UPDATE material_item SET sort_order = 10 WHERE id = 3079;
UPDATE material_item SET sort_order = 11 WHERE id = 3080;
UPDATE material_item SET sort_order = 12 WHERE id = 3081;
UPDATE material_item SET sort_order = 13 WHERE id = 3082;
UPDATE material_item SET sort_order = 14 WHERE id = 3083;
UPDATE material_item SET sort_order = 15 WHERE id = 3084;
UPDATE material_item SET sort_order = 16 WHERE id = 3085;
UPDATE material_item SET sort_order = 17 WHERE id = 3086;
UPDATE material_item SET sort_order = 18 WHERE id = 3087;
UPDATE material_item SET sort_order = 19 WHERE id = 3088;
UPDATE material_item SET sort_order = 20 WHERE id = 3089;
UPDATE material_item SET sort_order = 21 WHERE id = 3090;
UPDATE material_item SET sort_order = 22 WHERE id = 3091;
UPDATE material_item SET sort_order = 23 WHERE id = 3092;

INSERT INTO material_item (id, group_id, name, sort_order) VALUES (3765, 2008, '211-2', 2);

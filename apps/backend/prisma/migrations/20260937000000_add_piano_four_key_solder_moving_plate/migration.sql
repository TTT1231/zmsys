-- 琴键开关「动片」组补「四键焊线动片」：20260922010000 建目录时业务清单
-- 遗漏（静片组有四键焊线静片，动片组缺对应项）。
-- 插入辅助动片与四键插线动片之间（sort_order 4），原 4-6 顺次后移；
-- 物料 id 3764 为全目录下一空闲号（3747-3763 已被微动压杆/XK3 占用），
-- 纯新增行，不触碰既有 BOM 引用与判重指纹。
UPDATE material_item SET sort_order = sort_order + 1 WHERE group_id = 2707 AND sort_order >= 4;
INSERT INTO material_item (id, group_id, name, sort_order) VALUES (3764, 2707, '四键焊线动片', 4);

-- 触点分区下三个组名统一加"触点"前缀（大小→触点大小、厚度→触点厚度、类别→触点类别），
-- 覆盖 4 个品类（新微动/老微动/旋转XK3/安全开关）的触点分区。

UPDATE material_group SET name = '触点大小' WHERE group_key = 'contact-size';
UPDATE material_group SET name = '触点厚度' WHERE group_key = 'contact-thickness';
UPDATE material_group SET name = '触点类别' WHERE group_key = 'contact-kind';

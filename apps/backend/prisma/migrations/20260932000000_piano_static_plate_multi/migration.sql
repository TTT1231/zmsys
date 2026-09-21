-- 琴键开关「静片」分组改为多选（multi 0→1）：同型号需组合多种静片
-- （如带点静片 + 四键焊线静片），数量步进（qty=1）与判重口径不变；
-- 前后端选择/校验逻辑均由目录 multi 标志驱动，无代码改动。
UPDATE material_group SET multi = 1 WHERE id = 2706;

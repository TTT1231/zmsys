-- 老微动（1004）五金件目录扩充：支架（2214）/静片（2215）各新增一项复合铜材质，
-- 与既有「6.3镀银支架」「6.3镀银静片」并列（sort_order 递增，id 沿用 32xx 段）。
-- 仅新增可选项：既有 BOM 与判重指纹（spec_hash 只含已选物料 id）不受影响。
INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    (3213, 2214, '6.3复合铜支架', 2),
    (3214, 2215, '6.3复合铜静片', 2);

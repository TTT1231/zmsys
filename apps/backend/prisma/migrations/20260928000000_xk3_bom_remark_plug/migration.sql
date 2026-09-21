-- 旋转XK3 存量 BOM 补备注：现行 XK3 目录按插线工艺建立（《XK3 接线工艺二分》
-- docs/business/xk3-wire-process-implementation.md 实施前的过渡标注），存量
-- XK3001 / XK3002 统一补「插线」。备注参与判重指纹，重算受影响行；
-- XK3 品类内各 BOM 构成互异，重算后指纹仍互异，uk_bom_identity 无冲突窗口。
UPDATE bom_table
SET remark = '插线'
WHERE category_id = 1002
  AND remark = '';

SET SESSION group_concat_max_len = 1048576;

UPDATE bom_table bt
SET bt.spec_hash = UNHEX(SHA2(CONCAT(
    '["', bt.category_id, '",[',
    (
        SELECT GROUP_CONCAT(
            CONCAT('["', bi.material_id, '",', bi.quantity, ']')
            ORDER BY bi.material_id SEPARATOR ','
        )
        FROM bom_item bi
        WHERE bi.bom_id = bt.id
    ),
    '],', JSON_QUOTE(bt.remark), ']'
), 256))
WHERE bt.category_id = 1002;

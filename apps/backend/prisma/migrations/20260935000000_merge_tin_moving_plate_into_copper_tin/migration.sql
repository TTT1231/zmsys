-- 新微动五金件「动片」组历史选项「镀锡」(3123) 并入「铜镀锡」(3138)：
-- 两者指同一实物（铜基材镀锡），旧叫法从目录清理，新建只保留 铜镀银/铜镀锡。
-- 1) 引用 3123 的 BOM 明细改指 3138 并同步冻结名（同组动片，group_key/分组名不变）；
-- 2) 受影响 BOM 的判重指纹按 bom-spec.ts materialSetHash 同构 SQL 重算
--    （JSON_QUOTE 与 JSON.stringify 转义规则一致，参照 20260927000000 的重算写法）；
-- 3) 3123 归零引用后从目录删除。
-- 前置已核验：引用方均未同时选用 3138（uk_bom_item_once 无冲突窗口）；
-- 若指纹重算后与现有 BOM 撞 uk_bom_identity，事务整体回滚。
-- 幂等：二次执行时 3123 已无引用，各语句空转。
START TRANSACTION;

CREATE TEMPORARY TABLE _tin_merge_boms (PRIMARY KEY (bom_id)) AS
SELECT DISTINCT bom_id FROM bom_item WHERE material_id = 3123;

UPDATE bom_item bi
JOIN _tin_merge_boms t ON t.bom_id = bi.bom_id
SET bi.material_id = 3138, bi.name = '铜镀锡'
WHERE bi.material_id = 3123;

SET SESSION group_concat_max_len = 1048576;

UPDATE bom_table bt
JOIN _tin_merge_boms t ON t.bom_id = bt.id
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
), 256));

DELETE FROM material_item WHERE id = 3123 AND group_id = 2116 AND name = '镀锡';

DROP TEMPORARY TABLE _tin_merge_boms;

COMMIT;

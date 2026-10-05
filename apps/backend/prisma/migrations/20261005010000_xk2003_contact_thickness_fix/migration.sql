-- XK2003 触点厚度勘误（业务确认 2026-10-05：建档 0.2 有误，实物为 0.3）：
-- BOM 建档后不可修改、无编辑接口，按数据修正迁移处理（先例 20260935000000）：
-- 1) 建档冻结明细改指触点厚度 0.3（物料 3621）并同步冻结名——同组 contact-thickness，
--    group_key/groupName/position 不动；
-- 2) 判重指纹按 bom-spec.ts materialSetHash 同构 SQL 重算（品类 + 物料集 + 备注，
--    物料 id 数值升序、数量不带引号，先例 20260927000000）。
-- 前置已核验（生产 2026-10-05）：修正后构成（B面=左脚铜点 3625）与 XK2014
-- （B面=塑料盖板 3043）不同，不撞 uk_bom_identity；XK2014 由 20261005020000 删除，
-- 两迁移互不依赖先后。重放幂等：3620 已改则 UPDATE 空转，指纹重算结果不变。
START TRANSACTION;

UPDATE bom_item bi
JOIN bom_table bt ON bt.id = bi.bom_id
SET bi.material_id = 3621, bi.name = '0.3'
WHERE bt.bom_code = 'XK2003'
  AND bi.group_key = 'contact-thickness'
  AND bi.material_id = 3620;

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
WHERE bt.bom_code = 'XK2003';

COMMIT;

-- BOM 建档备注 + 判重指纹升级（品类 + 物料构成 + 备注）。
-- - bom_table 新增 remark TEXT NOT NULL DEFAULT ('')：记录物料构成之外的工艺差异
--   （如"镀锡：动片铜点（白色）触点是反的"）；存量档案一律无备注（''），备注回填
--   由业务在界面上逐档确认后进行，不在迁移内硬写。
-- - spec_hash 输入由 [物料构成] 升级为 [品类 id, 物料构成, 备注]，与后端
--   bom-spec.ts materialSetHash 字节一致：
--     JSON.stringify([categoryId, [[id, quantity], ...], remark])
--   同构成不同备注 = 不同 BOM；(category_id, spec_hash) 唯一键语义不变。
-- 存量重算为单射（旧指纹唯一 → 新输入三元组唯一，备注均为 ''），无冲突窗口；
-- JSON_QUOTE 与 JSON.stringify 的字符串转义规则同构（引号/反斜杠/控制字符）。
ALTER TABLE bom_table
    ADD COLUMN remark TEXT NOT NULL DEFAULT ('') AFTER spec_hash;

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
), 256));

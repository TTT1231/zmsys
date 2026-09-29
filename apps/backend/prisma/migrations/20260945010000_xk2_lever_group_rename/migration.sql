-- 旋转XK2「杆子」组口径变更（2026-09-28 业务口述）：
-- 1) 分组 2004 更名「杆子点位厚度」→「杆子」。group_key lever-point-thickness 保持不变：
--    bom_item.group_key 冻结行、前端摘要优先级表（SUMMARY_GROUPS）均按 key 匹配，改 key 会
--    造成新旧快照分裂。
-- 2) 选项换名：'4.8' → '4.8/12mm'（3005）、'4.9' → '4.9/12mm'（3023）；新增 '4.6/23mm'（3766）、
--    '4.6/18mm'（3767），id 顺延当前 MAX(material_item.id)=3765。
-- 名称规范化是同一规格的显示名变更而非规格变化，故原地改名保留 id——spec_hash、外键与
-- 既有引用全部不受影响（参照 20260923000000）；同一迁移内同步改写已录业务数据的冻结名：
-- - bom_item 冻结行按 material_id 精确换名，组名按旧文本精确替换；
-- - sales_order_table.bom_spec_snapshot 重写 items[].groupName/name 与 spec 摘要串；
-- - sales_order_change_log 与 outbound_print_log 为历史审计/打印凭证，保留操作时原值。

-- ── 1) 目录换名 + 新增选项 ─────────────────────────────────────────────────
UPDATE material_group SET name = '杆子' WHERE id = 2004 AND name = '杆子点位厚度';
UPDATE material_item SET name = '4.8/12mm' WHERE id = 3005 AND name = '4.8';
UPDATE material_item SET name = '4.9/12mm' WHERE id = 3023 AND name = '4.9';

INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3766, 2004, '4.6/23mm', 3 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3766);
INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3767, 2004, '4.6/18mm', 4 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3767);

-- ── 2) BOM 冻结明细行同步换名 ───────────────────────────────────────────────
UPDATE bom_item SET group_name = '杆子' WHERE group_name = '杆子点位厚度';
UPDATE bom_item SET name = '4.8/12mm' WHERE material_id = 3005 AND name = '4.8';
UPDATE bom_item SET name = '4.9/12mm' WHERE material_id = 3023 AND name = '4.9';

-- ── 3) 订单冻结快照同步 ─────────────────────────────────────────────────────
-- 重组 items（受影响 material_id 3005/3023 换名并统一组名，其余原样保留；旧快照缺省
-- quantity 补 1，与代码兜底一致），spec 串按「组名：物料名」定点替换——型号组 '4-8'/'4-9'
-- 为连字符写法且组名前缀不同，不会被前缀误命中。
SET SESSION group_concat_max_len = 1048576;

UPDATE sales_order_table t
JOIN (
    SELECT s.id,
        JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3005' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', '杆子', 'name', '4.8/12mm', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3023' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', '杆子', 'name', '4.9/12mm', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.bom_spec_snapshot, '$.modelCode'),
            'spec', REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.bom_spec_snapshot, '$.spec')),
                '杆子点位厚度：4.8', '杆子：4.8/12mm'),
                '杆子点位厚度：4.9', '杆子：4.9/12mm')
        ) AS next_snapshot
    FROM sales_order_table s, JSON_TABLE(s.bom_spec_snapshot, '$.items[*]' COLUMNS (
        ord FOR ORDINALITY,
        material_id VARCHAR(24) PATH '$.materialId',
        group_key VARCHAR(40) PATH '$.groupKey',
        group_name VARCHAR(64) PATH '$.groupName',
        name VARCHAR(64) PATH '$.name',
        position INT PATH '$.position',
        quantity INT PATH '$.quantity' DEFAULT '1' ON EMPTY
    )) AS jt
    GROUP BY s.id, s.bom_spec_snapshot
    HAVING MAX(jt.material_id IN ('3005', '3023')) = 1
) rebuilt ON rebuilt.id = t.id
SET t.bom_spec_snapshot = rebuilt.next_snapshot;

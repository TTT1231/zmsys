-- 目录选项名称规范化（2026-09）：
-- 1) 触点大小（旋转XK2 2608 / 新微动 2119 / 老微动 2219 / 安全开关 2514；跌倒开关并入
--    微动目录随之生效）：'0.3' → '3.0mm'、'0.35' → '3.5mm'。
-- 2) 旋转XK3 卡线片：单值厚度升级为底/盖组合语义，'0.15' → '底盖0.15'、'0.2' → '底盖0.2'，
--    新增混合选项 '底0.15 盖0.2'（id 3431，展示序第一）。
-- 3) 旋转XK3 弹簧组（2417）改多选：0.45长/短弹簧可同时勾选。
-- 名称规范化是同一规格的显示名变更而非规格变化，故原地改名保留 id——spec_hash、外键与
-- 既有引用全部不受影响；为避免新旧档案显示不一致（目录不可变边界所防的漂移），同一迁移
-- 内同步改写已录业务数据的冻结名：
-- - bom_item 冻结行按 material_id 精确换名；
-- - sales_order_table.bom_spec_snapshot 重写 items[].name 与 spec 摘要串；
-- - sales_order_change_log 与 outbound_print_log 为历史审计/打印凭证，保留操作时原值。

-- ── 1) 触点大小换名 ─────────────────────────────────────────────────────────
UPDATE material_item SET name = '3.0mm' WHERE group_id IN (2608, 2119, 2219, 2514) AND name = '0.3';
UPDATE material_item SET name = '3.5mm' WHERE group_id IN (2608, 2119, 2219, 2514) AND name = '0.35';

-- ── 2) 卡线片换名 + 新增底盖混合选项 ───────────────────────────────────────
-- 生产库曾清理过 XK3 存量数据；卡线片组若已不存在则跳过新增，避免外键失败阻断迁移
UPDATE material_item SET name = '底盖0.15', sort_order = 2 WHERE id = 3420;
UPDATE material_item SET name = '底盖0.2', sort_order = 3 WHERE id = 3421;
INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3431, 2416, '底0.15 盖0.2', 1 FROM DUAL
WHERE EXISTS (SELECT 1 FROM material_group WHERE id = 2416);

-- ── 3) 弹簧组改多选 ─────────────────────────────────────────────────────────
UPDATE material_group SET multi = 1 WHERE id = 2417;

-- ── 4) BOM 冻结明细行同步换名 ───────────────────────────────────────────────
UPDATE bom_item SET name = '3.0mm' WHERE material_id IN (3617, 3131, 3141, 3517);
UPDATE bom_item SET name = '3.5mm' WHERE material_id IN (3618, 3132, 3142, 3518);
UPDATE bom_item SET name = '底盖0.15' WHERE material_id = 3420;
UPDATE bom_item SET name = '底盖0.2' WHERE material_id = 3421;

-- ── 5) 订单冻结快照同步 ─────────────────────────────────────────────────────
-- 重组 items（受影响 material_id 换名，其余原样保留；旧快照缺省 quantity 补 1，与代码
-- 兜底一致），spec 串按「组名：物料名」定点替换——先替换 0.35 再替换 0.3，避免 0.35
-- 被 0.3 的前缀误命中；琴键开关「弹簧规格：0.3/0.35」组名不同，不受影响。
SET SESSION group_concat_max_len = 1048576;

UPDATE sales_order_table t
JOIN (
    SELECT s.id,
        JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3617' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '3.0mm', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3618' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '3.5mm', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3131' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '3.0mm', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3132' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '3.5mm', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3141' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '3.0mm', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3142' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '3.5mm', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3517' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '3.0mm', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3518' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '3.5mm', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3420' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '底盖0.15', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3421' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '底盖0.2', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.bom_spec_snapshot, '$.modelCode'),
            'spec', REPLACE(REPLACE(REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.bom_spec_snapshot, '$.spec')),
                '触点大小：0.35', '触点大小：3.5mm'),
                '触点大小：0.3', '触点大小：3.0mm'),
                '卡线片：0.15', '卡线片：底盖0.15'),
                '卡线片：0.2', '卡线片：底盖0.2')
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
    HAVING MAX(jt.material_id IN ('3617', '3618', '3131', '3132', '3141', '3142', '3517', '3518', '3420', '3421')) = 1
) rebuilt ON rebuilt.id = t.id
SET t.bom_spec_snapshot = rebuilt.next_snapshot;

-- 安全开关五金件组名修正（名称规范化，2026-09）：组 2614
-- '长款/41mm系列配件' → '长款/43mm系列配件'（group_key 'long-43-parts' 为稳定标识不动）。
-- 原地改名保留 id——spec_hash、外键与既有引用不受影响；同一迁移内同步改写已录业务
-- 数据的冻结名。并补 20260931000000 的遗漏：该迁移改写了目录与 bom_item 冻结行，
-- 但漏改订单快照 sales_order_table.bom_spec_snapshot（当时 group_key='long-41-parts'
-- 即组 2613、现名'长款/40mm系列配件'的行仍留旧名'长款/41mm系列配件'），本次一并修正：
-- - bom_item 冻结行按 group_key + 旧名精确换名；
-- - sales_order_table.bom_spec_snapshot 重写 items[].groupName 与 spec 摘要串：
--     long-43-parts + '长款/41mm系列配件' → '长款/43mm系列配件'
--     long-41-parts + '长款/41mm系列配件' → '长款/40mm系列配件'（补漏）
-- - sales_order_change_log 与 outbound_print_log 为历史审计/打印凭证，保留原值。

-- ── 1) 目录组名换名 ─────────────────────────────────────────────────────────
UPDATE material_group SET name = '长款/43mm系列配件' WHERE id = 2614 AND name = '长款/41mm系列配件';

-- ── 2) BOM 冻结明细行同步换名 ───────────────────────────────────────────────
UPDATE bom_item SET group_name = '长款/43mm系列配件' WHERE group_key = 'long-43-parts' AND group_name = '长款/41mm系列配件';
UPDATE bom_item SET group_name = '长款/40mm系列配件' WHERE group_key = 'long-41-parts' AND group_name = '长款/41mm系列配件';

-- ── 3) 订单冻结快照同步 ─────────────────────────────────────────────────────
-- 重组 items（受影响行换 groupName，其余原样保留；旧快照缺省 quantity 补 1，与代码
-- 兜底一致），spec 串按「组名：物料名」定点替换：订单含 long-41-parts 旧名行 → 40mm
-- （补漏优先），否则含 long-43-parts 旧名行 → 43mm。两类同名不同 key 同现于一份
-- BOM 时无法按串区分（当前库不存在此情形），以 long-41-parts 修正为准。
SET SESSION group_concat_max_len = 1048576;

UPDATE sales_order_table t
JOIN (
    SELECT s.id,
        JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE
                    WHEN jt.group_key = 'long-43-parts' AND jt.group_name = '长款/41mm系列配件'
                        THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', '长款/43mm系列配件', 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                    WHEN jt.group_key = 'long-41-parts' AND jt.group_name = '长款/41mm系列配件'
                        THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', '长款/40mm系列配件', 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.bom_spec_snapshot, '$.modelCode'),
            'spec', CASE
                WHEN MAX(CASE WHEN jt.group_key = 'long-41-parts' AND jt.group_name = '长款/41mm系列配件' THEN 1 ELSE 0 END) = 1
                    THEN REPLACE(JSON_UNQUOTE(JSON_EXTRACT(s.bom_spec_snapshot, '$.spec')), '长款/41mm系列配件：', '长款/40mm系列配件：')
                ELSE REPLACE(JSON_UNQUOTE(JSON_EXTRACT(s.bom_spec_snapshot, '$.spec')), '长款/41mm系列配件：', '长款/43mm系列配件：')
            END
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
    HAVING MAX(jt.group_key = 'long-41-parts' AND jt.group_name = '长款/41mm系列配件') = 1
        OR MAX(jt.group_key = 'long-43-parts' AND jt.group_name = '长款/41mm系列配件') = 1
) rebuilt ON rebuilt.id = t.id
SET t.bom_spec_snapshot = rebuilt.next_snapshot;

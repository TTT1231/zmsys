-- 旋转XK3 动片多选 + 安全开关外壳透明项与 KW16 尺寸口径统一（业务确认 2026-10-12）：
--   1) 焊线动片(2717)/插线动片(2413) 单选改多选；插线带圈动片(2414) 维持单选（业务确认）；
--   2) 安全开关 PC塑料（外壳类）(2501)：KW16 三项原地改双尺寸口径（31mm→30mm/31mm、
--      43mm→40mm/43mm，保留 id，纯名称规范化，判重指纹不变）；新增透明三项
--      KD-2 30mm/31mm(3844)、KD-2 40mm/43mm(3845)、KW16 40mm/43mm(3846)
--      （KW16 30mm/31mm 透明由 3503 改名而来，不重复新增）；组内按
--      「尺寸(KD-2→KW16) × 颜色(茶→透)」重排 sort 1..8；
--   3) 存量 XK3002/3003/3004/3005 动片补「短动片（摇头）」：插线三档补插线目录项
--      (3771)，XK3004 焊线档补焊线目录项 (3769)（按「同组同名」联查归属）；四档动片
--      均在 position 6，新行插 7、原 7+ 顺移 +1，构成变化按同口径重算判重指纹
--      （bom-spec.ts 同构）。
-- 冻结快照五处同步（先例 20261006100000 / 20261008100000）：material_item → bom_item →
--   sales_order_table.bom_spec_snapshot → sales_order_change_log before/after $.bomSpec →
--   op_log.detail_json（仅 target_type='order'；create_bom/delete_bom 建档审计保留历史）。
--   改名按含 materialId(3502/3503/3505) 圈定重建 items + 定点 REPLACE spec；
--   四档补项：订单表现快照按 bom_id 圈定（现挂即改）；日志按「构成集合 = 目标档
--   原构成（剔除短动片项）」精确圈定——2026-09 老格式行无 $.bomCode 键、$.modelCode
--   为用户手填型号均不可用，而同品类同集合同备注即同一 BOM（uk_bom_identity 判重
--   保证），重放时行已含新项自然不匹配，空转；spec 串替换带「 · 」前锚，防误配
--   「带圈动片：不电镀」内的子串。
-- 幂等：INSERT 带 NOT EXISTS / 临时表空集守卫；UPDATE 按 id 定位（重放同值）；JSON 重建
--   按内容圈定，重放产出同值或空转。生产 2026-10-12 经用户授权直连应用，本迁移为仓库回填。
SET SESSION group_concat_max_len = 1048576;

START TRANSACTION;

-- ── A1 动片组单选改多选 ─────────────────────────────────────────────────────
UPDATE material_group SET multi = 1 WHERE id = 2717;
UPDATE material_group SET multi = 1 WHERE id = 2413;

-- ── A2 外壳目录：KW16 双尺寸改名 + 透明项新增 + 组内重排 ──────────────────────
UPDATE material_item SET name = '安全开关KW16 (30mm/31mm) 外壳 / 茶色' WHERE id = 3502;
UPDATE material_item SET name = '安全开关KW16 (30mm/31mm) 外壳 / 透明' WHERE id = 3503;
UPDATE material_item SET name = '安全开关KW16 (40mm/43mm) 外壳 / 茶色' WHERE id = 3505;

INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3844, 2501, '安全开关KD-2 (30mm/31mm) 外壳 / 透明', 2 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3844);
INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3845, 2501, '安全开关KD-2 (40mm/43mm) 外壳 / 透明', 6 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3845);
INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3846, 2501, '安全开关KW16 (40mm/43mm) 外壳 / 透明', 8 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3846);

UPDATE material_item SET sort_order = 3 WHERE id = 3502 AND sort_order = 2;
UPDATE material_item SET sort_order = 4 WHERE id = 3503 AND sort_order = 3;
UPDATE material_item SET sort_order = 5 WHERE id = 3504 AND sort_order = 4;
UPDATE material_item SET sort_order = 7 WHERE id = 3505 AND sort_order = 5;

-- ── A3 bom_item 冻结名同步（material_id 定位，无引用的库空转） ────────────────
UPDATE bom_item SET name = '安全开关KW16 (30mm/31mm) 外壳 / 茶色' WHERE material_id = 3502;
UPDATE bom_item SET name = '安全开关KW16 (30mm/31mm) 外壳 / 透明' WHERE material_id = 3503;
UPDATE bom_item SET name = '安全开关KW16 (40mm/43mm) 外壳 / 茶色' WHERE material_id = 3505;

-- ── A4 三张 JSON 表改名重建（含 3502/3503/3505 即圈定，重放同值） ─────────────
UPDATE sales_order_table t
JOIN (
    SELECT s.id,
        JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3502' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '安全开关KW16 (30mm/31mm) 外壳 / 茶色', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3503' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '安全开关KW16 (30mm/31mm) 外壳 / 透明', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3505' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '安全开关KW16 (40mm/43mm) 外壳 / 茶色', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.bom_spec_snapshot, '$.modelCode'),
            'spec', REPLACE(REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.bom_spec_snapshot, '$.spec')),
                '安全开关KW16 (31mm) 外壳 / 茶色', '安全开关KW16 (30mm/31mm) 外壳 / 茶色'),
                '安全开关KW16 (31mm) 外壳 / 透明', '安全开关KW16 (30mm/31mm) 外壳 / 透明'),
                '安全开关KW16 (43mm) 外壳 / 茶色', '安全开关KW16 (40mm/43mm) 外壳 / 茶色')
        ) AS next_snapshot
    FROM sales_order_table s, JSON_TABLE(s.bom_spec_snapshot, '$.items[*]' COLUMNS (
        ord FOR ORDINALITY,
        material_id VARCHAR(24) PATH '$.materialId',
        group_key VARCHAR(40) PATH '$.groupKey',
        group_name VARCHAR(64) PATH '$.groupName',
        name VARCHAR(64) PATH '$.name',
        position INT PATH '$.position',
        quantity INT PATH '$.quantity' DEFAULT '1' ON EMPTY
    )) jt
    GROUP BY s.id, s.bom_spec_snapshot
    HAVING MAX(jt.material_id IN ('3502', '3503', '3505')) = 1
) rebuilt ON rebuilt.id = t.id
SET t.bom_spec_snapshot = rebuilt.next_snapshot;

UPDATE sales_order_change_log l
JOIN (
    SELECT s.id,
        JSON_SET(s.before_json, '$.bomSpec', JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3502' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '安全开关KW16 (30mm/31mm) 外壳 / 茶色', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3503' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '安全开关KW16 (30mm/31mm) 外壳 / 透明', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3505' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '安全开关KW16 (40mm/43mm) 外壳 / 茶色', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.before_json, '$.bomSpec.modelCode'),
            'spec', REPLACE(REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.before_json, '$.bomSpec.spec')),
                '安全开关KW16 (31mm) 外壳 / 茶色', '安全开关KW16 (30mm/31mm) 外壳 / 茶色'),
                '安全开关KW16 (31mm) 外壳 / 透明', '安全开关KW16 (30mm/31mm) 外壳 / 透明'),
                '安全开关KW16 (43mm) 外壳 / 茶色', '安全开关KW16 (40mm/43mm) 外壳 / 茶色')
        )) AS next_json
    FROM sales_order_change_log s, JSON_TABLE(s.before_json, '$.bomSpec.items[*]' COLUMNS (
        ord FOR ORDINALITY,
        material_id VARCHAR(24) PATH '$.materialId',
        group_key VARCHAR(40) PATH '$.groupKey',
        group_name VARCHAR(64) PATH '$.groupName',
        name VARCHAR(64) PATH '$.name',
        position INT PATH '$.position',
        quantity INT PATH '$.quantity' DEFAULT '1' ON EMPTY
    )) jt
    WHERE JSON_TYPE(JSON_EXTRACT(s.before_json, '$.bomSpec')) = 'OBJECT'
    GROUP BY s.id, s.before_json
    HAVING MAX(jt.material_id IN ('3502', '3503', '3505')) = 1
) rebuilt ON rebuilt.id = l.id
SET l.before_json = rebuilt.next_json;

UPDATE sales_order_change_log l
JOIN (
    SELECT s.id,
        JSON_SET(s.after_json, '$.bomSpec', JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3502' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '安全开关KW16 (30mm/31mm) 外壳 / 茶色', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3503' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '安全开关KW16 (30mm/31mm) 外壳 / 透明', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3505' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '安全开关KW16 (40mm/43mm) 外壳 / 茶色', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.after_json, '$.bomSpec.modelCode'),
            'spec', REPLACE(REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.after_json, '$.bomSpec.spec')),
                '安全开关KW16 (31mm) 外壳 / 茶色', '安全开关KW16 (30mm/31mm) 外壳 / 茶色'),
                '安全开关KW16 (31mm) 外壳 / 透明', '安全开关KW16 (30mm/31mm) 外壳 / 透明'),
                '安全开关KW16 (43mm) 外壳 / 茶色', '安全开关KW16 (40mm/43mm) 外壳 / 茶色')
        )) AS next_json
    FROM sales_order_change_log s, JSON_TABLE(s.after_json, '$.bomSpec.items[*]' COLUMNS (
        ord FOR ORDINALITY,
        material_id VARCHAR(24) PATH '$.materialId',
        group_key VARCHAR(40) PATH '$.groupKey',
        group_name VARCHAR(64) PATH '$.groupName',
        name VARCHAR(64) PATH '$.name',
        position INT PATH '$.position',
        quantity INT PATH '$.quantity' DEFAULT '1' ON EMPTY
    )) jt
    WHERE JSON_TYPE(JSON_EXTRACT(s.after_json, '$.bomSpec')) = 'OBJECT'
    GROUP BY s.id, s.after_json
    HAVING MAX(jt.material_id IN ('3502', '3503', '3505')) = 1
) rebuilt ON rebuilt.id = l.id
SET l.after_json = rebuilt.next_json;

UPDATE op_log o
JOIN (
    SELECT s.id,
        JSON_SET(s.detail_json, '$.bomSpec', JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3502' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '安全开关KW16 (30mm/31mm) 外壳 / 茶色', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3503' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '安全开关KW16 (30mm/31mm) 外壳 / 透明', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3505' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '安全开关KW16 (40mm/43mm) 外壳 / 茶色', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.detail_json, '$.bomSpec.modelCode'),
            'spec', REPLACE(REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.detail_json, '$.bomSpec.spec')),
                '安全开关KW16 (31mm) 外壳 / 茶色', '安全开关KW16 (30mm/31mm) 外壳 / 茶色'),
                '安全开关KW16 (31mm) 外壳 / 透明', '安全开关KW16 (30mm/31mm) 外壳 / 透明'),
                '安全开关KW16 (43mm) 外壳 / 茶色', '安全开关KW16 (40mm/43mm) 外壳 / 茶色')
        )) AS next_json
    FROM op_log s, JSON_TABLE(s.detail_json, '$.bomSpec.items[*]' COLUMNS (
        ord FOR ORDINALITY,
        material_id VARCHAR(24) PATH '$.materialId',
        group_key VARCHAR(40) PATH '$.groupKey',
        group_name VARCHAR(64) PATH '$.groupName',
        name VARCHAR(64) PATH '$.name',
        position INT PATH '$.position',
        quantity INT PATH '$.quantity' DEFAULT '1' ON EMPTY
    )) jt
    WHERE s.target_type = 'order'
      AND JSON_TYPE(JSON_EXTRACT(s.detail_json, '$.bomSpec')) = 'OBJECT'
    GROUP BY s.id, s.detail_json
    HAVING MAX(jt.material_id IN ('3502', '3503', '3505')) = 1
) rebuilt ON rebuilt.id = o.id
SET o.detail_json = rebuilt.next_json;

-- ── B1 四档圈定（XK3002/3003/3004/3005；动片组已含「短动片（摇头）」则空集，全线空转）──
-- 四档动片均在 position 6：新行统一插 7，原 7+ 顺移 +1。XK3004 为焊线工艺
-- （动片=带圈动片），补焊线目录短动片（摇头）(3769)；其余三档插线工艺补 (3771)——
-- 新物料按「同组同名」联查自动归属，不硬编码工艺判断。
CREATE TEMPORARY TABLE tmp_xk3_boms (PRIMARY KEY (bom_id)) AS
SELECT bt.id AS bom_id
FROM bom_table bt
WHERE bt.bom_code IN ('XK3002', 'XK3003', 'XK3004', 'XK3005')
  AND EXISTS (SELECT 1 FROM bom_item bi WHERE bi.bom_id = bt.id AND bi.group_key = 'moving-plate')
  AND NOT EXISTS (SELECT 1 FROM bom_item bi JOIN material_item m ON m.id = bi.material_id
                  WHERE bi.bom_id = bt.id AND m.name = '短动片（摇头）');

-- 原 position 7+ 顺移 +1，为新动片行让位
UPDATE bom_item bi
JOIN tmp_xk3_boms tt ON tt.bom_id = bi.bom_id
SET bi.position = bi.position + 1
WHERE bi.position >= 7;

-- 补「短动片（摇头）」明细行（id 顺延：XK3005 已用 235304586737356812，按 bom_id 续排）
INSERT INTO bom_item (id, bom_id, material_id, group_key, group_name, name, position, quantity, created_at)
SELECT 235304586737356812 + ROW_NUMBER() OVER (ORDER BY bi.bom_id), bi.bom_id, sm.id,
       bi.group_key, bi.group_name, '短动片（摇头）', 7, 1, NOW(3)
FROM tmp_xk3_boms tt
JOIN bom_item bi ON bi.bom_id = tt.bom_id AND bi.group_key = 'moving-plate'
JOIN material_item om ON om.id = bi.material_id
JOIN material_item sm ON sm.group_id = om.group_id AND sm.name = '短动片（摇头）';

-- 构成变化重算判重指纹（bom-spec.ts materialSetHash 同构，先例 20260927000000）；
-- 新物料集为全新组合，若撞既有档 uk_bom_identity 会中止事务（双保险）
UPDATE bom_table bt
JOIN tmp_xk3_boms tt ON tt.bom_id = bt.id
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

-- ── B2 XK3005 订单/日志快照补项（订单表按 bom_id，日志按 $.bomCode；含 3417 不含 3771 守卫） ──
UPDATE sales_order_table t
JOIN (
    SELECT s.id,
        JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE WHEN jt.group_key = 'moving-plate' THEN CONCAT(
                        JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity),
                        ',',
                        JSON_OBJECT('materialId', CASE WHEN jt.material_id IN ('3416', '3417', '3770') THEN '3771' ELSE '3769' END, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '短动片（摇头）', 'position', 7, 'quantity', 1))
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position + IF(jt.position >= 7, 1, 0), 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.bom_spec_snapshot, '$.modelCode'),
            'spec', REPLACE(REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.bom_spec_snapshot, '$.spec')),
                ' · 动片：镀锡', ' · 动片：镀锡 · 动片：短动片（摇头）'),
                ' · 动片：不电镀', ' · 动片：不电镀 · 动片：短动片（摇头）'),
                ' · 动片：带圈动片', ' · 动片：带圈动片 · 动片：短动片（摇头）')
        ) AS next_snapshot
    FROM sales_order_table s, JSON_TABLE(s.bom_spec_snapshot, '$.items[*]' COLUMNS (
        ord FOR ORDINALITY,
        material_id VARCHAR(24) PATH '$.materialId',
        group_key VARCHAR(40) PATH '$.groupKey',
        group_name VARCHAR(64) PATH '$.groupName',
        name VARCHAR(64) PATH '$.name',
        position INT PATH '$.position',
        quantity INT PATH '$.quantity' DEFAULT '1' ON EMPTY
    )) jt
    GROUP BY s.id, s.bom_spec_snapshot
    HAVING GROUP_CONCAT(DISTINCT jt.material_id ORDER BY jt.material_id) IN (
        SELECT GROUP_CONCAT(bi.material_id ORDER BY bi.material_id)
        FROM bom_item bi
        WHERE bi.bom_id IN (SELECT bom_id FROM tmp_xk3_boms)
          AND bi.material_id NOT IN (SELECT id FROM material_item WHERE name = '短动片（摇头）')
        GROUP BY bi.bom_id)
       AND MAX(CASE WHEN jt.group_key = 'moving-plate' THEN jt.position END) = 6
) rebuilt ON rebuilt.id = t.id
SET t.bom_spec_snapshot = rebuilt.next_snapshot;

UPDATE sales_order_change_log l
JOIN (
    SELECT s.id,
        JSON_SET(s.before_json, '$.bomSpec', JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE WHEN jt.group_key = 'moving-plate' THEN CONCAT(
                        JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity),
                        ',',
                        JSON_OBJECT('materialId', CASE WHEN jt.material_id IN ('3416', '3417', '3770') THEN '3771' ELSE '3769' END, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '短动片（摇头）', 'position', 7, 'quantity', 1))
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position + IF(jt.position >= 7, 1, 0), 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.before_json, '$.bomSpec.modelCode'),
            'spec', REPLACE(REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.before_json, '$.bomSpec.spec')),
                ' · 动片：镀锡', ' · 动片：镀锡 · 动片：短动片（摇头）'),
                ' · 动片：不电镀', ' · 动片：不电镀 · 动片：短动片（摇头）'),
                ' · 动片：带圈动片', ' · 动片：带圈动片 · 动片：短动片（摇头）')
        )) AS next_json
    FROM sales_order_change_log s, JSON_TABLE(s.before_json, '$.bomSpec.items[*]' COLUMNS (
        ord FOR ORDINALITY,
        material_id VARCHAR(24) PATH '$.materialId',
        group_key VARCHAR(40) PATH '$.groupKey',
        group_name VARCHAR(64) PATH '$.groupName',
        name VARCHAR(64) PATH '$.name',
        position INT PATH '$.position',
        quantity INT PATH '$.quantity' DEFAULT '1' ON EMPTY
    )) jt
    WHERE JSON_TYPE(JSON_EXTRACT(s.before_json, '$.bomSpec')) = 'OBJECT'
    GROUP BY s.id, s.before_json
    HAVING GROUP_CONCAT(DISTINCT jt.material_id ORDER BY jt.material_id) IN (
        SELECT GROUP_CONCAT(bi.material_id ORDER BY bi.material_id)
        FROM bom_item bi
        WHERE bi.bom_id IN (SELECT bom_id FROM tmp_xk3_boms)
          AND bi.material_id NOT IN (SELECT id FROM material_item WHERE name = '短动片（摇头）')
        GROUP BY bi.bom_id)
       AND MAX(CASE WHEN jt.group_key = 'moving-plate' THEN jt.position END) = 6
) rebuilt ON rebuilt.id = l.id
SET l.before_json = rebuilt.next_json;

UPDATE sales_order_change_log l
JOIN (
    SELECT s.id,
        JSON_SET(s.after_json, '$.bomSpec', JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE WHEN jt.group_key = 'moving-plate' THEN CONCAT(
                        JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity),
                        ',',
                        JSON_OBJECT('materialId', CASE WHEN jt.material_id IN ('3416', '3417', '3770') THEN '3771' ELSE '3769' END, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '短动片（摇头）', 'position', 7, 'quantity', 1))
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position + IF(jt.position >= 7, 1, 0), 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.after_json, '$.bomSpec.modelCode'),
            'spec', REPLACE(REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.after_json, '$.bomSpec.spec')),
                ' · 动片：镀锡', ' · 动片：镀锡 · 动片：短动片（摇头）'),
                ' · 动片：不电镀', ' · 动片：不电镀 · 动片：短动片（摇头）'),
                ' · 动片：带圈动片', ' · 动片：带圈动片 · 动片：短动片（摇头）')
        )) AS next_json
    FROM sales_order_change_log s, JSON_TABLE(s.after_json, '$.bomSpec.items[*]' COLUMNS (
        ord FOR ORDINALITY,
        material_id VARCHAR(24) PATH '$.materialId',
        group_key VARCHAR(40) PATH '$.groupKey',
        group_name VARCHAR(64) PATH '$.groupName',
        name VARCHAR(64) PATH '$.name',
        position INT PATH '$.position',
        quantity INT PATH '$.quantity' DEFAULT '1' ON EMPTY
    )) jt
    WHERE JSON_TYPE(JSON_EXTRACT(s.after_json, '$.bomSpec')) = 'OBJECT'
    GROUP BY s.id, s.after_json
    HAVING GROUP_CONCAT(DISTINCT jt.material_id ORDER BY jt.material_id) IN (
        SELECT GROUP_CONCAT(bi.material_id ORDER BY bi.material_id)
        FROM bom_item bi
        WHERE bi.bom_id IN (SELECT bom_id FROM tmp_xk3_boms)
          AND bi.material_id NOT IN (SELECT id FROM material_item WHERE name = '短动片（摇头）')
        GROUP BY bi.bom_id)
       AND MAX(CASE WHEN jt.group_key = 'moving-plate' THEN jt.position END) = 6
) rebuilt ON rebuilt.id = l.id
SET l.after_json = rebuilt.next_json;

UPDATE op_log o
JOIN (
    SELECT s.id,
        JSON_SET(s.detail_json, '$.bomSpec', JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE WHEN jt.group_key = 'moving-plate' THEN CONCAT(
                        JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity),
                        ',',
                        JSON_OBJECT('materialId', CASE WHEN jt.material_id IN ('3416', '3417', '3770') THEN '3771' ELSE '3769' END, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '短动片（摇头）', 'position', 7, 'quantity', 1))
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position + IF(jt.position >= 7, 1, 0), 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.detail_json, '$.bomSpec.modelCode'),
            'spec', REPLACE(REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.detail_json, '$.bomSpec.spec')),
                ' · 动片：镀锡', ' · 动片：镀锡 · 动片：短动片（摇头）'),
                ' · 动片：不电镀', ' · 动片：不电镀 · 动片：短动片（摇头）'),
                ' · 动片：带圈动片', ' · 动片：带圈动片 · 动片：短动片（摇头）')
        )) AS next_json
    FROM op_log s, JSON_TABLE(s.detail_json, '$.bomSpec.items[*]' COLUMNS (
        ord FOR ORDINALITY,
        material_id VARCHAR(24) PATH '$.materialId',
        group_key VARCHAR(40) PATH '$.groupKey',
        group_name VARCHAR(64) PATH '$.groupName',
        name VARCHAR(64) PATH '$.name',
        position INT PATH '$.position',
        quantity INT PATH '$.quantity' DEFAULT '1' ON EMPTY
    )) jt
    WHERE s.target_type = 'order'
      AND JSON_TYPE(JSON_EXTRACT(s.detail_json, '$.bomSpec')) = 'OBJECT'
    GROUP BY s.id, s.detail_json
    HAVING GROUP_CONCAT(DISTINCT jt.material_id ORDER BY jt.material_id) IN (
        SELECT GROUP_CONCAT(bi.material_id ORDER BY bi.material_id)
        FROM bom_item bi
        WHERE bi.bom_id IN (SELECT bom_id FROM tmp_xk3_boms)
          AND bi.material_id NOT IN (SELECT id FROM material_item WHERE name = '短动片（摇头）')
        GROUP BY bi.bom_id)
       AND MAX(CASE WHEN jt.group_key = 'moving-plate' THEN jt.position END) = 6
) rebuilt ON rebuilt.id = o.id
SET o.detail_json = rebuilt.next_json;

DROP TEMPORARY TABLE IF EXISTS tmp_xk3_boms;

COMMIT;

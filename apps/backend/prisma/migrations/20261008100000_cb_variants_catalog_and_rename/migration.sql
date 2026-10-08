-- 目录 CB 维度显式化（业务确认 2026-10-08）：
--   1) 新微动「底座」(2111) 2×2=4：旧 3101/3102 原地改名有CB变体（存量档全为有CB），
--      新增 3772 二脚底座无CB（无挡脚）、3773 三脚底座无CB（有挡脚）；
--   2) 焊线「外壳」(2712)：3754 '外壳' → '有CB外壳'，新增 3774 '无CB外壳'；
--   3) 插线「PC塑料外壳」(2401) 5×2=10：统一命名「形状+有/无CB+（颜色）」——
--      3401/3402/3403 原地改名有CB变体，3404/3405 原「无CB字」两项去掉「字」归无CB，
--      新增 3775-3779 五个对应变体；组内 sort_order 重排为有/无CB 相邻的 1..10。
--   4) 跌倒开关存量勘误：跌倒盖=KW16/无CB字(3602) 的档，其新微动底座实为无CB——
--      bom_item 改挂 3772/3773（先于全局改名执行，改名守卫才不会误吞）；
--      盖=有CB字(3601)/KB-1(3603) 的不动 id，随全局改名显示有CB（业务口径）。
-- 冻结快照五处同步（先例 20261006100000）：material_item → bom_item →
--   sales_order_table.bom_spec_snapshot → sales_order_change_log before/after $.bomSpec →
--   op_log.detail_json（仅 target_type='order'；create_bom/delete_bom 建档审计保留历史）。
-- 改名保留 id（名称规范化，spec_hash 不变）；改挂物料的三处 BOM 重算指纹（同构 SQL，
--   先例 20260927000000/20261005010000）。跌倒改挂在生产当前数据上为 no-op（唯一
--   3602 盖档 KD006 用老微动子件，2026-10-08 已核验），保留逻辑防部署前数据漂移。
-- MySQL 8.0.46 已验证的坑：JSON_CONTAINS 不接受通配 path（ERROR 3149），须先用
--   JSON_EXTRACT 展开数组；EXISTS 内嵌 JSON_TABLE 关联外层列会静默 0 行，须用逗号
--   JOIN；JSON_TABLE 的行源不得取自带 WHERE 的派生表（ER_WRONG_ARGUMENTS），须
--   直接基表逗号 JOIN 后 WHERE 过滤（NULL 文档零行，天然跳过，已实测）；'外壳'
--   同时是焊线快照 items[].name 与 groupName，JSON_SEARCH 会命中两处（ARRAY），
--   故改名一律走 JSON_TABLE 按 materialId 重建，不走 JSON_SEARCH 定位。
-- 幂等：INSERT 带 NOT EXISTS 守卫；UPDATE 按 id 定位（重放同值）；重建语句按
--   「含旧 materialId（改挂：且含 3602）」圈定，重放产出同值或空转。
START TRANSACTION;

-- ── A1 新增无CB/新变体物料（id 顺延生产最大 3771） ────────────────────────────
-- 新微动底座（2111）：二脚有CB(1) 二脚无CB(2) 三脚有CB(3) 三脚无CB(4)
INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3772, 2111, '二脚底座无CB（无挡脚）', 2 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3772);
INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3773, 2111, '三脚底座无CB（有挡脚）', 4 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3773);
UPDATE material_item SET sort_order = 3 WHERE id = 3102 AND sort_order = 2;

-- 焊线外壳（2712）：有CB外壳(1) 无CB外壳(2)
INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3774, 2712, '无CB外壳', 2 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3774);

-- 插线 PC塑料外壳（2401）重排为 1..10（有/无CB 相邻）：
--   圆孔长茶(3401,1/3775,2) 圆孔长透(3402,3/3776,4) 圆孔短茶(3403,5/3777,6)
--   椭圆孔长茶(3778,7/3404,8) 无耳茶(3779,9/3405,10)
INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3775, 2401, '圆孔长外壳无CB（茶色）', 2 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3775);
INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3776, 2401, '圆孔长外壳无CB（透明）', 4 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3776);
INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3777, 2401, '圆孔短外壳无CB（茶色）', 6 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3777);
INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3778, 2401, '椭圆孔长外壳有CB（茶色）', 7 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3778);
INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3779, 2401, '无耳外壳有CB（茶色）', 9 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3779);
UPDATE material_item SET sort_order = 3  WHERE id = 3402 AND sort_order = 2;
UPDATE material_item SET sort_order = 5  WHERE id = 3403 AND sort_order = 3;
UPDATE material_item SET sort_order = 8  WHERE id = 3404 AND sort_order = 4;
UPDATE material_item SET sort_order = 10 WHERE id = 3405 AND sort_order = 5;

-- ── A2 跌倒开关无CB盖档案改挂（当前生产 no-op，防漂移保留） ──────────────────
CREATE TEMPORARY TABLE tmp_tipover_nocb_boms (PRIMARY KEY (bom_id)) AS
SELECT DISTINCT bt.id AS bom_id
FROM bom_table bt
JOIN bom_item bi ON bi.bom_id = bt.id
WHERE bt.category_id = 1006
  AND bi.material_id = 3602;

UPDATE bom_item bi
JOIN tmp_tipover_nocb_boms t ON t.bom_id = bi.bom_id
SET bi.material_id = CASE bi.material_id
        WHEN 3101 THEN 3772
        WHEN 3102 THEN 3773
        ELSE bi.material_id
    END,
    bi.name = CASE bi.material_id
        WHEN 3101 THEN '二脚底座无CB（无挡脚）'
        WHEN 3102 THEN '三脚底座无CB（有挡脚）'
        ELSE bi.name
    END
WHERE bi.material_id IN (3101, 3102);

-- 改挂改变了物料集，重算受影响 BOM 的判重指纹（bom-spec.ts materialSetHash 同构）。
-- 3772/3773 为全新 id，不与任何既有集合相撞，uk_bom_identity / uk_bom_item_once 无冲突窗口。
SET SESSION group_concat_max_len = 1048576;

UPDATE bom_table bt
JOIN tmp_tipover_nocb_boms t ON t.bom_id = bt.id
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

-- 订单快照：JSON 含 materialId '3602'（跌倒盖冻结在同份快照内）即无CB 口径——按内容
-- 判定而非按订单当前 bom_id，历史换 BOM 的订单轨迹同样正确。
UPDATE sales_order_table t
JOIN (
    SELECT s.id,
        JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3101' THEN JSON_OBJECT('materialId', '3772', 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '二脚底座无CB（无挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3102' THEN JSON_OBJECT('materialId', '3773', 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '三脚底座无CB（有挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.bom_spec_snapshot, '$.modelCode'),
            'spec', REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.bom_spec_snapshot, '$.spec')),
                '底座：二脚底座（无挡脚）', '底座：二脚底座无CB（无挡脚）'),
                '底座：三脚底座（有挡脚）', '底座：三脚底座无CB（有挡脚）')
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
    WHERE JSON_CONTAINS(JSON_EXTRACT(s.bom_spec_snapshot, '$.items[*].materialId'), JSON_QUOTE('3602'))
    GROUP BY s.id, s.bom_spec_snapshot
    HAVING MAX(jt.material_id IN ('3101', '3102')) = 1
) rebuilt ON rebuilt.id = t.id
SET t.bom_spec_snapshot = rebuilt.next_snapshot;

-- 变更日志 before/after 与操作日志：同构重建 $.bomSpec（JSON_SET 保留其余键）。
-- before_json 可为 NULL（CREATE 事件），NULL 文档经 JSON_TABLE 自然零行跳过。
UPDATE sales_order_change_log l
JOIN (
    SELECT s.id,
        JSON_SET(s.before_json, '$.bomSpec', JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3101' THEN JSON_OBJECT('materialId', '3772', 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '二脚底座无CB（无挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3102' THEN JSON_OBJECT('materialId', '3773', 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '三脚底座无CB（有挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.before_json, '$.bomSpec.modelCode'),
            'spec', REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.before_json, '$.bomSpec.spec')),
                '底座：二脚底座（无挡脚）', '底座：二脚底座无CB（无挡脚）'),
                '底座：三脚底座（有挡脚）', '底座：三脚底座无CB（有挡脚）')
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
      AND JSON_CONTAINS(JSON_EXTRACT(s.before_json, '$.bomSpec.items[*].materialId'), JSON_QUOTE('3602'))
    GROUP BY s.id, s.before_json
    HAVING MAX(jt.material_id IN ('3101', '3102')) = 1
) rebuilt ON rebuilt.id = l.id
SET l.before_json = rebuilt.next_json;

UPDATE sales_order_change_log l
JOIN (
    SELECT s.id,
        JSON_SET(s.after_json, '$.bomSpec', JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3101' THEN JSON_OBJECT('materialId', '3772', 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '二脚底座无CB（无挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3102' THEN JSON_OBJECT('materialId', '3773', 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '三脚底座无CB（有挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.after_json, '$.bomSpec.modelCode'),
            'spec', REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.after_json, '$.bomSpec.spec')),
                '底座：二脚底座（无挡脚）', '底座：二脚底座无CB（无挡脚）'),
                '底座：三脚底座（有挡脚）', '底座：三脚底座无CB（有挡脚）')
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
      AND JSON_CONTAINS(JSON_EXTRACT(s.after_json, '$.bomSpec.items[*].materialId'), JSON_QUOTE('3602'))
    GROUP BY s.id, s.after_json
    HAVING MAX(jt.material_id IN ('3101', '3102')) = 1
) rebuilt ON rebuilt.id = l.id
SET l.after_json = rebuilt.next_json;

UPDATE op_log o
JOIN (
    SELECT s.id,
        JSON_SET(s.detail_json, '$.bomSpec', JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3101' THEN JSON_OBJECT('materialId', '3772', 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '二脚底座无CB（无挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3102' THEN JSON_OBJECT('materialId', '3773', 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '三脚底座无CB（有挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.detail_json, '$.bomSpec.modelCode'),
            'spec', REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.detail_json, '$.bomSpec.spec')),
                '底座：二脚底座（无挡脚）', '底座：二脚底座无CB（无挡脚）'),
                '底座：三脚底座（有挡脚）', '底座：三脚底座无CB（有挡脚）')
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
      AND JSON_CONTAINS(JSON_EXTRACT(s.detail_json, '$.bomSpec.items[*].materialId'), JSON_QUOTE('3602'))
    GROUP BY s.id, s.detail_json
    HAVING MAX(jt.material_id IN ('3101', '3102')) = 1
) rebuilt ON rebuilt.id = o.id
SET o.detail_json = rebuilt.next_json;

DROP TEMPORARY TABLE tmp_tipover_nocb_boms;

-- ── A3 全局改名（保留 id，纯名称规范化，指纹不变） ───────────────────────────
-- 3101/3102 → 有CB变体（含盖=有CB字/KB-1 的跌倒档）；3401-3405 统一 CB 命名；
-- 3754 '外壳' → '有CB外壳'。A2 已改挂的副本不再含旧 materialId，天然不在此命中。
UPDATE material_item SET name = '二脚底座有CB（无挡脚）' WHERE id = 3101;
UPDATE material_item SET name = '三脚底座有CB（有挡脚）' WHERE id = 3102;
UPDATE material_item SET name = '圆孔长外壳有CB（茶色）' WHERE id = 3401;
UPDATE material_item SET name = '圆孔长外壳有CB（透明）' WHERE id = 3402;
UPDATE material_item SET name = '圆孔短外壳有CB（茶色）' WHERE id = 3403;
UPDATE material_item SET name = '椭圆孔长外壳无CB（茶色）' WHERE id = 3404;
UPDATE material_item SET name = '无耳外壳无CB（茶色）' WHERE id = 3405;
UPDATE material_item SET name = '有CB外壳' WHERE id = 3754;

UPDATE bom_item SET name = '二脚底座有CB（无挡脚）' WHERE material_id = 3101;
UPDATE bom_item SET name = '三脚底座有CB（有挡脚）' WHERE material_id = 3102;
UPDATE bom_item SET name = '圆孔长外壳有CB（茶色）' WHERE material_id = 3401;
UPDATE bom_item SET name = '圆孔长外壳有CB（透明）' WHERE material_id = 3402;
UPDATE bom_item SET name = '圆孔短外壳有CB（茶色）' WHERE material_id = 3403;
UPDATE bom_item SET name = '椭圆孔长外壳无CB（茶色）' WHERE material_id = 3404;
UPDATE bom_item SET name = '无耳外壳无CB（茶色）' WHERE material_id = 3405;
UPDATE bom_item SET name = '有CB外壳' WHERE material_id = 3754;

-- 三张 JSON 表按 materialId 重建 items 并定点 REPLACE spec 串（带「组名：」前缀，
-- 各旧串互不为子串，替换顺序无关；'外壳：外壳' 仅出现在焊线 spec）。重放产出同值。
UPDATE sales_order_table t
JOIN (
    SELECT s.id,
        JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3101' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '二脚底座有CB（无挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3102' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '三脚底座有CB（有挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3401' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '圆孔长外壳有CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3402' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '圆孔长外壳有CB（透明）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3403' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '圆孔短外壳有CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3404' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '椭圆孔长外壳无CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3405' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '无耳外壳无CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3754' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '有CB外壳', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.bom_spec_snapshot, '$.modelCode'),
            'spec', REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.bom_spec_snapshot, '$.spec')),
                '底座：二脚底座（无挡脚）', '底座：二脚底座有CB（无挡脚）'),
                '底座：三脚底座（有挡脚）', '底座：三脚底座有CB（有挡脚）'),
                'PC塑料外壳：圆孔长外壳（茶色）', 'PC塑料外壳：圆孔长外壳有CB（茶色）'),
                'PC塑料外壳：圆孔长外壳（透明）', 'PC塑料外壳：圆孔长外壳有CB（透明）'),
                'PC塑料外壳：圆孔短外壳（茶色）', 'PC塑料外壳：圆孔短外壳有CB（茶色）'),
                'PC塑料外壳：椭圆孔长外壳无CB字（茶色）', 'PC塑料外壳：椭圆孔长外壳无CB（茶色）'),
                'PC塑料外壳：无耳外壳无CB字（茶色）', 'PC塑料外壳：无耳外壳无CB（茶色）'),
                '外壳：外壳', '外壳：有CB外壳')
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
    HAVING MAX(jt.material_id IN ('3101', '3102', '3401', '3402', '3403', '3404', '3405', '3754')) = 1
) rebuilt ON rebuilt.id = t.id
SET t.bom_spec_snapshot = rebuilt.next_snapshot;

UPDATE sales_order_change_log l
JOIN (
    SELECT s.id,
        JSON_SET(s.before_json, '$.bomSpec', JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3101' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '二脚底座有CB（无挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3102' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '三脚底座有CB（有挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3401' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '圆孔长外壳有CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3402' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '圆孔长外壳有CB（透明）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3403' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '圆孔短外壳有CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3404' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '椭圆孔长外壳无CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3405' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '无耳外壳无CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3754' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '有CB外壳', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.before_json, '$.bomSpec.modelCode'),
            'spec', REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.before_json, '$.bomSpec.spec')),
                '底座：二脚底座（无挡脚）', '底座：二脚底座有CB（无挡脚）'),
                '底座：三脚底座（有挡脚）', '底座：三脚底座有CB（有挡脚）'),
                'PC塑料外壳：圆孔长外壳（茶色）', 'PC塑料外壳：圆孔长外壳有CB（茶色）'),
                'PC塑料外壳：圆孔长外壳（透明）', 'PC塑料外壳：圆孔长外壳有CB（透明）'),
                'PC塑料外壳：圆孔短外壳（茶色）', 'PC塑料外壳：圆孔短外壳有CB（茶色）'),
                'PC塑料外壳：椭圆孔长外壳无CB字（茶色）', 'PC塑料外壳：椭圆孔长外壳无CB（茶色）'),
                'PC塑料外壳：无耳外壳无CB字（茶色）', 'PC塑料外壳：无耳外壳无CB（茶色）'),
                '外壳：外壳', '外壳：有CB外壳')
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
    HAVING MAX(jt.material_id IN ('3101', '3102', '3401', '3402', '3403', '3404', '3405', '3754')) = 1
) rebuilt ON rebuilt.id = l.id
SET l.before_json = rebuilt.next_json;

UPDATE sales_order_change_log l
JOIN (
    SELECT s.id,
        JSON_SET(s.after_json, '$.bomSpec', JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3101' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '二脚底座有CB（无挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3102' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '三脚底座有CB（有挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3401' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '圆孔长外壳有CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3402' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '圆孔长外壳有CB（透明）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3403' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '圆孔短外壳有CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3404' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '椭圆孔长外壳无CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3405' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '无耳外壳无CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3754' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '有CB外壳', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.after_json, '$.bomSpec.modelCode'),
            'spec', REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.after_json, '$.bomSpec.spec')),
                '底座：二脚底座（无挡脚）', '底座：二脚底座有CB（无挡脚）'),
                '底座：三脚底座（有挡脚）', '底座：三脚底座有CB（有挡脚）'),
                'PC塑料外壳：圆孔长外壳（茶色）', 'PC塑料外壳：圆孔长外壳有CB（茶色）'),
                'PC塑料外壳：圆孔长外壳（透明）', 'PC塑料外壳：圆孔长外壳有CB（透明）'),
                'PC塑料外壳：圆孔短外壳（茶色）', 'PC塑料外壳：圆孔短外壳有CB（茶色）'),
                'PC塑料外壳：椭圆孔长外壳无CB字（茶色）', 'PC塑料外壳：椭圆孔长外壳无CB（茶色）'),
                'PC塑料外壳：无耳外壳无CB字（茶色）', 'PC塑料外壳：无耳外壳无CB（茶色）'),
                '外壳：外壳', '外壳：有CB外壳')
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
    HAVING MAX(jt.material_id IN ('3101', '3102', '3401', '3402', '3403', '3404', '3405', '3754')) = 1
) rebuilt ON rebuilt.id = l.id
SET l.after_json = rebuilt.next_json;

UPDATE op_log o
JOIN (
    SELECT s.id,
        JSON_SET(s.detail_json, '$.bomSpec', JSON_OBJECT(
            'items', CAST(CONCAT('[', COALESCE(GROUP_CONCAT(
                CASE jt.material_id
                    WHEN '3101' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '二脚底座有CB（无挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3102' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '三脚底座有CB（有挡脚）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3401' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '圆孔长外壳有CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3402' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '圆孔长外壳有CB（透明）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3403' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '圆孔短外壳有CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3404' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '椭圆孔长外壳无CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3405' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '无耳外壳无CB（茶色）', 'position', jt.position, 'quantity', jt.quantity)
                    WHEN '3754' THEN JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', '有CB外壳', 'position', jt.position, 'quantity', jt.quantity)
                    ELSE JSON_OBJECT('materialId', jt.material_id, 'groupKey', jt.group_key, 'groupName', jt.group_name, 'name', jt.name, 'position', jt.position, 'quantity', jt.quantity)
                END
                ORDER BY jt.position, jt.ord SEPARATOR ','), ''), ']') AS JSON),
            'modelCode', JSON_EXTRACT(s.detail_json, '$.bomSpec.modelCode'),
            'spec', REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(s.detail_json, '$.bomSpec.spec')),
                '底座：二脚底座（无挡脚）', '底座：二脚底座有CB（无挡脚）'),
                '底座：三脚底座（有挡脚）', '底座：三脚底座有CB（有挡脚）'),
                'PC塑料外壳：圆孔长外壳（茶色）', 'PC塑料外壳：圆孔长外壳有CB（茶色）'),
                'PC塑料外壳：圆孔长外壳（透明）', 'PC塑料外壳：圆孔长外壳有CB（透明）'),
                'PC塑料外壳：圆孔短外壳（茶色）', 'PC塑料外壳：圆孔短外壳有CB（茶色）'),
                'PC塑料外壳：椭圆孔长外壳无CB字（茶色）', 'PC塑料外壳：椭圆孔长外壳无CB（茶色）'),
                'PC塑料外壳：无耳外壳无CB字（茶色）', 'PC塑料外壳：无耳外壳无CB（茶色）'),
                '外壳：外壳', '外壳：有CB外壳')
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
    HAVING MAX(jt.material_id IN ('3101', '3102', '3401', '3402', '3403', '3404', '3405', '3754')) = 1
) rebuilt ON rebuilt.id = o.id
SET o.detail_json = rebuilt.next_json;

COMMIT;

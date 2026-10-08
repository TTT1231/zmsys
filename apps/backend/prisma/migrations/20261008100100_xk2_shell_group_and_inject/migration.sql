-- 旋转XK2 新增「外壳」分组并给存量档案补挂有CB外壳（业务确认 2026-10-08）：
--   1) 目录：根组「外壳」(2720, group_key=shell, 单选不带数量) 排在触点分区之后
--      （sort_order=9，目录最后），物料 3780 有CB外壳 / 3781 无CB外壳；
--   2) 存量：所有 XK2 BOM（生产 2026-10-08 核验共 11 档、全为有CB）注入
--      bom_item 3780「有CB外壳」——外壳组排序在目录最后，position=各档 MAX+1
--      与新建 BOM 的紧凑顺序（bom-rules.ts 按目录顺序分配 1..N）完全一致
--      （先例 20260926000000 压杆补挂）；
--   3) 物料集变化 → 全部 XK2 BOM 重算判重指纹（同构 SQL，先例
--      20260927000000/20261005010000）；各集合原本互异，统一并入同一 id 后仍互异，
--      uk_bom_identity / uk_bom_item_once（3780 为全新 id）无冲突窗口；
--   4) 冻结快照五处同步（先例 20261006100000）：订单按 FK（快照恒为当前 BOM 构成），
--      change_log before/after 与 op_log（仅订单目标）按内容判定 XK2 味——items 含
--      1001 目录物料即追加，按半段独立圈定（历史换 BOM 的订单轨迹不会误伤另一半）；
--      create_bom/delete_bom 建档审计保留历史。
-- 幂等：INSERT 带 NOT EXISTS 守卫；注入/追加均带「未含 3780」守卫，重放空转；
--   指纹重算重放同值。备份→部署窗口内新建的 XK2 BOM 由「注入时全量+守卫」兜底。
-- MySQL 8.0.46 坑（生产已验证）：JSON_CONTAINS 不接受通配 path（ERROR 3149），须
--   JSON_EXTRACT 先展开；JSON_TABLE 的行源不得取自带 WHERE 的派生表
--   （ER_WRONG_ARGUMENTS），须直接基表逗号 JOIN 后 WHERE 过滤（NULL 文档零行，
--   天然跳过，已实测）。
START TRANSACTION;

-- ── B1 目录 ────────────────────────────────────────────────────────────────
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, qty, sort_order)
SELECT 2720, 1001, NULL, 'GROUP', '外壳', 'shell', 0, 0, 9 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_group WHERE id = 2720);

INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3780, 2720, '有CB外壳', 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3780);
INSERT INTO material_item (id, group_id, name, sort_order)
SELECT 3781, 2720, '无CB外壳', 2 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM material_item WHERE id = 3781);

-- ── B2 存量 XK2 BOM 注入有CB外壳（position=MAX+1，quantity 恒 1） ───────────
CREATE TEMPORARY TABLE tmp_xk2_shell AS
SELECT ROW_NUMBER() OVER (ORDER BY bt.bom_code) AS rn,
       bt.id AS bom_id,
       (SELECT COALESCE(MAX(bi.position), 0) FROM bom_item bi WHERE bi.bom_id = bt.id) AS max_pos
FROM bom_table bt
WHERE bt.category_id = 1001
  AND NOT EXISTS (
      SELECT 1 FROM bom_item bi
      WHERE bi.bom_id = bt.id AND bi.material_id = 3780
  );

-- 补行 id 从 bom_item 当前最大 id 顺延（表无自增，id 显式赋值）
INSERT INTO bom_item (id, bom_id, material_id, group_key, group_name, name, position, quantity, created_at)
SELECT (SELECT COALESCE(MAX(bi2.id), 0) FROM bom_item bi2) + t.rn,
       t.bom_id,
       3780,
       'shell', '外壳', '有CB外壳',
       t.max_pos + 1, 1, NOW(3)
FROM tmp_xk2_shell t;

DROP TEMPORARY TABLE tmp_xk2_shell;

-- ── B3 全部 XK2 BOM 重算判重指纹 ───────────────────────────────────────────
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
WHERE bt.category_id = 1001;

-- ── B4 订单冻结快照追加（按 FK：快照恒为当前 BOM 构成，含归档/软删行） ──────
UPDATE sales_order_table o
JOIN bom_table bt ON bt.id = o.bom_id
SET o.bom_spec_snapshot = JSON_SET(
    JSON_ARRAY_APPEND(o.bom_spec_snapshot, '$.items',
        JSON_OBJECT(
            'materialId', '3780',
            'groupKey', 'shell',
            'groupName', '外壳',
            'name', '有CB外壳',
            'position', JSON_LENGTH(JSON_EXTRACT(o.bom_spec_snapshot, '$.items')) + 1,
            'quantity', 1
        )),
    '$.spec', CONCAT(
        IFNULL(JSON_UNQUOTE(JSON_EXTRACT(o.bom_spec_snapshot, '$.spec')), ''),
        IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(o.bom_spec_snapshot, '$.spec')), '') = '', '', ' · '),
        '外壳：有CB外壳'))
WHERE bt.category_id = 1001
  AND JSON_TYPE(JSON_EXTRACT(o.bom_spec_snapshot, '$.items')) = 'ARRAY'
  AND NOT JSON_CONTAINS(JSON_EXTRACT(o.bom_spec_snapshot, '$.items[*].materialId'), JSON_QUOTE('3780'));

-- ── B5 变更日志/操作日志按内容圈定后逐半段追加 ──────────────────────────────
-- before 半段为 XK2 味（items 含 1001 目录物料）的日志行
CREATE TEMPORARY TABLE tmp_xk2_cl_before (PRIMARY KEY (id)) AS
SELECT DISTINCT s.id
FROM sales_order_change_log s, JSON_TABLE(s.before_json, '$.bomSpec.items[*]'
    COLUMNS (mid VARCHAR(24) PATH '$.materialId')) jt
WHERE JSON_TYPE(JSON_EXTRACT(s.before_json, '$.bomSpec')) = 'OBJECT'
  AND EXISTS (
    SELECT 1
    FROM material_item mi
    JOIN material_group mg ON mg.id = mi.group_id
    WHERE mg.category_id = 1001
      AND mi.id = jt.mid
);

UPDATE sales_order_change_log l
JOIN tmp_xk2_cl_before t ON t.id = l.id
SET l.before_json = IF(
    JSON_TYPE(JSON_EXTRACT(l.before_json, '$.bomSpec.items')) = 'ARRAY'
    AND NOT JSON_CONTAINS(JSON_EXTRACT(l.before_json, '$.bomSpec.items[*].materialId'), JSON_QUOTE('3780')),
    JSON_SET(
        JSON_ARRAY_APPEND(l.before_json, '$.bomSpec.items',
            JSON_OBJECT(
                'materialId', '3780',
                'groupKey', 'shell',
                'groupName', '外壳',
                'name', '有CB外壳',
                'position', JSON_LENGTH(JSON_EXTRACT(l.before_json, '$.bomSpec.items')) + 1,
                'quantity', 1
            )),
        '$.bomSpec.spec', CONCAT(
            IFNULL(JSON_UNQUOTE(JSON_EXTRACT(l.before_json, '$.bomSpec.spec')), ''),
            IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(l.before_json, '$.bomSpec.spec')), '') = '', '', ' · '),
            '外壳：有CB外壳')),
    l.before_json);

-- after 半段
CREATE TEMPORARY TABLE tmp_xk2_cl_after (PRIMARY KEY (id)) AS
SELECT DISTINCT s.id
FROM sales_order_change_log s, JSON_TABLE(s.after_json, '$.bomSpec.items[*]'
    COLUMNS (mid VARCHAR(24) PATH '$.materialId')) jt
WHERE JSON_TYPE(JSON_EXTRACT(s.after_json, '$.bomSpec')) = 'OBJECT'
  AND EXISTS (
    SELECT 1
    FROM material_item mi
    JOIN material_group mg ON mg.id = mi.group_id
    WHERE mg.category_id = 1001
      AND mi.id = jt.mid
);

UPDATE sales_order_change_log l
JOIN tmp_xk2_cl_after t ON t.id = l.id
SET l.after_json = IF(
    JSON_TYPE(JSON_EXTRACT(l.after_json, '$.bomSpec.items')) = 'ARRAY'
    AND NOT JSON_CONTAINS(JSON_EXTRACT(l.after_json, '$.bomSpec.items[*].materialId'), JSON_QUOTE('3780')),
    JSON_SET(
        JSON_ARRAY_APPEND(l.after_json, '$.bomSpec.items',
            JSON_OBJECT(
                'materialId', '3780',
                'groupKey', 'shell',
                'groupName', '外壳',
                'name', '有CB外壳',
                'position', JSON_LENGTH(JSON_EXTRACT(l.after_json, '$.bomSpec.items')) + 1,
                'quantity', 1
            )),
        '$.bomSpec.spec', CONCAT(
            IFNULL(JSON_UNQUOTE(JSON_EXTRACT(l.after_json, '$.bomSpec.spec')), ''),
            IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(l.after_json, '$.bomSpec.spec')), '') = '', '', ' · '),
            '外壳：有CB外壳')),
    l.after_json);

-- op_log 订单目标
CREATE TEMPORARY TABLE tmp_xk2_op (PRIMARY KEY (id)) AS
SELECT DISTINCT s.id
FROM op_log s, JSON_TABLE(s.detail_json, '$.bomSpec.items[*]'
    COLUMNS (mid VARCHAR(24) PATH '$.materialId')) jt
WHERE s.target_type = 'order'
  AND JSON_TYPE(JSON_EXTRACT(s.detail_json, '$.bomSpec')) = 'OBJECT'
  AND EXISTS (
    SELECT 1
    FROM material_item mi
    JOIN material_group mg ON mg.id = mi.group_id
    WHERE mg.category_id = 1001
      AND mi.id = jt.mid
);

UPDATE op_log o
JOIN tmp_xk2_op t ON t.id = o.id
SET o.detail_json = IF(
    JSON_TYPE(JSON_EXTRACT(o.detail_json, '$.bomSpec.items')) = 'ARRAY'
    AND NOT JSON_CONTAINS(JSON_EXTRACT(o.detail_json, '$.bomSpec.items[*].materialId'), JSON_QUOTE('3780')),
    JSON_SET(
        JSON_ARRAY_APPEND(o.detail_json, '$.bomSpec.items',
            JSON_OBJECT(
                'materialId', '3780',
                'groupKey', 'shell',
                'groupName', '外壳',
                'name', '有CB外壳',
                'position', JSON_LENGTH(JSON_EXTRACT(o.detail_json, '$.bomSpec.items')) + 1,
                'quantity', 1
            )),
        '$.bomSpec.spec', CONCAT(
            IFNULL(JSON_UNQUOTE(JSON_EXTRACT(o.detail_json, '$.bomSpec.spec')), ''),
            IF(IFNULL(JSON_UNQUOTE(JSON_EXTRACT(o.detail_json, '$.bomSpec.spec')), '') = '', '', ' · '),
            '外壳：有CB外壳')),
    o.detail_json);

DROP TEMPORARY TABLE tmp_xk2_cl_before;
DROP TEMPORARY TABLE tmp_xk2_cl_after;
DROP TEMPORARY TABLE tmp_xk2_op;

COMMIT;

-- op_log 订单快照一次性回填（读时回填分支退役）：create_order/delete_order 的
-- detail.bomRemark 与 detail.bomSpec.spec 此前由 system-logs 读路径每次列表请求
-- 实时补算（查 bom_table / 按 items 重拼），修复只发生在响应里，detail_json 本体、
-- 关键词搜索等其它消费方仍见旧形状，查询成本永久支付。本迁移把两字段回填进存量行，
-- 服务层随删读时分支。
-- 回填依据（不可变快照，回填不引入漂移）：
-- - bomRemark：BOM 建档后不可修改且被订单引用即不可删除，实时 remark 恒等于建档值
--   （与 orders.service 写入侧同源）；BOM 备注为空的行不写键，与"空值不展示"口径一致；
-- - bomSpec.spec：按 detail.bomSpec.items 以与 bom-display.ts summaryPartOf 完全相同的
--   规则重拼（position 升序、"组名：物料名"、quantity>1 追加" ×N"、缺 quantity 按 1、
--   分隔符" · "）——同构 SQL 先例见 20260923000000 对 sales_order_table.bom_spec_snapshot
--   的重建；spec 已存在的行不动。
-- 缺 bomCode / bomSpec.items 为空的行无法回填，跳过（与原读时回填的可达集合一致，
-- 卡片按空值不展示口径降级）。

-- 1) bomRemark：按 detail.bomCode 关联 BOM 建档备注，仅回填缺失且备注非空的行
UPDATE op_log AS o
JOIN bom_table AS b ON b.bom_code = JSON_UNQUOTE(JSON_EXTRACT(o.detail_json, '$.bomCode'))
SET o.detail_json = JSON_SET(o.detail_json, '$.bomRemark', b.remark)
WHERE o.action IN ('create_order', 'delete_order')
  AND JSON_TYPE(JSON_EXTRACT(o.detail_json, '$.bomCode')) = 'STRING'
  AND JSON_EXTRACT(o.detail_json, '$.bomRemark') IS NULL
  AND b.remark <> '';

-- 2) bomSpec.spec：缺失/空串时按冻结 items 重拼（规则与写侧 summaryPartOf 逐字对齐）
SET SESSION group_concat_max_len = 1048576;

UPDATE op_log AS o
JOIN (
    SELECT l.id AS log_id,
        GROUP_CONCAT(
            CONCAT(
                JSON_UNQUOTE(JSON_EXTRACT(jt.item, '$.groupName')), '：',
                JSON_UNQUOTE(JSON_EXTRACT(jt.item, '$.name')),
                CASE
                    WHEN CAST(COALESCE(JSON_EXTRACT(jt.item, '$.quantity'), 1) AS UNSIGNED) > 1
                    THEN CONCAT(' ×', CAST(COALESCE(JSON_EXTRACT(jt.item, '$.quantity'), 1) AS UNSIGNED))
                    ELSE ''
                END
            )
            ORDER BY CAST(JSON_EXTRACT(jt.item, '$.position') AS UNSIGNED) ASC
            SEPARATOR ' · '
        ) AS spec
    FROM op_log AS l
    JOIN JSON_TABLE(l.detail_json, '$.bomSpec.items[*]'
        COLUMNS (item JSON PATH '$', ord FOR ORDINALITY)) AS jt
    WHERE l.action IN ('create_order', 'delete_order')
      AND JSON_TYPE(JSON_EXTRACT(l.detail_json, '$.bomSpec')) = 'OBJECT'
      AND (JSON_EXTRACT(l.detail_json, '$.bomSpec.spec') IS NULL
           OR JSON_EXTRACT(l.detail_json, '$.bomSpec.spec') = '')
    GROUP BY l.id
) AS s ON s.log_id = o.id
SET o.detail_json = JSON_SET(o.detail_json, '$.bomSpec.spec', s.spec);

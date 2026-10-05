-- XK2003 两笔订单的冻结快照同步勘误（业务确认 2026-10-05：随 BOM 修厚一并对齐）：
-- ZM260901001（已归档）与 ZM260929005（进行中）下单时冻结的 bom_spec_snapshot
-- 仍是触点厚度 0.2（物料 3620），重新打印/导出会展示旧厚度。按订单维度把三处
-- 冻结快照一并改为 0.3（物料 3621）：
--   1) sales_order_table.bom_spec_snapshot（订单详情与出库打印读这里）；
--   2) sales_order_change_log.before_json/after_json 的 $.bomSpec（订单历史轨迹，
--      含 ARCHIVE 事件的前后镜像）；
--   3) op_log.detail_json 的 $.bomSpec（create_order/archive_order 时间线卡片；
--      ZM260901001 的 create_order 为无 bomSpec 的旧形状，JSON_SEARCH 无命中自动跳过）。
-- 仅替换触点厚度项：materialId 3620→3621、冻结名 0.2→0.3、spec 串「触点厚度：0.2」→
-- 「触点厚度：0.3」；其余历史命名（如「杆子点位厚度」）保持原样。命中路径由
-- JSON_SEARCH 动态定位（生产核验每份快照恰好一处），STRING 类型判断做防御：
-- 无命中（NULL）或多命中（ARRAY）整列原样保留，重放幂等。XK2003 自身的 create_bom
-- 审计快照记录「建档时为 0.2」的历史事实，按 20260935000000 先例不改写。

-- 1) 订单行快照（打印/详情数据源）
UPDATE sales_order_table so
JOIN bom_table bt ON bt.id = so.bom_id
SET so.bom_spec_snapshot = JSON_REPLACE(
        JSON_REPLACE(
            so.bom_spec_snapshot,
            JSON_UNQUOTE(JSON_SEARCH(so.bom_spec_snapshot, 'all', '3620')), '3621',
            REPLACE(JSON_UNQUOTE(JSON_SEARCH(so.bom_spec_snapshot, 'all', '3620')), 'materialId', 'name'), '0.3'
        ),
        '$.spec',
        REPLACE(JSON_UNQUOTE(JSON_EXTRACT(so.bom_spec_snapshot, '$.spec')), '触点厚度：0.2', '触点厚度：0.3')
    )
WHERE bt.bom_code = 'XK2003'
  AND JSON_TYPE(JSON_SEARCH(so.bom_spec_snapshot, 'all', '3620')) = 'STRING';

-- 2) 订单变更日志（CREATE/UPDATE/ARCHIVE 的前后镜像，快照挂在 $.bomSpec 下）
UPDATE sales_order_change_log cl
JOIN sales_order_table so ON so.id = cl.order_id
JOIN bom_table bt ON bt.id = so.bom_id
SET
    cl.before_json = IF(
        JSON_TYPE(JSON_SEARCH(cl.before_json, 'all', '3620')) = 'STRING',
        JSON_REPLACE(
            JSON_REPLACE(
                cl.before_json,
                JSON_UNQUOTE(JSON_SEARCH(cl.before_json, 'all', '3620')), '3621',
                REPLACE(JSON_UNQUOTE(JSON_SEARCH(cl.before_json, 'all', '3620')), 'materialId', 'name'), '0.3'
            ),
            '$.bomSpec.spec',
            IF(JSON_TYPE(JSON_EXTRACT(cl.before_json, '$.bomSpec.spec')) = 'STRING',
               REPLACE(JSON_UNQUOTE(JSON_EXTRACT(cl.before_json, '$.bomSpec.spec')), '触点厚度：0.2', '触点厚度：0.3'),
               JSON_EXTRACT(cl.before_json, '$.bomSpec.spec'))
        ),
        cl.before_json
    ),
    cl.after_json = IF(
        JSON_TYPE(JSON_SEARCH(cl.after_json, 'all', '3620')) = 'STRING',
        JSON_REPLACE(
            JSON_REPLACE(
                cl.after_json,
                JSON_UNQUOTE(JSON_SEARCH(cl.after_json, 'all', '3620')), '3621',
                REPLACE(JSON_UNQUOTE(JSON_SEARCH(cl.after_json, 'all', '3620')), 'materialId', 'name'), '0.3'
            ),
            '$.bomSpec.spec',
            IF(JSON_TYPE(JSON_EXTRACT(cl.after_json, '$.bomSpec.spec')) = 'STRING',
               REPLACE(JSON_UNQUOTE(JSON_EXTRACT(cl.after_json, '$.bomSpec.spec')), '触点厚度：0.2', '触点厚度：0.3'),
               JSON_EXTRACT(cl.after_json, '$.bomSpec.spec'))
        ),
        cl.after_json
    )
WHERE bt.bom_code = 'XK2003';

-- 3) 系统日志时间线（create_order/archive_order 的 bomSpec 快照）
UPDATE op_log o
JOIN sales_order_table so ON so.id = o.target_id AND o.target_type = 'order'
JOIN bom_table bt ON bt.id = so.bom_id
SET o.detail_json = IF(
    JSON_TYPE(JSON_SEARCH(o.detail_json, 'all', '3620')) = 'STRING',
    JSON_REPLACE(
        JSON_REPLACE(
            o.detail_json,
            JSON_UNQUOTE(JSON_SEARCH(o.detail_json, 'all', '3620')), '3621',
            REPLACE(JSON_UNQUOTE(JSON_SEARCH(o.detail_json, 'all', '3620')), 'materialId', 'name'), '0.3'
        ),
        '$.bomSpec.spec',
        IF(JSON_TYPE(JSON_EXTRACT(o.detail_json, '$.bomSpec.spec')) = 'STRING',
           REPLACE(JSON_UNQUOTE(JSON_EXTRACT(o.detail_json, '$.bomSpec.spec')), '触点厚度：0.2', '触点厚度：0.3'),
           JSON_EXTRACT(o.detail_json, '$.bomSpec.spec'))
    ),
    o.detail_json
)
WHERE bt.bom_code = 'XK2003';

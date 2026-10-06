-- 微动开关「按钮」选项去掉用途注记（业务确认 2026-10-06）：
-- 新微动 7.6mm（常用装跌倒）→7.6mm（物料 3104，组 2113）、
-- 老微动 8.5mm（常用装跌倒）→8.5mm（物料 3204，组 2213，仅被子选老微动目录的
-- 跌倒开关档 KD001/KD002/KD004 选用）。目录与订单侧冻结快照同步勘误
-- （先例 20261005030000），每个物料五处：
--   1) material_item 目录名（新建 BOM 下拉展示当前名）；
--   2) bom_item 建档冻结名（BOM 明细与摘要展示）；
--   3) sales_order_table.bom_spec_snapshot 的 $.items[*].name 与 $.spec 串
--      （订单详情与出库打印数据源）；
--   4) sales_order_change_log.before/after 的 $.bomSpec 同构（订单历史轨迹）；
--   5) op_log.detail_json 的 $.bomSpec 同构，仅订单目标（create/delete/archive_order
--      时间线）；create_bom/delete_bom 的建档/删档审计按 20260935000000 先例记
--      历史事实，不改写。
-- 命中路径 JSON_SEARCH 动态定位（已核验每份 JSON 恰好一处），无命中自动空转，
-- 重放幂等；只改名称不动物料编号，判重指纹（materialSetHash 仅取物料 id）与
-- uk_bom_identity 不受影响；新名在同组内无撞名（uk_material_item_name 安全）。
START TRANSACTION;

-- ---- 7.6mm（新微动，物料 3104）----
UPDATE material_item
SET name = '7.6mm'
WHERE id = 3104 AND name = '7.6mm（常用装跌倒）';

UPDATE bom_item
SET name = '7.6mm'
WHERE material_id = 3104 AND name = '7.6mm（常用装跌倒）';

UPDATE sales_order_table
SET bom_spec_snapshot = JSON_REPLACE(
        bom_spec_snapshot,
        JSON_UNQUOTE(JSON_SEARCH(bom_spec_snapshot, 'all', '7.6mm（常用装跌倒）')), '7.6mm',
        '$.spec', REPLACE(JSON_UNQUOTE(JSON_EXTRACT(bom_spec_snapshot, '$.spec')), '按钮：7.6mm（常用装跌倒）', '按钮：7.6mm')
    )
WHERE JSON_TYPE(JSON_SEARCH(bom_spec_snapshot, 'all', '7.6mm（常用装跌倒）')) = 'STRING';

UPDATE sales_order_change_log
SET
    before_json = IF(
        JSON_TYPE(JSON_SEARCH(before_json, 'all', '7.6mm（常用装跌倒）')) = 'STRING',
        JSON_REPLACE(
            before_json,
            JSON_UNQUOTE(JSON_SEARCH(before_json, 'all', '7.6mm（常用装跌倒）')), '7.6mm',
            '$.bomSpec.spec',
            IF(JSON_TYPE(JSON_EXTRACT(before_json, '$.bomSpec.spec')) = 'STRING',
               REPLACE(JSON_UNQUOTE(JSON_EXTRACT(before_json, '$.bomSpec.spec')), '按钮：7.6mm（常用装跌倒）', '按钮：7.6mm'),
               JSON_EXTRACT(before_json, '$.bomSpec.spec'))
        ),
        before_json
    ),
    after_json = IF(
        JSON_TYPE(JSON_SEARCH(after_json, 'all', '7.6mm（常用装跌倒）')) = 'STRING',
        JSON_REPLACE(
            after_json,
            JSON_UNQUOTE(JSON_SEARCH(after_json, 'all', '7.6mm（常用装跌倒）')), '7.6mm',
            '$.bomSpec.spec',
            IF(JSON_TYPE(JSON_EXTRACT(after_json, '$.bomSpec.spec')) = 'STRING',
               REPLACE(JSON_UNQUOTE(JSON_EXTRACT(after_json, '$.bomSpec.spec')), '按钮：7.6mm（常用装跌倒）', '按钮：7.6mm'),
               JSON_EXTRACT(after_json, '$.bomSpec.spec'))
        ),
        after_json
    )
WHERE JSON_SEARCH(before_json, 'one', '7.6mm（常用装跌倒）') IS NOT NULL
   OR JSON_SEARCH(after_json, 'one', '7.6mm（常用装跌倒）') IS NOT NULL;

UPDATE op_log
SET detail_json = IF(
    JSON_TYPE(JSON_SEARCH(detail_json, 'all', '7.6mm（常用装跌倒）')) = 'STRING',
    JSON_REPLACE(
        detail_json,
        JSON_UNQUOTE(JSON_SEARCH(detail_json, 'all', '7.6mm（常用装跌倒）')), '7.6mm',
        '$.bomSpec.spec',
        IF(JSON_TYPE(JSON_EXTRACT(detail_json, '$.bomSpec.spec')) = 'STRING',
           REPLACE(JSON_UNQUOTE(JSON_EXTRACT(detail_json, '$.bomSpec.spec')), '按钮：7.6mm（常用装跌倒）', '按钮：7.6mm'),
           JSON_EXTRACT(detail_json, '$.bomSpec.spec'))
    ),
    detail_json
)
WHERE target_type = 'order'
  AND JSON_TYPE(JSON_SEARCH(detail_json, 'all', '7.6mm（常用装跌倒）')) = 'STRING';

-- ---- 8.5mm（老微动，物料 3204）----
UPDATE material_item
SET name = '8.5mm'
WHERE id = 3204 AND name = '8.5mm（常用装跌倒）';

UPDATE bom_item
SET name = '8.5mm'
WHERE material_id = 3204 AND name = '8.5mm（常用装跌倒）';

UPDATE sales_order_table
SET bom_spec_snapshot = JSON_REPLACE(
        bom_spec_snapshot,
        JSON_UNQUOTE(JSON_SEARCH(bom_spec_snapshot, 'all', '8.5mm（常用装跌倒）')), '8.5mm',
        '$.spec', REPLACE(JSON_UNQUOTE(JSON_EXTRACT(bom_spec_snapshot, '$.spec')), '按钮：8.5mm（常用装跌倒）', '按钮：8.5mm')
    )
WHERE JSON_TYPE(JSON_SEARCH(bom_spec_snapshot, 'all', '8.5mm（常用装跌倒）')) = 'STRING';

UPDATE sales_order_change_log
SET
    before_json = IF(
        JSON_TYPE(JSON_SEARCH(before_json, 'all', '8.5mm（常用装跌倒）')) = 'STRING',
        JSON_REPLACE(
            before_json,
            JSON_UNQUOTE(JSON_SEARCH(before_json, 'all', '8.5mm（常用装跌倒）')), '8.5mm',
            '$.bomSpec.spec',
            IF(JSON_TYPE(JSON_EXTRACT(before_json, '$.bomSpec.spec')) = 'STRING',
               REPLACE(JSON_UNQUOTE(JSON_EXTRACT(before_json, '$.bomSpec.spec')), '按钮：8.5mm（常用装跌倒）', '按钮：8.5mm'),
               JSON_EXTRACT(before_json, '$.bomSpec.spec'))
        ),
        before_json
    ),
    after_json = IF(
        JSON_TYPE(JSON_SEARCH(after_json, 'all', '8.5mm（常用装跌倒）')) = 'STRING',
        JSON_REPLACE(
            after_json,
            JSON_UNQUOTE(JSON_SEARCH(after_json, 'all', '8.5mm（常用装跌倒）')), '8.5mm',
            '$.bomSpec.spec',
            IF(JSON_TYPE(JSON_EXTRACT(after_json, '$.bomSpec.spec')) = 'STRING',
               REPLACE(JSON_UNQUOTE(JSON_EXTRACT(after_json, '$.bomSpec.spec')), '按钮：8.5mm（常用装跌倒）', '按钮：8.5mm'),
               JSON_EXTRACT(after_json, '$.bomSpec.spec'))
        ),
        after_json
    )
WHERE JSON_SEARCH(before_json, 'one', '8.5mm（常用装跌倒）') IS NOT NULL
   OR JSON_SEARCH(after_json, 'one', '8.5mm（常用装跌倒）') IS NOT NULL;

UPDATE op_log
SET detail_json = IF(
    JSON_TYPE(JSON_SEARCH(detail_json, 'all', '8.5mm（常用装跌倒）')) = 'STRING',
    JSON_REPLACE(
        detail_json,
        JSON_UNQUOTE(JSON_SEARCH(detail_json, 'all', '8.5mm（常用装跌倒）')), '8.5mm',
        '$.bomSpec.spec',
        IF(JSON_TYPE(JSON_EXTRACT(detail_json, '$.bomSpec.spec')) = 'STRING',
           REPLACE(JSON_UNQUOTE(JSON_EXTRACT(detail_json, '$.bomSpec.spec')), '按钮：8.5mm（常用装跌倒）', '按钮：8.5mm'),
           JSON_EXTRACT(detail_json, '$.bomSpec.spec'))
    ),
    detail_json
)
WHERE target_type = 'order'
  AND JSON_TYPE(JSON_SEARCH(detail_json, 'all', '8.5mm（常用装跌倒）')) = 'STRING';

COMMIT;

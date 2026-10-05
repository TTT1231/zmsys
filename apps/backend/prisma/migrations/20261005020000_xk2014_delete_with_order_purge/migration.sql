-- XK2014 删除 + 挡删引用清理（超管梁静确认 2026-10-05，业务数据修正）：
-- 现象：删除 XK2014 报「BOM 已被销售订单引用，不可删除」。生产实测（2026-10-05）
-- 唯一引用是软删订单 ZM260929004（2026-09-29 建、09-30 删，deleted_at 已置；
-- 入库/调整/出库均为 0）。订单删除为软删、行物理保留（fk_sales_order_bom RESTRICT
-- 物理挡删），delete_bom 校验按同口径计数（boms.service.ts deleteBom 的 raw 计数），
-- 本就等待台账清理任务 7 天保留期满后自动放行；按业务要求提前清理并删除 BOM。
-- 顺序与口径对齐既有代码路径：
--   1)-2) 同 LedgerPurgeService.purgeOrders：先清变更日志子行再删订单行，保留
--         op_log 的 create_order/delete_order 快照为审计残留；
--   3)-5) 同 BomsService.deleteBom：op_log 记 delete_bom 建档快照（detail 与
--         create_bom 同构 Bom 对象）→ 清 bom_item 子行 → 删 bom_table；
--         操作人快照 = 建档人（本例建档/删单/提出删除同为超管梁静，生产实测一致；
--         取 bt.created_by 使任意库 FK 自洽，测试库无此数据本语句 0 行空转）。
-- 全部语句限定 bom_code='XK2014' + deleted_at 非空 + 三类引用 NOT EXISTS：
-- 测试库无此单据全部 0 行空转；重放幂等（bom 行已删则 3)-5) 无源行/空转）。
-- op_log id 取 MAX+1：backend 停机窗口内执行无并发，远小于后续时钟位雪花 id。
START TRANSACTION;

-- 1) 软删订单的变更日志（FK 先清子行；口径同 purgeOrders）
DELETE cl FROM sales_order_change_log cl
JOIN sales_order_table so ON so.id = cl.order_id
JOIN bom_table bt ON bt.id = so.bom_id
WHERE bt.bom_code = 'XK2014'
  AND so.deleted_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM outbound_shipment os WHERE os.order_id = so.id);

-- 2) 订单行本身（保留 op_log 删除快照，审计口径同 purgeOrders）
DELETE so FROM sales_order_table so
JOIN bom_table bt ON bt.id = so.bom_id
WHERE bt.bom_code = 'XK2014'
  AND so.deleted_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM outbound_shipment os WHERE os.order_id = so.id);

-- 3) delete_bom 审计快照（created 为北京日语义同建档：ISO 毫秒 + Z 后缀）
SET SESSION group_concat_max_len = 1048576;
SET @next_oplog_id := (SELECT COALESCE(MAX(id), 0) + 1 FROM op_log);

INSERT INTO op_log (id, operator_id, operator_name_snapshot, operator_role_snapshot, action, target_type, target_id, target_code, detail_json)
SELECT
    @next_oplog_id,
    bt.created_by,
    su.name,
    su.role_code,
    'delete_bom',
    'bom',
    bt.id,
    bt.bom_code,
    JSON_OBJECT(
        'code', bt.bom_code,
        'name', bc.name,
        'modelCode', (
            SELECT bi.name FROM bom_item bi
            WHERE bi.bom_id = bt.id AND bi.group_key = 'model'
            ORDER BY bi.position ASC LIMIT 1
        ),
        'items', (
            SELECT CAST(CONCAT('[', GROUP_CONCAT(
                JSON_OBJECT(
                    'materialId', CAST(bi.material_id AS CHAR),
                    'groupKey', bi.group_key,
                    'groupName', bi.group_name,
                    'name', bi.name,
                    'quantity', bi.quantity
                )
                ORDER BY bi.position SEPARATOR ','
            ), ']') AS JSON)
            FROM bom_item bi
            WHERE bi.bom_id = bt.id
        ),
        'spec', (
            SELECT GROUP_CONCAT(
                CONCAT(bi.group_name, '：', bi.name,
                       CASE WHEN bi.quantity > 1 THEN CONCAT(' ×', bi.quantity) ELSE '' END)
                ORDER BY bi.position SEPARATOR ' · '
            )
            FROM bom_item bi
            WHERE bi.bom_id = bt.id
        ),
        'remark', bt.remark,
        'creator', su.name,
        'created', CONCAT(SUBSTRING(DATE_FORMAT(bt.created_at, '%Y-%m-%dT%H:%i:%s.%f'), 1, 23), 'Z'),
        'unit', bt.unit
    )
FROM bom_table bt
JOIN bom_category bc ON bc.id = bt.category_id
JOIN sys_user su ON su.id = bt.created_by
WHERE bt.bom_code = 'XK2014'
  AND NOT EXISTS (SELECT 1 FROM sales_order_table so WHERE so.bom_id = bt.id)
  AND NOT EXISTS (SELECT 1 FROM inbound_ledger il WHERE il.bom_id = bt.id)
  AND NOT EXISTS (SELECT 1 FROM stock_adjustment sa WHERE sa.bom_id = bt.id);

-- 4) BOM 明细（FK 先清子行；三重引用防御与 3) 同条件，引用未清则整体空转）
DELETE bi FROM bom_item bi
JOIN bom_table bt ON bt.id = bi.bom_id
WHERE bt.bom_code = 'XK2014'
  AND NOT EXISTS (SELECT 1 FROM sales_order_table so WHERE so.bom_id = bt.id)
  AND NOT EXISTS (SELECT 1 FROM inbound_ledger il WHERE il.bom_id = bt.id)
  AND NOT EXISTS (SELECT 1 FROM stock_adjustment sa WHERE sa.bom_id = bt.id);

-- 5) BOM 主行（删行后建档 create_bom 快照留作审计残留）
DELETE bt2 FROM bom_table bt2
WHERE bt2.bom_code = 'XK2014'
  AND NOT EXISTS (SELECT 1 FROM sales_order_table so WHERE so.bom_id = bt2.id)
  AND NOT EXISTS (SELECT 1 FROM inbound_ledger il WHERE il.bom_id = bt2.id)
  AND NOT EXISTS (SELECT 1 FROM stock_adjustment sa WHERE sa.bom_id = bt2.id);

COMMIT;

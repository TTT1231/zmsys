-- BOM 编码格式统一（db-scheme.md §1.3/§5.2）：去掉 ZM 头、老微动前缀 KW16→KWO、
-- 新微动序宽 4→3。存量编码迁移对照：ZMAQ001→AQ001、ZMKD001→KD001、
-- ZMKW0001→KW001、ZMKW16001→KWO001、ZMXK2001→XK2001、ZMXK3001→XK3001。
-- 订单/出入库/调整均以 bom_id 外键关联且快照不含编码，仅需迁移 bom_table.bom_code。

-- 1) 存量编码：先老微动（ZMKW16 前缀更长，须先于 ZMKW 处理），
--    再新微动（序号数字重排为至少 3 位），其余品类直接去 ZM 头。
UPDATE bom_table bt
JOIN bom_category bc ON bc.id = bt.category_id AND bc.category_key = 'old-micro-switch'
SET bt.bom_code = CONCAT('KWO', SUBSTRING(bt.bom_code, 7))
WHERE bt.bom_code LIKE 'ZMKW16%';

UPDATE bom_table bt
JOIN bom_category bc ON bc.id = bt.category_id AND bc.category_key = 'new-micro-switch'
SET bt.bom_code = CONCAT('KW',
    CASE
        WHEN CAST(SUBSTRING(bt.bom_code, 6) AS UNSIGNED) < 1000 THEN LPAD(SUBSTRING(bt.bom_code, 6), 3, '0')
        ELSE SUBSTRING(bt.bom_code, 6)
    END)
WHERE bt.bom_code LIKE 'ZMKW%';

UPDATE bom_table SET bom_code = SUBSTRING(bom_code, 3)
WHERE bom_code LIKE 'ZM%';

-- 2) 品类前缀与序宽与编码格式对齐（biz_sequence 品类序列号不变，续接一致）
UPDATE bom_category SET seq_width = 3 WHERE category_key = 'new-micro-switch';
UPDATE bom_category SET code_prefix = 'KWO' WHERE category_key = 'old-micro-switch';

-- 3) 旋转XK3 移除触点分区（XK3 类开关无触点、电流不大）：分区 2405、
--    分组 2418/2419/2420（contact-size/contact-thickness/contact-kind）、物料 3424-3430。
--    若存在已引用这些物料的 XK3 BOM，bom_item 外键 RESTRICT 会中止迁移（当前无 XK3 BOM）。
DELETE FROM material_item WHERE group_id IN (2418, 2419, 2420);
DELETE FROM material_group WHERE id IN (2418, 2419, 2420);
DELETE FROM material_group WHERE id = 2405;

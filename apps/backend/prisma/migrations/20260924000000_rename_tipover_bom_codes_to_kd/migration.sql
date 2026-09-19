-- 补齐 20260917094500_rename_tipover_prefix 的缺口：该迁移只把品类前缀
-- DD 改为 KD，未重命名存量 BOM 编码（注释口径 ZMDD001 → ZMKD001 未落 SQL）。
-- 生产/测试库在前缀改名后才建档，编码生成为 KD，本迁移对其为 no-op；
-- 仅修正改名前已建 DD 编码的环境（如本地开发库）：DD### → KD###，
-- 数字序号不变，biz_sequence 品类序列不受影响。
UPDATE bom_table bt
JOIN bom_category bc ON bc.id = bt.category_id AND bc.category_key = 'tipover-switch'
SET bt.bom_code = CONCAT('KD', SUBSTRING(bt.bom_code, 3))
WHERE bt.bom_code LIKE 'DD%';

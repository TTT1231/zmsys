-- 跌倒开关编码前缀：DD → KD（ZMDD001 → ZMKD001）
UPDATE bom_category SET code_prefix = 'KD' WHERE category_key = 'tipover-switch';

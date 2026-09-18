-- 品类显示名变更（2026-09-15）：旋转开关 → 旋转XK2。
-- category_key（rotary-switch）与编码前缀 XK2、取号序列（bom:rotary-switch）均不变；
-- 已建 BOM 的品类名由订单 bom_name_snapshot 冻照保留，列表展示实时读品类名。

UPDATE bom_category SET name = '旋转XK2' WHERE id = 1001;

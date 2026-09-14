-- 修正 20260914150000 中品类目录 UPDATE 的 NULL 陷阱：
-- 「盖子不存在时 JSON_SEARCH 返回 NULL，NOT NULL 仍为 NULL，WHERE 永不成立」，
-- 上一迁移的 bom_category 更新实际未命中任何行（bom_table 3744 行不受影响，已正确并入）。
-- 这里改用 IS NULL 判空，幂等：目录已含盖子时跳过。
UPDATE `bom_category`
SET `spec_schema` = '{"fields":[{"key":"底座","type":"select","label":"底座","options":["二脚底座（无挡脚）","三脚底座（有挡脚）"],"required":true},{"key":"盖子","label":"盖子","type":"text","defaultValue":"盖子"},{"key":"按钮高度","type":"select","label":"按钮高度","options":["7.6mm（常用装跌倒）","8.0mm","8.1mm","8.2mm圆弧","8.3mm","8.5mm","8.8mm","9.1mm"],"required":true},{"key":"支架","type":"select","label":"支架","options":["6.3支架：铜镀银","6.3支架：铜镀镍","6.3支架：复合铜镀镍","4.8支架：铜镀镍","4.8支架：复合铜镀镍"],"required":true},{"key":"静片","type":"select","label":"静片","options":["6.3静片：铜镀银","6.3静片：铜镀镍","6.3静片：复合铜镀镍","4.8静片：铜镀镍","4.8静片：复合铜镀镍"],"required":true},{"key":"动片","type":"select","label":"动片","options":["铜镀银","镀锡"],"required":true},{"key":"摆片","type":"select","label":"摆片","options":["铜镀银摆片","铁镀镍摆片","复合铜镀镍摆片"],"required":true},{"key":"弹片","type":"select","label":"弹片","options":["0.12","0.15","0.2"],"required":true}]}'
WHERE `id` = 1003
  AND JSON_SEARCH(`spec_schema`, 'one', '盖子') IS NULL;

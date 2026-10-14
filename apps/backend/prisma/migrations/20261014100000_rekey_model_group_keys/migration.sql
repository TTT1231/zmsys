-- 型号组（group_key='model'）概念移除（2026-10-14，配合结构维护 v2 的纯普通分组语义）：
-- 存量 model 键统一改写为 'g<id>'（id 为全局唯一雪花/种子 id，跨品类无碰撞，满足
-- uk_material_group_key）。bom_item 与订单 bom_spec_snapshot 中的历史冻结键不动（冻结原则），
-- 服务层已不再派生/消费 modelCode；新分组键由服务层依次派生 g1..。
UPDATE material_group SET group_key = CONCAT('g', id) WHERE group_key = 'model';

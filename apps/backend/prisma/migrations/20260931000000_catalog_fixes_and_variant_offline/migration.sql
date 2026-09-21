-- 三项目录数据修正：
-- 1) 焊线(xk3-wire)/插线(xk3-plug) 品类停用：仅作为旋转XK3 的接线工艺目录容器
--    （child_categories 引用），不再出现在建档品类下拉；接口仍随目录下发（status=false）。
-- 2) 旋转XK2 A/B 面「左脚银点（全银点）」更名为「左脚银点」：名称纠正（同一物料），
--    已引用的 BOM 冻结明细名同步更新（判重指纹按物料 id，不受改名影响）。
-- 3) 安全开关长款系列配件组名修正：长款/41mm → 长款/40mm、长款/43mm → 长款/41mm
--    （group_key 为稳定标识不动），已引用的冻结分组名同步更新。
UPDATE bom_category
SET status = 0
WHERE id IN (1008, 1009);

UPDATE material_item SET name = '左脚银点' WHERE id IN (3036, 3046);
UPDATE bom_item SET name = '左脚银点' WHERE material_id IN (3036, 3046);

UPDATE material_group SET name = '长款/40mm系列配件' WHERE id = 2613;
UPDATE material_group SET name = '长款/41mm系列配件' WHERE id = 2614;
UPDATE bom_item SET group_name = '长款/40mm系列配件' WHERE group_key = 'long-41-parts';
UPDATE bom_item SET group_name = '长款/41mm系列配件' WHERE group_key = 'long-43-parts';

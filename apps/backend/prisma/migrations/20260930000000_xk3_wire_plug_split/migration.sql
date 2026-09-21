-- 旋转XK3 接线工艺二分（原型 docs/prototype/xk3-wire-process-prototype.html）：
-- 建档入口「旋转XK3」先单选接线工艺（焊线 / 插线），再配置各自目录——复用跌倒开关
-- 的 child_categories 机制（父品类 1002 标记两个子品类，目录合并校验走现有逻辑）。
--
-- 结构：
--   1) 新品类 xk3-wire（焊线，独立前缀 XK3W 仅防撞号，业务主路径走「旋转XK3」+工艺）
--      与 xk3-plug（插线，前缀 XK3P）；1002 标记 child_categories 指向两者；
--   2) 插线目录 = 现行 XK3 目录整体迁移至 xk3-plug（material_group.category_id 1002→1009，
--      组结构 / 物料 / 多选标志不变；存量 BOM 明细为建档冻结快照不受影响）；
--   3) 焊线目录按《XK3焊线物料清单》新建：外壳 / 底座各一种，杆子圆轴 / 扁轴4.8，
--      五金件静片（多选）/ 动片 / 弹簧（多选）/ 3.0mm 电镀钢球；
--   4) 工艺不再靠备注表达：清掉 20260928000000 写入 XK3 存量 BOM 的「插线」备注
--      （工艺由建档时的接线工艺选择表达），并按同口径重算该品类判重指纹。
-- id 顺延：品类 1008/1009（现最大 1007），组 2711-2720（现最大 2710），物料 3754-3763（现最大 3753）。
INSERT INTO bom_category (id, category_key, name, code_prefix, seq_width, child_categories) VALUES
    (1008, 'xk3-wire', '焊线', 'XK3W', 3, NULL),
    (1009, 'xk3-plug', '插线', 'XK3P', 3, NULL);

UPDATE bom_category
SET child_categories = '["xk3-wire", "xk3-plug"]'
WHERE id = 1002;

-- 插线目录整体搬迁（组行 category_id 改挂，id/结构/物料不动）
UPDATE material_group
SET category_id = 1009
WHERE category_id = 1002;

-- 焊线目录
-- 注：杆子组直接挂根（与插线目录同构）——品类内 (category_id, name) 唯一，
-- 不能用与分组同名的「PA66塑料杆子」分区包裹。
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, qty, sort_order) VALUES
    (2711, 1008, NULL, 'SECTION', 'PC塑料', NULL, NULL, NULL, 1),
    (2712, 1008, 2711, 'GROUP', '外壳', 'shell', 0, 0, 1),
    (2713, 1008, 2711, 'GROUP', '底座', 'base', 0, 0, 2),
    (2714, 1008, NULL, 'GROUP', 'PA66塑料杆子', 'pa66-lever', 0, 0, 2),
    (2715, 1008, NULL, 'SECTION', '五金件', NULL, NULL, NULL, 3),
    (2716, 1008, 2715, 'GROUP', '静片', 'static-plate', 1, 0, 1),
    (2717, 1008, 2715, 'GROUP', '动片', 'moving-plate', 0, 0, 2),
    (2718, 1008, 2715, 'GROUP', '弹簧', 'spring', 1, 0, 3),
    (2719, 1008, 2715, 'GROUP', '钢球', 'steel-ball', 0, 0, 4);

INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    (3754, 2712, '外壳', 1),
    (3755, 2713, '底座', 1),
    (3756, 2714, '圆轴', 1),
    (3757, 2714, '扁轴4.8', 2),
    (3758, 2716, '小静片', 1),
    (3759, 2716, '半圆静片', 2),
    (3760, 2717, '带圈动片', 1),
    (3761, 2718, '长弹簧', 1),
    (3762, 2718, '短弹簧', 2),
    (3763, 2719, '3.0mm电镀钢球', 1);

-- 清掉 XK3 存量 BOM 的过渡备注（工艺改由接线工艺选择表达）
UPDATE bom_table
SET remark = ''
WHERE category_id = 1002
  AND remark = '插线';

SET SESSION group_concat_max_len = 1048576;

UPDATE bom_table bt
SET bt.spec_hash = UNHEX(SHA2(CONCAT(
    '["', bt.category_id, '",[',
    (
        SELECT GROUP_CONCAT(
            CONCAT('["', bi.material_id, '",', bi.quantity, ']')
            ORDER BY bi.material_id SEPARATOR ','
        )
        FROM bom_item bi
        WHERE bi.bom_id = bt.id
    ),
    '],', JSON_QUOTE(bt.remark), ']'
), 256))
WHERE bt.category_id = 1002;

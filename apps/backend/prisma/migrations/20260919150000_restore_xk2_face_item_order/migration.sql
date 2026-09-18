-- 恢复旋转XK2 A面/B面物料展示顺序（生产库 2026-09-16 应用的迁移回填仓库）：
-- 触点物料并入后 A/B 面保持原有 1-9 序，左脚铜点垫底（10）；幂等重申终态
UPDATE material_item SET sort_order = 1 WHERE id = 3031;
UPDATE material_item SET sort_order = 2 WHERE id = 3032;
UPDATE material_item SET sort_order = 3 WHERE id = 3033;
UPDATE material_item SET sort_order = 4 WHERE id = 3034;
UPDATE material_item SET sort_order = 5 WHERE id = 3035;
UPDATE material_item SET sort_order = 6 WHERE id = 3036;
UPDATE material_item SET sort_order = 7 WHERE id = 3037;
UPDATE material_item SET sort_order = 8 WHERE id = 3038;
UPDATE material_item SET sort_order = 9 WHERE id = 3039;
UPDATE material_item SET sort_order = 10 WHERE id = 3624;
UPDATE material_item SET sort_order = 1 WHERE id = 3041;
UPDATE material_item SET sort_order = 2 WHERE id = 3042;
UPDATE material_item SET sort_order = 3 WHERE id = 3043;
UPDATE material_item SET sort_order = 4 WHERE id = 3044;
UPDATE material_item SET sort_order = 5 WHERE id = 3045;
UPDATE material_item SET sort_order = 6 WHERE id = 3046;
UPDATE material_item SET sort_order = 7 WHERE id = 3047;
UPDATE material_item SET sort_order = 8 WHERE id = 3048;
UPDATE material_item SET sort_order = 9 WHERE id = 3049;
UPDATE material_item SET sort_order = 10 WHERE id = 3625;

-- 新老微动五金件目录扩充：新增「压杆」分组（单选、不带数量）。
-- 压杆是微动开关的必要零件，此前未录入目录：
--   老微动（1004 / KWO）只有「直杆」一种；新微动（1003 / KW）有「直杆」「弯杆」两种。
-- id 顺延当前最大值：material_group 2708 → 2709/2710，material_item 3746 → 3747-3749。
INSERT INTO material_group (id, category_id, parent_id, kind, name, group_key, multi, qty, sort_order) VALUES
    (2709, 1003, 2102, 'GROUP', '压杆', 'press-rod', 0, 0, 6),
    (2710, 1004, 2202, 'GROUP', '压杆', 'press-rod', 0, 0, 6);

INSERT INTO material_item (id, group_id, name, sort_order) VALUES
    (3747, 2709, '直杆', 1),
    (3748, 2709, '弯杆', 2),
    (3749, 2710, '直杆', 1);

-- 存量微动 BOM 补压杆明细（新微动默认「直杆」），冻结 group/name 与目录一致，quantity 恒 1。
-- 压杆在目录中位于五金件末尾（sort_order=6）、触点分区之前，故 position=9；
-- 原触点三行（position 9-11）后移为 10-12，与新建 BOM 的目录顺序（分区→组→物料 sortOrder）保持一致。
UPDATE bom_item bi
JOIN bom_table bt ON bt.id = bi.bom_id
SET bi.position = bi.position + 1
WHERE bt.category_id IN (1003, 1004)
  AND bi.group_key IN ('contact-size', 'contact-thickness', 'contact-kind');

-- 补行 id 从 bom_item 当前最大 id 顺延（表无自增，id 显式赋值）
CREATE TEMPORARY TABLE tmp_press_rod_targets AS
SELECT ROW_NUMBER() OVER (ORDER BY bt.bom_code) AS rn, bt.id AS bom_id, bt.category_id
FROM bom_table bt
WHERE bt.category_id IN (1003, 1004);

INSERT INTO bom_item (id, bom_id, material_id, group_key, group_name, name, position, quantity, created_at)
SELECT (SELECT COALESCE(MAX(bi2.id), 0) FROM bom_item bi2) + t.rn,
       t.bom_id,
       CASE WHEN t.category_id = 1003 THEN 3747 ELSE 3749 END,
       'press-rod', '压杆', '直杆', 9, 1, NOW(3)
FROM tmp_press_rod_targets t;

DROP TEMPORARY TABLE tmp_press_rod_targets;

-- 物料构成变化，重算受影响品类的判重指纹（与 20260922030000 同构的 SHA-256 口径）。
-- 同品类各 BOM 集合原本互异，统一并入同一物料 id 后仍互异，uk_bom_identity 无冲突窗口。
SET SESSION group_concat_max_len = 1048576;

UPDATE bom_table bt
SET bt.spec_hash = UNHEX(SHA2(CONCAT(
    '[',
    (
        SELECT GROUP_CONCAT(
            CONCAT('["', bi.material_id, '",', bi.quantity, ']')
            ORDER BY bi.material_id SEPARATOR ','
        )
        FROM bom_item bi
        WHERE bi.bom_id = bt.id
    ),
    ']'
), 256))
WHERE bt.category_id IN (1003, 1004);

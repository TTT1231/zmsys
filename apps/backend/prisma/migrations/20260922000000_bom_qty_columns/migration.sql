-- BOM 数量选择支持（琴键开关原型定稿 v3）：分组级 qty 标志 + 明细行数量。
-- - material_group.qty：GROUP 行 0/1（1 = 勾选后可选数量，如扣板/连锁片/静片/
--   动片）；SECTION 行恒 NULL。存量分组统一置 0（不带数量）。
-- - bom_item.quantity：建档冻结数量，非 qty 组恒 1，qty 组 1-99（步进器范围）。
ALTER TABLE material_group
    ADD COLUMN qty TINYINT UNSIGNED NULL AFTER multi;

UPDATE material_group SET qty = 0 WHERE kind = 'GROUP';

ALTER TABLE material_group
    DROP CHECK ck_material_group_kind,
    ADD CONSTRAINT ck_material_group_kind CHECK (
        (kind = 'SECTION' AND parent_id IS NULL AND group_key IS NULL AND multi IS NULL AND qty IS NULL)
        OR (kind = 'GROUP' AND group_key IS NOT NULL AND multi IN (0, 1) AND qty IN (0, 1))
    );

ALTER TABLE bom_item
    ADD COLUMN quantity INT UNSIGNED NOT NULL DEFAULT 1 AFTER position,
    ADD CONSTRAINT ck_bom_item_quantity CHECK (quantity BETWEEN 1 AND 99);

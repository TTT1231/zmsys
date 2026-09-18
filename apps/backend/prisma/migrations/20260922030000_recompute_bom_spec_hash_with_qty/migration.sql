-- spec_hash 算法升级：判重输入由纯物料 id 集合改为「物料 id + 数量」对
-- （同一物料集合、不同数量 = 不同 BOM）。新输入为按 id 数值升序的
-- [[id, quantity], ...] 数组的 JSON 序列化（与后端 bom-spec.ts 字节一致：
-- 数字不加引号、id 为十进制字符串），SHA-256 → BINARY(32)。
-- 存量 bom_item.quantity 由列默认值置 1，本迁移重算全部存量 spec_hash；
-- 同品类旧 hash 唯一，新 hash 为单射重算，uk_bom_identity 无冲突窗口。
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
), 256));

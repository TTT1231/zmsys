-- 出库打印状态拆除（db-scheme.md §7.3/§7.4）：出库单收缩为 REGISTERED/VOIDED 两态，
-- 打印变为无副作用的纯输出动作（不再落打印日志、不改单头状态、不记录打印原因），
-- 紧急撤销随 PRINTED 状态一并删除（普通作废成为唯一逆向入口）。本迁移：
-- 存量 PRINTED 单头归一为 REGISTERED；作废字段收敛为 voided_by/void_reason/voided_at
-- 三要素（void_mode/goods_not_departed/paper_invalidated 删除）；整表删除
-- outbound_print_log；outbound_state_log.event_type 新增 VOID（旧值 PRINT/REPRINT/
-- VOID_PRE_PRINT/VOID_EMERGENCY 保留：存量行仍引用，且 ck_outbound_state_versions
-- 要求事件链 after=before+1 不可删中间行）；删除受保护权限 outbound:emergency-void，
-- outbound:void/print 标签简化为动词。
-- 设计说明：
-- ① 语句按破坏性递增排序（UPDATE → 改列删列 → DROP TABLE），中途失败时数据损失最小；
-- ② 2026-09 本迁移将存量 PRINTED 回退为 REGISTERED，不产生 state_log 事件
--   （审计链上 PRINT 之后无对应事件，后人勿误判为手工改库）；
-- ③ 防御性 DELETE sys_grant 预期 0 行（BOOTSTRAP 从未授权 emergency-void，
--   protected=1 正常路径不可授予非 super；super 走服务端全量不依赖授权行），
--   若实际删到行则该授权变更无 sys_grant_log 审计记录。

-- 1. 存量 PRINTED → REGISTERED（旧 ck_void 的非 VOIDED 分支要求作废五要素全空，转换无冲突）
UPDATE `outbound_shipment` SET `state` = 'REGISTERED' WHERE `state` = 'PRINTED';

-- 2. 先删引用待删列的两个 CHECK，再收缩状态枚举、删紧急撤销三列
ALTER TABLE `outbound_shipment` DROP CONSTRAINT `ck_outbound_shipment_flags`;
ALTER TABLE `outbound_shipment` DROP CONSTRAINT `ck_outbound_shipment_void`;
ALTER TABLE `outbound_shipment`
    MODIFY COLUMN `state` ENUM('REGISTERED', 'VOIDED') NOT NULL DEFAULT 'REGISTERED',
    DROP COLUMN `void_mode`,
    DROP COLUMN `goods_not_departed`,
    DROP COLUMN `paper_invalidated`;

-- 3. 重建作废一致性：REGISTERED 三要素全空 / VOIDED 三要素齐全（原因 2-500 字）。
--    存量 EMERGENCY 作废单三要素本就被旧 CHECK 强制齐备，满足新约束
ALTER TABLE `outbound_shipment`
    ADD CONSTRAINT `ck_outbound_shipment_void` CHECK (
        (state = 'REGISTERED' AND voided_by IS NULL AND void_reason IS NULL AND voided_at IS NULL)
        OR
        (state = 'VOIDED' AND voided_by IS NOT NULL
            AND CHAR_LENGTH(TRIM(void_reason)) BETWEEN 2 AND 500
            AND voided_at IS NOT NULL)
    );

-- 4. 打印日志整表删除（该表仅外引 outbound_shipment/sys_user，无被引用方，视图不依赖）
DROP TABLE `outbound_print_log`;

-- 5. 状态机日志事件类型新增 VOID；旧枚举值保留给存量行（代码此后只写 REGISTER/VOID）
ALTER TABLE `outbound_state_log`
    MODIFY COLUMN `event_type`
    ENUM('REGISTER', 'PRINT', 'REPRINT', 'VOID_PRE_PRINT', 'VOID_EMERGENCY', 'VOID') NOT NULL;

-- 6. 权限目录：删紧急撤销（先清 sys_grant 兜底 fk_sys_grant_permission 的 ON DELETE RESTRICT），
--    作废/打印标签去限定词（上下文已锁定宾语）
DELETE FROM `sys_grant` WHERE `permission_code` = 'outbound:emergency-void';
DELETE FROM `sys_permission` WHERE `code` = 'outbound:emergency-void';
UPDATE `sys_permission` SET `label` = '作废' WHERE `code` = 'outbound:void';
UPDATE `sys_permission` SET `label` = '打印' WHERE `code` = 'outbound:print';

-- 订单"取消"概念清理（db-scheme.md §6.1/§8）：业务定稿订单只有活跃/归档两态，
-- 一件未发不要了直接删除（orders:delete），发过货不要了归档结案（orders:archive），
-- 取消生命周期不再存在。前端入口已随 f017301（2026-09-24）删除，本迁移清理库内残留：
-- ① 先 DROP 引用取消列的状态机 CHECK 与取消人 FK（否则收缩枚举/删列会被挡住）；
-- ② lifecycle_status 收缩为 ACTIVE/ARCHIVED 两态，cancelled_at/cancelled_by/
--    cancel_reason 三列删除（生产库存量 0 行 CANCELLED，零数据搬迁）；
-- ③ sales_order_change_log.event_type 收缩为 CREATE/UPDATE/ARCHIVE（存量 0 行 CANCEL）；
--    ck_sales_order_change_reason 直接 DROP 不重建——它只约束 CANCEL 事件，
--    去掉 CANCEL 后恒为真无意义；
-- ④ 删除 orders:cancel 权限（先清 sys_grant 兜底 fk_sys_grant_permission 的
--    ON DELETE RESTRICT，再删 sys_permission；生产库仅 1 行权限 + 2 行授权）。
-- 部署前置条件（顺序在 deploy.ts 起栈序列内：旧后端容器停止后、本迁移执行前）：
-- 对实时库 COUNT 确认 lifecycle_status='CANCELLED' 与 event_type='CANCEL' 均为 0，
-- 非零则中止部署、人工处理数据后重走流程；部署前已有当日备份留底。

-- 1. 先解依赖：取消状态机 CHECK 与取消人 FK（ck_sales_order_archive 不引用取消列，无需动）
ALTER TABLE `sales_order_table` DROP CONSTRAINT `ck_sales_order_cancel`;
ALTER TABLE `sales_order_table` DROP FOREIGN KEY `fk_sales_order_cancelled_by`;

-- 2. 收收缩生命周期枚举并删除取消三列（同条 ALTER，语句按破坏性递增排序）
ALTER TABLE `sales_order_table`
    MODIFY COLUMN `lifecycle_status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    DROP COLUMN `cancelled_at`,
    DROP COLUMN `cancelled_by`,
    DROP COLUMN `cancel_reason`;

-- 3. 变更日志：先 DROP 引用 CANCEL 的三个 CHECK（reason 去掉 CANCEL 后恒真，不重建），
--    收缩事件枚举后按两态语义重建 versions 与 request
ALTER TABLE `sales_order_change_log` DROP CONSTRAINT `ck_sales_order_change_versions`;
ALTER TABLE `sales_order_change_log` DROP CONSTRAINT `ck_sales_order_change_reason`;
ALTER TABLE `sales_order_change_log` DROP CONSTRAINT `ck_sales_order_change_request`;
ALTER TABLE `sales_order_change_log`
    MODIFY COLUMN `event_type` ENUM('CREATE', 'UPDATE', 'ARCHIVE') NOT NULL;
ALTER TABLE `sales_order_change_log`
    ADD CONSTRAINT `ck_sales_order_change_versions` CHECK (
        (event_type = 'CREATE' AND before_version IS NULL AND after_version = 1)
        OR (event_type IN ('UPDATE', 'ARCHIVE') AND before_version IS NOT NULL AND after_version = before_version + 1)
    );
ALTER TABLE `sales_order_change_log`
    ADD CONSTRAINT `ck_sales_order_change_request` CHECK (
        (request_key IS NULL OR CHAR_LENGTH(request_key) BETWEEN 8 AND 128)
        AND (event_type NOT IN ('CREATE', 'ARCHIVE') OR request_key IS NOT NULL)
    );

-- 4. 权限目录：删订单取消（先清 sys_grant 防御性兜底，预期 2 行 admin/sales 授权）
DELETE FROM `sys_grant` WHERE `permission_code` = 'orders:cancel';
DELETE FROM `sys_permission` WHERE `code` = 'orders:cancel';

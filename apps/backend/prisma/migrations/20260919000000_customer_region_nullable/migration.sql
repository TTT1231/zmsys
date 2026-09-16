-- 客户档案省市/地址放宽为可空：建档不强制填写（db-scheme.md §1.1 无值统一 NULL）。
-- CHECK 约束对 NULL 判定为 UNKNOWN 视为通过，仅拦截空串；空串由服务层归一化为 NULL。
-- 恢复自线上曾应用但未回提交的 20260914140000_customer_region_nullable（迁移链重写时遗失）。
ALTER TABLE `custom_table`
    MODIFY `province` VARCHAR(64) NULL,
    MODIFY `city` VARCHAR(64) NULL,
    MODIFY `address` VARCHAR(300) NULL;

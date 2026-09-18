import { Module } from "@nestjs/common";
import { IdempotencyService } from "./idempotency.service";

/** 幂等基础设施：Prisma/Snowflake 均为全局模块，无需显式导入 */
@Module({
    providers: [IdempotencyService],
    exports: [IdempotencyService],
})
export class IdempotencyModule {}

import { Module } from "@nestjs/common";
import { IdempotencyModule } from "../idempotency/idempotency.module";
import { IdempotencyCleanupService } from "./idempotency-cleanup.service";

/** 维护调度：幂等记录定时清理（Prisma/TransactionRunner 为全局模块，无需显式导入） */
@Module({
    imports: [IdempotencyModule],
    providers: [IdempotencyCleanupService],
})
export class MaintenanceModule {}

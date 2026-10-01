import { Module } from "@nestjs/common";
import { IdempotencyModule } from "../idempotency/idempotency.module";
import { LedgerPurgeService } from "./ledger-purge.service";

/** 台账维护：软删除物理清理（Prisma/TransactionRunner 为全局模块，无需显式导入） */
@Module({
    imports: [IdempotencyModule],
    providers: [LedgerPurgeService],
})
export class MaintenanceModule {}

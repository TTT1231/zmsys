import { Module } from "@nestjs/common";
import { IdempotencyModule } from "../idempotency/idempotency.module";
import { SequenceModule } from "../sequence/sequence.module";
import { InboundService } from "./inbound.service";
import { InboundController } from "./inbound.controller";

/** Prisma/Snowflake 为全局模块；入库登记/作废与库存调整依赖幂等与按日取号基础设施 */
@Module({
    imports: [IdempotencyModule, SequenceModule],
    providers: [InboundService],
    controllers: [InboundController],
})
export class InboundModule {}

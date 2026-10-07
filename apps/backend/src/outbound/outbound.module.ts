import { Module } from "@nestjs/common";
import { IdempotencyModule } from "../idempotency/idempotency.module";
import { SequenceModule } from "../sequence/sequence.module";
import { OutboundService } from "./outbound.service";
import { OutboundController } from "./outbound.controller";

/** Prisma/Snowflake 为全局模块；出库登记/作废/删除依赖幂等与按日取号基础设施 */
@Module({
    imports: [IdempotencyModule, SequenceModule],
    providers: [OutboundService],
    controllers: [OutboundController],
})
export class OutboundModule {}

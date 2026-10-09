import { Module } from "@nestjs/common";
import { IdempotencyModule } from "../idempotency/idempotency.module";
import { SequenceModule } from "../sequence/sequence.module";
import { OrdersService } from "./orders.service";
import { OrdersController } from "./orders.controller";

/** Prisma/Snowflake 为全局模块；订单创建依赖幂等与按日取号基础设施 */
@Module({
    imports: [IdempotencyModule, SequenceModule],
    providers: [OrdersService],
    controllers: [OrdersController],
})
export class OrdersModule {}

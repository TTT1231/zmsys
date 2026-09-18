import { Module } from "@nestjs/common";
import { IdempotencyModule } from "../idempotency/idempotency.module";
import { SequenceModule } from "../sequence/sequence.module";
import { CustomersService } from "./customers.service";
import { CustomersController } from "./customers.controller";
import { OwnerOptionsController } from "./owner-options.controller";

/** Prisma/Snowflake 为全局模块；客户创建依赖幂等与全局取号基础设施 */
@Module({
    imports: [IdempotencyModule, SequenceModule],
    providers: [CustomersService],
    controllers: [CustomersController, OwnerOptionsController],
})
export class CustomersModule {}

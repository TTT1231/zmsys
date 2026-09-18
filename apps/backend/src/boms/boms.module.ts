import { Module } from "@nestjs/common";
import { IdempotencyModule } from "../idempotency/idempotency.module";
import { SequenceModule } from "../sequence/sequence.module";
import { BomsController } from "./boms.controller";
import { BomCategoriesController } from "./bom-categories.controller";
import { BomStocksController } from "./bom-stocks.controller";
import { BomsService } from "./boms.service";

/** Prisma/Snowflake 为全局模块；BOM 建档依赖幂等与按品类取号基础设施 */
@Module({
    imports: [IdempotencyModule, SequenceModule],
    controllers: [BomsController, BomCategoriesController, BomStocksController],
    providers: [BomsService],
})
export class BomsModule {}

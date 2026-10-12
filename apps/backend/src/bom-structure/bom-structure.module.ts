import { Module } from "@nestjs/common";
import { IdempotencyModule } from "../idempotency/idempotency.module";
import { BomStructureController } from "./bom-structure.controller";
import { BomStructureService } from "./bom-structure.service";

/** Prisma/Snowflake 为全局模块；结构维护写路径依赖幂等基础设施 */
@Module({
    imports: [IdempotencyModule],
    controllers: [BomStructureController],
    providers: [BomStructureService],
})
export class BomStructureModule {}

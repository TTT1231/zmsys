import { Module } from "@nestjs/common";
import { SystemController } from "./system.controller";
import { SystemService } from "./system.service";

/** 系统备份/恢复：Prisma/Snowflake 为全局模块；维护态经 MaintenanceStateModule 全局供给 */
@Module({
    providers: [SystemService],
    controllers: [SystemController],
})
export class SystemModule {}

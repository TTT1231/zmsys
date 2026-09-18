import { Module } from "@nestjs/common";
import { AccessControlService } from "./access-control.service";

/** 访问控制共享层：auth/roles 等业务模块经此查询角色授权，避免业务模块互相依赖 */
@Module({
    providers: [AccessControlService],
    exports: [AccessControlService],
})
export class AccessControlModule {}

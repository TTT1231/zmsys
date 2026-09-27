import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import envConfig from "./configuration/index";
import { PrismaModule } from "./prisma/prisma.module";
import { SnowflakeModule } from "./common/snowflake.module";
import { AccessControlModule } from "./access-control/access-control.module";
import { IdempotencyModule } from "./idempotency/idempotency.module";
import { SequenceModule } from "./sequence/sequence.module";
import { AuthModule } from "./auth/auth.module";
import { RolesModule } from "./roles/roles.module";
import { UsersModule } from "./users/users.module";
import { CustomersModule } from "./customers/customers.module";
import { OrdersModule } from "./orders/orders.module";
import { BomsModule } from "./boms/boms.module";
import { InboundModule } from "./inbound/inbound.module";
import { OutboundModule } from "./outbound/outbound.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { HealthModule } from "./health/health.module";
import { WorkbenchModule } from "./workbench/workbench.module";
import { SystemModule } from "./system/system.module";
import { MaintenanceStateModule } from "./domain/maintenance-state";
import { SystemLogsModule } from "./system-logs/system-logs.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { MaintenanceGuard } from "./common/guards/maintenance.guard";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { WriteRegistrationInterceptor } from "./common/interceptors/write-registration.interceptor";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

@Module({
    imports: [
        // env 统一在仓库根 .env（相对本包 cwd 解析）；包内 .env 兜底（容器/独立部署）
        ConfigModule.forRoot({ load: [envConfig], isGlobal: true, envFilePath: ["../../.env", ".env"] }),
        PrismaModule,
        SnowflakeModule,
        AccessControlModule,
        IdempotencyModule,
        SequenceModule,
        AuthModule,
        RolesModule,
        UsersModule,
        CustomersModule,
        OrdersModule,
        BomsModule,
        InboundModule,
        OutboundModule,
        MaintenanceModule,
        HealthModule,
        WorkbenchModule,
        MaintenanceStateModule,
        SystemModule,
        SystemLogsModule,
    ],
    providers: [
        // 维护守卫先于认证/授权：为请求记录维护代次并拦截维护中的请求（只读白名单放行）
        { provide: APP_GUARD, useClass: MaintenanceGuard },
        // 先认证后授权：全局 JWT 守卫在前，权限码守卫在后（默认拒绝）
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        // 写登记在信封包装前：全部 guard 通过后原子登记，handler 收尾释放
        { provide: APP_INTERCEPTOR, useClass: WriteRegistrationInterceptor },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
    ],
})
export class AppModule {}

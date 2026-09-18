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
import { HealthModule } from "./health/health.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
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
        HealthModule,
    ],
    providers: [
        // 先认证后授权：全局 JWT 守卫在前，权限码守卫在后（默认拒绝）
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
    ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import envConfig from './configuration/index';
import { PrismaModule } from './prisma/prisma.module';
import { SnowflakeModule } from './common/snowflake.module';
import { AccessControlModule } from './access-control/access-control.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { SequenceModule } from './sequence/sequence.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
    imports: [
        ConfigModule.forRoot({ load: [envConfig], isGlobal: true }),
        PrismaModule,
        SnowflakeModule,
        AccessControlModule,
        IdempotencyModule,
        SequenceModule,
        AuthModule,
        RolesModule,
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

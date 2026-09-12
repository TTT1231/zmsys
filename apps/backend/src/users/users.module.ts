import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

/** Prisma/Snowflake 为全局模块；新增用户 POST 依赖幂等基础设施 */
@Module({
    imports: [IdempotencyModule],
    providers: [UsersService],
    controllers: [UsersController],
})
export class UsersModule {}

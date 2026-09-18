import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SnowflakeGenerator } from "./snowflake";
import type { AppConfig } from "../configuration";

/** 业务主键生成器全局单例：workerId 统一来自 AppConfig，禁止旁路直读环境变量 */
@Global()
@Module({
    providers: [
        {
            provide: SnowflakeGenerator,
            useFactory: (config: ConfigService<AppConfig>) =>
                new SnowflakeGenerator(BigInt(config.getOrThrow("snowflake.workerId", { infer: true }))),
            inject: [ConfigService],
        },
    ],
    exports: [SnowflakeGenerator],
})
export class SnowflakeModule {}

import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";
import { createMariadbPool } from "./create-pool";
import { prismaExtensions } from "./prisma-extensions";
import type { AppConfig } from "../configuration";

/**
 * 连接池由本服务持有；UTC 时区约定见 create-pool.ts。
 * DI 容器实际注入的是 $extends 后的扩展实例（软删过滤 + updatedAt 统一注入，
 * 见 prisma-extensions.ts）：扩展返回新 client 对象替换构造产物，业务代码与
 * $transaction 事务内的 tx 均走扩展；Nest 生命周期钩子补绑到扩展对象上，
 * 保证 $connect 与 mariadb 池回收仍被调用。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly pool: ReturnType<typeof createMariadbPool>;

    constructor(configService: ConfigService<AppConfig>) {
        const pool = createMariadbPool({
            host: configService.getOrThrow("database.host", { infer: true }),
            port: configService.getOrThrow("database.port", { infer: true }),
            user: configService.getOrThrow("database.user", { infer: true }),
            password: configService.getOrThrow("database.password", { infer: true }),
            name: configService.getOrThrow("database.name", { infer: true }),
            connectionLimit: 5,
        });
        super({ adapter: new PrismaMariaDb(pool) });
        this.pool = pool;
        const extended = this.$extends(prismaExtensions) as unknown as PrismaService & {
            onModuleInit: () => Promise<void>;
            onModuleDestroy: () => Promise<void>;
        };
        extended.onModuleInit = async (): Promise<void> => {
            await this.$connect();
        };
        extended.onModuleDestroy = async (): Promise<void> => {
            await this.$disconnect();
            await this.pool.end();
        };
        return extended;
    }

    async onModuleInit(): Promise<void> {
        await this.$connect();
    }

    /** $disconnect 只收 Prisma 侧；外置 mariadb 池必须显式 end，否则进程无法退出 */
    async onModuleDestroy(): Promise<void> {
        await this.$disconnect();
        await this.pool.end();
    }
}

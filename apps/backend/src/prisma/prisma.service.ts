import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";
import { createMariadbPool } from "./create-pool";
import type { AppConfig } from "../configuration";

/** 连接池由本服务持有；UTC 时区约定见 create-pool.ts */
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

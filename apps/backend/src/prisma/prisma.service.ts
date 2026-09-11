import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mariadb from 'mariadb';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client';
import type { AppConfig } from '../configuration';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    constructor(configService: ConfigService<AppConfig>) {
        const pool = mariadb.createPool({
            host: configService.getOrThrow('database.host', { infer: true }),
            port: configService.getOrThrow('database.port', { infer: true }),
            user: configService.getOrThrow('database.user', { infer: true }),
            password: configService.getOrThrow('database.password', { infer: true }),
            database: configService.getOrThrow('database.name', { infer: true }),
            connectionLimit: 5,
        });
        super({ adapter: new PrismaMariaDb(pool) });
    }

    async onModuleInit(): Promise<void> {
        await this.$connect();
    }

    async onModuleDestroy(): Promise<void> {
        await this.$disconnect();
    }
}

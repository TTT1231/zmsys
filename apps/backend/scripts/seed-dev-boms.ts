/**
 * dev 库 BOM 联调种子：把前端 mock 的 BOM 档案（admin-manage/mocks/data/db.ts
 * 导出的 bom-seed.json）导入 dev 库 bom_table，使订单创建（POST /orders）在
 * 前后端联调时能引用真实存在的 bomCode。BOM 业务模块上线后此脚本自然退役。
 *
 * 用法：先在前端仓库跑 `node scripts/export-bom-seed.mjs` 生成 bom-seed.json，
 * 再在本仓库跑 `pnpm tsx scripts/seed-dev-boms.ts [json路径]`（默认 ../admin-manage/bom-seed.json）。
 * 幂等：按 bom_code 唯一键跳过已存在行，可重复执行。
 */
import 'dotenv/config';
import '../src/process-tz';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client';
import { createMariadbPool } from '../src/prisma/create-pool';
import { specHash } from '../src/common/bom-spec';
import { SnowflakeGenerator } from '../src/common/snowflake';

interface SeedBom {
    code: string;
    name: string;
    modelCode: string;
    specs: Record<string, string>;
    unit: string;
}

const main = async (): Promise<void> => {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('联调种子脚本不允许在 production 运行');
    }
    const database = process.env.DB_DATABASE ?? 'zmdb';
    if (database.endsWith('_test')) {
        throw new Error(`拒绝写入测试库 ${database}（测试数据由 e2e 自建，勿用演示种子污染）`);
    }

    const seedPath = resolve(process.argv[2] ?? '../admin-manage/bom-seed.json');
    const seed: SeedBom[] = JSON.parse(readFileSync(seedPath, 'utf8'));
    if (!Array.isArray(seed) || seed.length === 0) {
        throw new Error(`种子文件为空：${seedPath}`);
    }

    const pool = createMariadbPool({
        host: process.env.DB_HOST ?? 'localhost',
        port: Number.parseInt(process.env.DB_PORT ?? '3306', 10) || 3306,
        user: process.env.DB_USERNAME ?? 'root',
        password: process.env.DB_PASSWORD ?? '',
        name: database,
        connectionLimit: 2,
    });
    const prisma = new PrismaClient({ adapter: new PrismaMariaDb(pool) });

    try {
        const categories = await prisma.bomCategory.findMany();
        const categoryByName = new Map(categories.map(category => [category.name, category]));
        const operator = await prisma.sysUser.findFirst({ where: { roleCode: 'super' }, orderBy: { id: 'asc' } });
        if (!operator) {
            throw new Error('缺少超级管理员账号，请先运行 pnpm prisma:seed');
        }
        const missing = [...new Set(seed.map(row => row.name))].filter(name => !categoryByName.has(name));
        if (missing.length > 0) {
            throw new Error(`种子引用了库中不存在的品类：${missing.join('、')}`);
        }

        const now = new Date();
        const snowflake = new SnowflakeGenerator(1n);
        let imported = 0;
        const CHUNK = 500;
        for (let start = 0; start < seed.length; start += CHUNK) {
            const chunk = seed.slice(start, start + CHUNK);
            const result = await prisma.bomTable.createMany({
                data: chunk.map(row => ({
                    id: snowflake.next(),
                    bomCode: row.code,
                    categoryId: categoryByName.get(row.name)!.id,
                    modelCode: row.modelCode,
                    spec: row.specs,
                    specHash: specHash(row.specs),
                    unit: row.unit || '个',
                    requestKey: `devseed-${row.code}`,
                    createdBy: operator.id,
                    updatedBy: operator.id,
                    createdAt: now,
                })),
                skipDuplicates: true,
            });
            imported += result.count;
        }
        const total = await prisma.bomTable.count();
        console.log(`BOM 联调种子完成：本次新导入 ${imported} 行（含跳过），bom_table 现有 ${total} 行`);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
};

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

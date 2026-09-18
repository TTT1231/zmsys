/**
 * 初始化种子：创建内置超级管理员与冒烟测试账号。
 * 角色目录、权限目录与四个普通角色的默认授权由迁移 SQL 播种（BOOTSTRAP 来源）。
 * id 1–9999 保留给固定参考数据；正式用户管理上线后新用户改用 Snowflake 主键。
 */
import "dotenv/config";
import "../src/process-tz";
import bcrypt from "bcryptjs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { createMariadbPool } from "../src/prisma/create-pool";

const SEED_USERS = [
    { id: 1n, account: "guojun", name: "郭均", roleCode: "super" },
    { id: 2n, account: "test", name: "测试员工", roleCode: "staff" },
] as const;

if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_DEFAULT_PASSWORD !== "1") {
    throw new Error(
        "生产环境 seed 使用契约默认初始密码 123456 需显式确认：设置 SEED_ALLOW_DEFAULT_PASSWORD=1 并在初始化后立即要求改密",
    );
}

async function main(): Promise<void> {
    // 与 PrismaService 共用同一 pool 工厂：保证 seed 写入同样遵守 UTC 会话时区约定
    const pool = createMariadbPool({
        host: process.env.DB_HOST ?? "localhost",
        port: Number.parseInt(process.env.DB_PORT ?? "3306", 10) || 3306,
        user: process.env.DB_USERNAME ?? "root",
        password: process.env.DB_PASSWORD ?? "",
        name: process.env.DB_DATABASE ?? "zmdb",
        connectionLimit: 2,
    });
    const prisma = new PrismaClient({ adapter: new PrismaMariaDb(pool) });

    try {
        // 初始密码 123456，数据库只保存强哈希（db-scheme.md §0.6）
        const passwordHash = bcrypt.hashSync("123456", 10);
        for (const seed of SEED_USERS) {
            const existing = await prisma.sysUser.findUnique({ where: { account: seed.account } });
            if (existing) {
                console.log(`跳过已存在账号 ${seed.account}`);
                continue;
            }
            // 用户与变更日志同事务：失败可整体重跑；时间戳由应用写入（服务器时间函数不可信，见 schema.prisma 头注）
            const now = new Date();
            await prisma.$transaction([
                prisma.sysUser.create({ data: { ...seed, passwordHash, createdAt: now } }),
                prisma.sysUserChangeLog.create({
                    data: {
                        id: seed.id * 1000n,
                        userId: seed.id,
                        operatorId: seed.id,
                        eventType: "CREATE",
                        afterVersion: 1n,
                        createdAt: now,
                        reason: "系统初始化",
                        afterJson: { account: seed.account, name: seed.name, role: seed.roleCode, status: true },
                    },
                }),
            ]);
            console.log(`已创建账号 ${seed.account}（${seed.name}，角色 ${seed.roleCode}）`);
        }
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

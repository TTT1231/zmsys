/**
 * 全局查询中间件（Prisma client extension，随 PrismaService 构造注入）：
 *
 * updated_at 统一赋值（Node 时钟）：schema 不再标 @updatedAt（同一列的刷新
 * 语义曾自动/显式/压制三派并存，"非业务触碰"的压制技巧只活在注释里）。
 * 现在唯一规则：update/updateMany/upsert 未显式传 updatedAt 时由本扩展注入
 * `new Date()`，显式传值（如登录回写旧值压制刷新）原样尊重。注入取 Node
 * 时钟而非依赖列的 ON UPDATE CURRENT_TIMESTAMP——服务器会话时区不可信
 * （见 schema.prisma 头注释），与 created_at 应用层显式写入同一约定。
 *
 * $queryRaw/$executeRaw 不经本扩展（各 raw SQL 自带显式条件）；嵌套关系读写
 * 不受 $allOperations 拦截（本项目无嵌套写路径，见引入时的排查记录）。
 */

import { Prisma } from "../generated/prisma/client";

/** updatedAt 注入适用的写操作（upsert 仅 update 分支需要） */
const DATA_OPERATIONS = new Set(["update", "updateMany", "upsert"]);

/** 无 updated_at 列的模型：注入会让 Prisma 拒绝整个写操作（Unknown argument）。
 *  目前只有权限目录表（仅保护开关一个写路径，目录行不需要"最近修改时间"语义） */
const NO_UPDATED_AT_MODELS = new Set(["SysPermission"]);

/** updatedAt 注入：未显式传值时补 new Date()（Node 时钟，见文件头注释） */
export function applyUpdatedAt(args: { data?: unknown }, operation: string): void {
    const now = new Date();
    if (operation === "upsert") {
        const data = args.data as { update?: { updatedAt?: unknown } } | undefined;
        if (data?.update && data.update.updatedAt === undefined) {
            data.update.updatedAt = now;
        }
        return;
    }
    const data = args.data as { updatedAt?: unknown } | undefined;
    if (data && data.updatedAt === undefined) {
        data.updatedAt = now;
    }
}

export const prismaExtensions = Prisma.defineExtension({
    name: "updatedAt",
    query: {
        $allModels: {
            async $allOperations({ model, operation, args, query }) {
                if (model !== undefined && DATA_OPERATIONS.has(operation) && !NO_UPDATED_AT_MODELS.has(model)) {
                    applyUpdatedAt(args as { data?: unknown }, operation);
                }
                return query(args);
            },
        },
    },
});

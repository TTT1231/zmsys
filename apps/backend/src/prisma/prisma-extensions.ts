/**
 * 全局查询中间件（Prisma client extension，随 PrismaService 构造注入）：
 *
 * ① 软删除过滤（db-scheme.md §7.1）：sales_order_table / inbound_ledger /
 *  outbound_shipment 三表的带 where 查询与 update/delete 统一注入
 *  `deleted_at IS NULL`，漏写一处即"复活"已删行的风险从根上消除。
 *  豁免约定：where 显式携带 deletedAt 条件（如物理清理任务的 `deletedAt: { not: null }`）
 *  即完全尊重调用方。须看到已删行的 FK 口径校验走 $queryRaw（不经本扩展）——
 *  注意 Prisma 会在到达扩展前剥离 undefined 值字段，显式 `deletedAt: undefined`
 *  无法作为豁免信号。
 *
 * ② updated_at 统一赋值（Node 时钟）：schema 不再标 @updatedAt（同一列的刷新
 *  语义曾自动/显式/压制三派并存，"非业务触碰"的压制技巧只活在注释里）。
 *  现在唯一规则：update/updateMany/upsert 未显式传 updatedAt 时由本扩展注入
 *  `new Date()`，显式传值（如登录回写旧值压制刷新）原样尊重。注入取 Node
 *  时钟而非依赖列的 ON UPDATE CURRENT_TIMESTAMP——服务器会话时区不可信
 *  （见 schema.prisma 头注释），与 created_at 应用层显式写入同一约定。
 *
 * $queryRaw/$executeRaw 不经本扩展（各 raw SQL 自带显式条件）；嵌套关系读写
 * 不受 $allOperations 拦截（本项目无嵌套写路径，见引入时的排查记录）。
 */

import { Prisma } from "../generated/prisma/client";

/** 带软删列的模型（Prisma 模型名） */
const SOFT_DELETE_MODELS = new Set(["SalesOrderTable", "InboundLedger", "OutboundShipment"]);

/** 软删注入适用的带 where 操作（create/connect 等无 where 操作不拦） */
const WHERE_OPERATIONS = new Set([
    "findUnique",
    "findUniqueOrThrow",
    "findFirst",
    "findFirstOrThrow",
    "findMany",
    "count",
    "aggregate",
    "groupBy",
    "update",
    "updateMany",
    "delete",
    "deleteMany",
]);

/** updatedAt 注入适用的写操作（upsert 仅 update 分支需要） */
const DATA_OPERATIONS = new Set(["update", "updateMany", "upsert"]);

/** 软删注入：where 未显式声明 deletedAt 条件时补过滤；
 *  无 where 的全表操作（findMany/count/updateMany 等）同样补上，漏写即防"复活" */
export function applySoftDeleteFilter(args: { where?: unknown }): void {
    const where = args.where;
    if (!where || typeof where !== "object") {
        if (where === undefined) {
            (args as { where?: unknown }).where = { deletedAt: null };
        }
        return;
    }
    if (Object.prototype.hasOwnProperty.call(where, "deletedAt")) {
        return;
    }
    (where as Record<string, unknown>).deletedAt = null;
}

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
    name: "softDeleteAndUpdatedAt",
    query: {
        $allModels: {
            async $allOperations({ model, operation, args, query }) {
                if (model !== undefined) {
                    if (SOFT_DELETE_MODELS.has(model) && WHERE_OPERATIONS.has(operation)) {
                        applySoftDeleteFilter(args as { where?: unknown });
                    }
                    if (DATA_OPERATIONS.has(operation)) {
                        applyUpdatedAt(args as { data?: unknown }, operation);
                    }
                }
                return query(args);
            },
        },
    },
});

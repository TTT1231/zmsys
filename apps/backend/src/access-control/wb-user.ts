import type { Prisma, SysUser } from "../generated/prisma/client";
import type { UserChangeEventType } from "../generated/prisma/enums";
import { formatBeijingStamp } from "../common/datetime";
import type { SnowflakeGenerator } from "../common/snowflake";
import type { Tx } from "../prisma/transaction.runner";
import type { WbUser } from "./types";

/** 日志与响应快照统一形态：绝不包含密码哈希（数据库 CHECK 兜底） */
export function userSnapshot(user: SysUser): Prisma.InputJsonValue {
    return {
        account: user.account,
        name: user.name,
        role: user.roleCode,
        status: user.status,
    };
}

/**
 * sys_user_change_log 写入（users 与 auth 共用）：字段口径在此收口，
 * 各端点只声明事件类型与文案，不再手抄同构 create。
 */
export async function writeUserChangeLog(
    tx: Tx,
    snowflake: SnowflakeGenerator,
    entry: {
        userId: bigint;
        operatorId: bigint;
        eventType: UserChangeEventType;
        reason: string;
        now: Date;
        beforeVersion?: bigint;
        afterVersion: bigint;
        beforeJson?: Prisma.InputJsonValue;
        afterJson: Prisma.InputJsonValue;
    },
): Promise<void> {
    await tx.sysUserChangeLog.create({
        data: {
            id: snowflake.next(),
            userId: entry.userId,
            operatorId: entry.operatorId,
            eventType: entry.eventType,
            createdAt: entry.now,
            beforeVersion: entry.beforeVersion,
            afterVersion: entry.afterVersion,
            reason: entry.reason,
            beforeJson: entry.beforeJson,
            afterJson: entry.afterJson,
        },
    });
}

/** sys_user → openapi WbUser；last 为最近登录展示值，从未登录为破折号。
 * 只依赖映射所需列：列表查询可显式 select（passwordHash 不入内存），整行 SysUser 天然满足 */
export function toWbUser(
    user: Pick<
        SysUser,
        "rowVersion" | "name" | "account" | "roleCode" | "status" | "lastLoginAt" | "createdAt" | "updatedAt"
    >,
    lastLoginAt: Date | null = user.lastLoginAt,
): WbUser {
    return {
        version: Number(user.rowVersion),
        name: user.name,
        account: user.account,
        role: user.roleCode as WbUser["role"],
        active: user.status,
        last: formatBeijingStamp(lastLoginAt),
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
    };
}

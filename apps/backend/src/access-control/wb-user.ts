import type { Prisma, SysUser } from "../generated/prisma/client";
import { formatBeijingStamp } from "../common/datetime";
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

/** sys_user → openapi WbUser；last 为最近登录展示值，从未登录为破折号 */
export function toWbUser(user: SysUser, lastLoginAt: Date | null = user.lastLoginAt): WbUser {
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

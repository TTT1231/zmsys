import { Prisma } from "../generated/prisma/client";
import type { SnowflakeGenerator } from "../common/snowflake";
import type { AuthUser } from "../common/types/auth-user";
import type { Tx } from "../prisma/transaction.runner";
import type { OpLogDetailOf } from "./snapshots";

/**
 * op_log 同事务审计（db-scheme.md §7）：覆盖审计清单——订单创建/删除、客户创建/更新、
 * BOM 创建/删除、出入库创建/作废/删除、发货、归档；与业务行同事务提交；快照保存操作时的
 * 姓名与角色（用户改名/改角色后历史展示不变）。update_customer 允许同目标多条
 * （普通索引 idx(action, target_id)），重复记录由幂等层防重放兜底。
 */

export type OpLogAction =
    | "ship"
    | "create_customer"
    | "create_order"
    | "delete_bom"
    | "delete_order"
    | "archive_order"
    | "create_inbound"
    | "void_inbound"
    | "delete_inbound"
    | "void_outbound"
    | "delete_outbound"
    | "create_bom"
    | "update_customer"
    | "db_backup"
    | "db_restore";

/** 进入系统日志业务时间线的动作（db_backup/db_restore 为系统审计，不进时间线）；
 *  新增 OpLogAction 后必须显式归类：登记到 system-logs 的域映射（加入本别名）
 *  或明确留作审计动作——两侧编译期都会强制这一决策 */
export type TimelineOpLogAction = Exclude<OpLogAction, "db_backup" | "db_restore">;

export interface RecordOpLogParams<A extends OpLogAction = OpLogAction> {
    action: A;
    targetType: string;
    targetId: bigint;
    targetCode: string;
    /** detail 形态按动作收窄（domain/snapshots.ts 的契约）；未登记动作为宽松 JSON */
    detail: A extends keyof OpLogDetailOf ? OpLogDetailOf[A] : Prisma.InputJsonValue;
    /** 事务内统一时刻（与业务行 created_at 同源） */
    now: Date;
}

export async function recordOpLog<A extends OpLogAction>(
    tx: Tx,
    snowflake: SnowflakeGenerator,
    operator: Pick<AuthUser, "id" | "name" | "role">,
    params: RecordOpLogParams<A>,
): Promise<void> {
    await tx.opLog.create({
        data: {
            id: snowflake.next(),
            operatorId: BigInt(operator.id),
            operatorNameSnapshot: operator.name,
            operatorRoleSnapshot: operator.role,
            action: params.action,
            targetType: params.targetType,
            targetId: params.targetId,
            targetCode: params.targetCode,
            detailJson: params.detail as Prisma.InputJsonValue,
            createdAt: params.now,
        },
    });
}

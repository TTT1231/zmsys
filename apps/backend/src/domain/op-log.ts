import { Prisma } from "../generated/prisma/client";
import type { SnowflakeGenerator } from "../common/snowflake";
import type { AuthUser } from "../common/types/auth-user";
import type { Tx } from "../prisma/transaction.runner";

/**
 * op_log 同事务审计（db-scheme.md §7）：至少覆盖登记发货、新建客户、新建订单，
 * 与业务行同事务提交；快照保存操作时的姓名与角色（用户改名/改角色后历史展示不变）。
 * uk(action, target_id) 保证一个目标每个动作只记一次——重放/重试路径撞唯一键静默跳过。
 */

export type OpLogAction = "ship" | "create_customer" | "create_order" | "delete_bom" | "delete_order" | "archive_order";

export interface RecordOpLogParams {
    action: OpLogAction;
    targetType: string;
    targetId: bigint;
    targetCode: string;
    detail: Prisma.InputJsonValue;
    /** 事务内统一时刻（与业务行 created_at 同源） */
    now: Date;
}

export async function recordOpLog(
    tx: Tx,
    snowflake: SnowflakeGenerator,
    operator: Pick<AuthUser, "id" | "name" | "role">,
    params: RecordOpLogParams,
): Promise<void> {
    try {
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
                detailJson: params.detail,
                createdAt: params.now,
            },
        });
    } catch (error) {
        // uk(action, target_id)：该目标该动作已记录（重试/幂等重放路径），静默跳过
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return;
        }
        throw error;
    }
}

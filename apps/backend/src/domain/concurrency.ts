import { ConflictException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import type { Tx } from "../prisma/transaction.runner";

/**
 * 行锁与乐观锁助手（db-scheme.md §2）：所有多行锁流程按固定顺序取锁，
 * id 升序去重后 FOR UPDATE；乐观锁版本比对不一致或更新 0 行受影响即 409。
 */

/** 允许行锁的业务表（raw SQL 表名无法参数化，封闭白名单防注入） */
const LOCKABLE_TABLES = [
    "sys_user",
    "sys_role",
    "custom_table",
    "bom_table",
    "sales_order_table",
    "inbound_ledger",
    "outbound_shipment",
    "stock_adjustment",
] as const;

export type LockableTable = (typeof LOCKABLE_TABLES)[number];

/** 各表可按自然键定位锁的唯一业务键列（封闭白名单防注入，与 LOCKABLE_TABLES 对应子集） */
const LOCKABLE_KEY_COLUMNS = {
    sys_user: "account",
    sys_role: "code",
    custom_table: "customer_code",
    bom_table: "bom_code",
    sales_order_table: "order_no",
    inbound_ledger: "entry_no",
    outbound_shipment: "shipment_no",
} as const;

export type LockableKeyTable = keyof typeof LOCKABLE_KEY_COLUMNS;

/**
 * 固定顺序行锁：id 升序去重后 `SELECT id ... FOR UPDATE`（db-scheme.md §2
 * 「BOM → 订单 → 流水」「用户 id 升序」等固定锁序，降低死锁）。
 * 空列表直接返回；必须在 TransactionRunner 事务回调内调用。
 */
export async function lockRowsById(tx: Tx, table: LockableTable, ids: readonly bigint[]): Promise<void> {
    const ordered = [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (ordered.length === 0) {
        return;
    }
    await tx.$queryRaw`SELECT id FROM ${Prisma.raw(table)} WHERE id IN (${Prisma.join(ordered)}) FOR UPDATE`;
}

/**
 * 自然键定位锁：`SELECT id ... WHERE <唯一键列> = ? FOR UPDATE`。表名与列名取自
 * 封闭白名单，值随 Prisma 参数化；不存在时锁定读结果为空，存在性由调用方
 * 锁后重读并抛 404。必须在 TransactionRunner 事务回调内调用。
 */
export async function lockRowByKey(tx: Tx, table: LockableKeyTable, value: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM ${Prisma.raw(table)} WHERE ${Prisma.raw(LOCKABLE_KEY_COLUMNS[table])} = ${value} FOR UPDATE`;
}

/**
 * 乐观锁版本比对（锁行后读到的 rowVersion/grantVersion 与 DTO 期望值）：
 * 不一致即 409 让客户端刷新后重试；BigInt 转换收口在此，调用点只传文案。
 */
export function assertVersionMatches(current: bigint, expected: number, message: string): void {
    if (current !== BigInt(expected)) {
        throw new ConflictException(message);
    }
}

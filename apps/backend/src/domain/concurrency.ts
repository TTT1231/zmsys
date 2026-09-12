import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { Tx } from '../prisma/transaction.runner';

/**
 * 行锁与乐观锁助手（db-scheme.md §2）：所有多行锁流程按固定顺序取锁，
 * id 升序去重后 FOR UPDATE；乐观锁更新 0 行受影响即 409。
 */

/** 允许按 id 行锁的业务表（raw SQL 表名无法参数化，封闭白名单防注入） */
const LOCKABLE_TABLES = [
    'sys_user',
    'custom_table',
    'bom_table',
    'sales_order_table',
    'inbound_ledger',
    'outbound_shipment',
    'stock_adjustment',
] as const;

export type LockableTable = (typeof LOCKABLE_TABLES)[number];

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
 * 乐观锁结果检查：`WHERE id=? AND row_version=?` 的 updateMany 受影响 0 行
 * 说明版本已被并发修改（或行不存在），一律 409 让客户端刷新后重试。
 */
export function ensureUpdated(count: number, message = '数据已被他人修改，请刷新后重试'): void {
    if (count === 0) {
        throw new ConflictException(message);
    }
}

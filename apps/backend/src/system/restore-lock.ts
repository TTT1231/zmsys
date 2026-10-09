import { createHash } from "node:crypto";
import type mariadb from "mariadb";

/**
 * 数据库专属恢复锁名（db-scheme.md §10.3）：锁名含库名摘要、总长 ≤64 字符。
 * 应用内（SystemService）与 CLI（restore-cli / restore-database --local）共用，
 * 保证两条通道互斥、启动门禁可判定旧恢复会话是否结束。
 */
export const restoreLockName = (database: string): string => {
    const digest = createHash("sha256").update(database).digest("hex").slice(0, 24);
    return `zmsys-restore-${digest}`;
};

/**
 * 在专用连接上取得恢复锁（GET_LOCK）：两条互斥通道共用的唯一实现，
 * 行为变化（超时语义、返回形态）只需改这里。
 */
export async function acquireRestoreLock(
    connection: mariadb.Connection,
    lockName: string,
    waitSeconds: number,
): Promise<boolean> {
    const rows = (await connection.query("SELECT GET_LOCK(?, ?) AS locked", [lockName, waitSeconds])) as Array<{
        locked: number | bigint | null;
    }>;
    // prepared 路径下 GET_LOCK 标量可能返回 BigInt：统一数值化后再比较
    return Number(rows[0]?.locked) === 1;
}

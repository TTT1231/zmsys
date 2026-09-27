import { createHash } from "node:crypto";

/**
 * 数据库专属恢复锁名（实施计划 §4）：锁名含库名摘要、总长 ≤64 字符。
 * 应用内（SystemService）与 CLI（restore-cli / restore-database --local）共用，
 * 保证两条通道互斥、启动门禁可判定旧恢复会话是否结束。
 */
export const restoreLockName = (database: string): string => {
    const digest = createHash("sha256").update(database).digest("hex").slice(0, 24);
    return `zmsys-restore-${digest}`;
};

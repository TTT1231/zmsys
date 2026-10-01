/** MariaDB 驱动层的死锁 / 锁等待超时判定（errno 1213/1205 或语义 code）。
 * 事务重试器与全局异常过滤器共用同一口径：一处扩充，两处同步生效。 */
export const isDriverLockConflict = (error: unknown): boolean => {
    if (typeof error !== "object" || error === null) {
        return false;
    }
    const candidate = error as { errno?: unknown; code?: unknown };
    return (
        candidate.errno === 1213 ||
        candidate.errno === 1205 ||
        candidate.code === "ER_LOCK_DEADLOCK" ||
        candidate.code === "ER_LOCK_WAIT_TIMEOUT"
    );
};

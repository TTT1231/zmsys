/**
 * mariadb 专用一次性连接 → 备份/恢复引擎执行器适配。
 * 服务层（SystemService）与 CLI 薄入口（backup-cli/restore-cli）共用同一份，
 * 保证 queryStream 的事件流→异步迭代器语义只有一处实现。
 */
import type mariadb from "mariadb";
import type { SqlStreamingExecutor } from "./backup-writer";

/** mariadb 专用连接 → 引擎执行器适配（一次性，不入池） */
export class MariaDbExecutor implements SqlStreamingExecutor {
    constructor(private readonly connection: mariadb.Connection) {}

    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T> {
        if (params === undefined || params.length === 0) {
            return (await this.connection.query(sql)) as T;
        }
        return (await this.connection.query(sql, params)) as T;
    }

    queryStream<T = Record<string, unknown>>(sql: string): AsyncIterable<T> {
        return streamQueryRows<T>(this.connection, sql);
    }
}

/** mariadb queryStream（事件流）→ 异步迭代器 */
export async function* streamQueryRows<T>(connection: mariadb.Connection, sql: string): AsyncGenerator<T> {
    const stream = connection.queryStream(sql) as unknown as {
        on(event: string, listener: (...args: never[]) => void): void;
        destroy?(): void;
    };
    const pending: T[] = [];
    let ended = false;
    let failure: unknown;
    let wake: (() => void) | undefined;
    stream.on("data", (row: never) => {
        pending.push(row as T);
        wake?.();
    });
    stream.on("end", () => {
        ended = true;
        wake?.();
    });
    stream.on("error", (error: unknown) => {
        failure = error;
        wake?.();
    });
    try {
        for (;;) {
            if (pending.length > 0) {
                yield pending.shift()!;
                continue;
            }
            if (failure !== undefined) {
                throw failure;
            }
            if (ended) {
                return;
            }
            await new Promise<void>(resolve => {
                wake = resolve;
            });
            wake = undefined;
        }
    } finally {
        stream.destroy?.();
    }
}

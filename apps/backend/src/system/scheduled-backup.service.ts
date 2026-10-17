/**
 * 定时备份服务（db-scheme.md §10.5）：每日北京时间 0 点在 backend 容器内
 * 全量备份落盘到 BACKUP_DIR，并按保留天数清理过期文件。
 *
 * - 调度口径：进程时区被 process-tz.ts 锁为 UTC，北京时间 0 点 = UTC 16:00
 *   （北京无夏令时，固定 +8）。不引入 @nestjs/schedule，沿用裸计时器 +
 *   test 环境跳过的仓库惯例（同 IdempotencyCleanupService）；链式 setTimeout
 *   对齐墙钟（每日 UTC 16:00），不用 setInterval（24h 间隔会随启动时刻漂移）；
 * - 与网页「备份」同一引擎（zmsys-backup v1 全量 gzip）；文件名日期戳用
 *   北京日期（平移 +8 后走引擎本地取值，进程本地即 UTC），恢复侧不受影响；
 * - 只读一致性快照：不取恢复锁、不写 op_log（自动化运维通道，同 backup-cli
 *   口径）；维护态激活时跳过本轮（避免备份到恢复中的库），下个周期再试；
 * - 原子落盘：先写 .part 再 rename；失败删除半成品；崩溃遗留的 .part 随
 *   保留期一并清理（文件名同口径带日期戳）。
 */
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type mariadb from "mariadb";
import type { AppConfig } from "../configuration";
import { MaintenanceState } from "../domain/maintenance-state";
import { createBackupConnection } from "../prisma/create-pool";
import { ALL_GROUP_KEYS } from "./backup.catalog";
import { backupFileName, createBackupStream } from "./engine/backup-writer";
import { MariaDbExecutor } from "./engine/mariadb-executor";

/** 北京 0 点的 UTC 小时（进程 TZ 锁 UTC；北京 = UTC+8 固定无夏令时） */
const SCHEDULE_UTC_HOUR = 16;
/** 北京时区平移量：仅用于文件名日期戳（调度本身按 UTC 墙钟对齐） */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 引擎口径文件名尾部的日期戳（含崩溃遗留的 .part）：-YYYYMMDD-HHMMSS.sql[.gz][.part] */
const STAMP_PATTERN = /-(\d{4})(\d{2})(\d{2})-\d{6}\.sql(\.gz)?(\.part)?$/;

/**
 * 下一次定时备份时刻：每日 UTC 16:00（北京 0 点）。整点已过则顺延一天；
 * 返回值只用于排程延迟计算，不参与文件命名。
 */
export function nextScheduledRunAt(now: Date = new Date()): Date {
    const next = new Date(now);
    next.setUTCHours(SCHEDULE_UTC_HOUR, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
        next.setUTCDate(next.getUTCDate() + 1);
    }
    return next;
}

/** 解析文件名日期戳（北京日期语义）；非引擎口径或日期非法返回 null */
export function backupFileStamp(fileName: string): Date | null {
    const match = STAMP_PATTERN.exec(fileName);
    if (match === null) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const stamp = new Date(Date.UTC(year, month - 1, day));
    // 20260231 一类非法日期会被 Date 进位，回读比对兜底
    return stamp.getUTCMonth() === month - 1 && stamp.getUTCDate() === day ? stamp : null;
}

/** 保留期判定：距日期戳已满 retentionDays 天即过期；非引擎口径文件永不判过期（防误删） */
export function isExpiredBackup(fileName: string, now: Date, retentionDays: number): boolean {
    const stamp = backupFileStamp(fileName);
    if (stamp === null) return false;
    return now.getTime() - stamp.getTime() >= retentionDays * DAY_MS;
}

@Injectable()
export class ScheduledBackupService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(ScheduledBackupService.name);
    private timer: NodeJS.Timeout | null = null;
    private running = false;

    constructor(
        private readonly config: ConfigService<AppConfig>,
        private readonly maintenance: MaintenanceState,
    ) {}

    onApplicationBootstrap(): void {
        // 测试进程跳过调度（与 IdempotencyCleanupService 同一口径，不直读 process.env）
        if (this.config.getOrThrow("nodeEnv", { infer: true }) === "test") {
            return;
        }
        this.scheduleNext();
    }

    onApplicationShutdown(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /** 排程下一轮：到点执行后无论成败重新排程（单计时器，不重叠） */
    private scheduleNext(): void {
        const at = nextScheduledRunAt();
        this.timer = setTimeout(
            () => {
                this.timer = null;
                void this.runScheduled();
            },
            Math.max(at.getTime() - Date.now(), 0),
        );
        const beijing = new Date(at.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
        this.logger.log(`下次定时备份：${at.toISOString()}（北京时间 ${beijing}）`);
    }

    /** 定时入口：维护态跳过本轮；执行错误记录后照常排程下一轮 */
    private async runScheduled(): Promise<void> {
        if (this.maintenance.isActive()) {
            this.logger.warn("维护态激活，跳过本轮定时备份（下个调度周期再试）");
        } else {
            try {
                await this.runOnce();
            } catch (error) {
                this.logger.error(`定时备份失败（下个调度周期重试）：${String(error)}`);
            }
        }
        this.scheduleNext();
    }

    /** 单轮执行：全量 gzip 备份原子落盘 + 保留期清理；running 防手动/调度重叠 */
    async runOnce(): Promise<{ fileName: string; size: number; removed: number }> {
        if (this.running) {
            throw new Error("上一轮定时备份尚未结束");
        }
        this.running = true;
        const dir = this.config.getOrThrow("backup.dir", { infer: true });
        const database = this.config.getOrThrow("database.name", { infer: true });
        let connection: mariadb.Connection | null = null;
        try {
            await mkdir(dir, { recursive: true });
            connection = await createBackupConnection({
                host: this.config.getOrThrow("database.host", { infer: true }),
                port: this.config.getOrThrow("database.port", { infer: true }),
                user: this.config.getOrThrow("database.user", { infer: true }),
                password: this.config.getOrThrow("database.password", { infer: true }),
                name: database,
            });
            // 日期戳用北京日期：平移 +8 后引擎按进程本地（UTC）取值，得名「北京日期 0 点」
            const fileName = backupFileName(
                database,
                [...ALL_GROUP_KEYS],
                true,
                new Date(Date.now() + BEIJING_OFFSET_MS),
            );
            const partPath = join(dir, `${fileName}.part`);
            const handle = await createBackupStream({
                executor: new MariaDbExecutor(connection),
                database,
                groups: [...ALL_GROUP_KEYS],
                gzip: true,
                fileName,
            });
            let size = 0;
            try {
                size = await this.writeTo(partPath, handle.stream);
                await handle.done;
            } catch (error) {
                await unlink(partPath).catch(() => undefined);
                throw error;
            }
            await rename(partPath, join(dir, fileName));
            this.logger.log(
                `定时备份完成：${fileName}（表 ${handle.meta().tables.length}，行 ${handle
                    .meta()
                    .tables.reduce((sum, table) => sum + table.rowCount, 0)}，字节 ${size}）`,
            );
            const removed = await this.sweepExpired(dir);
            return { fileName, size, removed };
        } finally {
            this.running = false;
            if (connection) {
                try {
                    await connection.end();
                } catch {
                    connection.destroy();
                }
            }
        }
    }

    /** 流式写盘（背压由 pipeline 保证），返回写出字节数 */
    private async writeTo(path: string, stream: Readable): Promise<number> {
        let size = 0;
        await pipeline(
            stream,
            // 字节计数的透传 Transform（pipeline 中间流必须是 Duplex/Transform）
            new Transform({
                transform: (chunk: Buffer, _encoding, callback) => {
                    size += chunk.length;
                    callback(null, chunk);
                },
            }),
            createWriteStream(path),
        );
        return size;
    }

    /** 保留期清理：只删引擎口径且已过期的文件（含遗留 .part），其余文件不动 */
    private async sweepExpired(dir: string): Promise<number> {
        const retentionDays = this.config.getOrThrow("backup.retentionDays", { infer: true });
        const now = new Date();
        let removed = 0;
        for (const entry of await readdir(dir)) {
            const full = join(dir, entry);
            const info = await stat(full).catch(() => null);
            if (info === null || !info.isFile() || !isExpiredBackup(entry, now, retentionDays)) {
                continue;
            }
            await unlink(full).then(
                () => {
                    removed += 1;
                },
                error => {
                    this.logger.warn(`过期备份删除失败（${entry}）：${String(error)}`);
                },
            );
        }
        if (removed > 0) {
            this.logger.log(`过期备份清理完成：删除 ${removed} 个（保留 ${retentionDays} 天）`);
        }
        return removed;
    }
}

import { Logger } from "@nestjs/common";
import { Readable } from "node:stream";
import { mkdtemp, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduledBackupService, isExpiredBackup, nextScheduledRunAt } from "./scheduled-backup.service";
import { MaintenanceState } from "../domain/maintenance-state";
import { createBackupStream } from "./engine/backup-writer";

vi.mock("../prisma/create-pool", () => ({
    createBackupConnection: vi.fn(async () => ({ end: async () => undefined, destroy: () => undefined })),
}));

// backupFileName 保持真实实现（命名口径受测）；createBackupStream 按用例注入
vi.mock("./engine/backup-writer", async importOriginal => {
    const actual = await importOriginal<typeof import("./engine/backup-writer")>();
    return { ...actual, createBackupStream: vi.fn() };
});

const fakeHandle = (fileName: string, chunks: string[]) => ({
    stream: Readable.from(chunks.map(chunk => Buffer.from(chunk))),
    done: Promise.resolve(),
    fileName,
    sqlBytes: () => 42,
    meta: () => ({ tables: [{ name: "sys_user", rowCount: 1 }] }),
});

/** 组装被测服务：MaintenanceState 用真实实例；config 按 key 取值替身 */
function mkService(env: Record<string, unknown>) {
    const maintenance = new MaintenanceState();
    const config = { getOrThrow: vi.fn((key: string) => env[key]) };
    const service = new ScheduledBackupService(config as never, maintenance);
    return { service, maintenance };
}

const baseEnv = (dir: string): Record<string, unknown> => ({
    nodeEnv: "development",
    "backup.dir": dir,
    "backup.retentionDays": 7,
    "database.name": "zmdb",
    "database.host": "db",
    "database.port": 3306,
    "database.user": "zm",
    "database.password": "secret",
});

describe("nextScheduledRunAt（北京 0 点 = UTC 16:00）", () => {
    it("16 点前对齐当日 UTC 16:00；整点已过/恰在整点顺延一天", () => {
        expect(nextScheduledRunAt(new Date("2026-10-17T10:00:00Z")).toISOString()).toBe("2026-10-17T16:00:00.000Z");
        expect(nextScheduledRunAt(new Date("2026-10-17T16:00:00Z")).toISOString()).toBe("2026-10-18T16:00:00.000Z");
        expect(nextScheduledRunAt(new Date("2026-10-17T23:30:00Z")).toISOString()).toBe("2026-10-18T16:00:00.000Z");
    });
});

describe("isExpiredBackup（仅引擎口径文件参与保留期判定）", () => {
    const now = new Date("2026-10-17T16:00:00Z");

    it("距日期戳满保留天数即过期（含崩溃遗留 .part）", () => {
        expect(isExpiredBackup("zmdb-full-20261010-000000.sql.gz", now, 7)).toBe(true);
        expect(isExpiredBackup("zmdb-full-20261011-000000.sql.gz", now, 7)).toBe(false);
        expect(isExpiredBackup("zmdb-full-20200101-000000.sql.gz.part", now, 7)).toBe(true);
    });

    it("非引擎口径或非法日期永不判过期（防误删）", () => {
        expect(isExpiredBackup("readme.txt", now, 7)).toBe(false);
        expect(isExpiredBackup("zmdb-full-20260231-000000.sql.gz", now, 7)).toBe(false);
    });
});

describe("ScheduledBackupService 调度", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
        vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
        vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("test 环境不注册调度", async () => {
        const dir = await mkdtemp(join(tmpdir(), "zmsys-backup-schedule-"));
        const { service } = mkService({ ...baseEnv(dir), nodeEnv: "test" });
        service.onApplicationBootstrap();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("到点执行备份并重排下一轮；shutdown 清理计时器", async () => {
        const dir = await mkdtemp(join(tmpdir(), "zmsys-backup-schedule-"));
        const { service } = mkService(baseEnv(dir));
        // 覆写实例方法：调度行为与 fs/DB 执行路径解耦（落盘路径由真实计时器用例覆盖）
        const runOnce = vi.fn(async () => ({ fileName: "x.sql.gz", size: 1, removed: 0 }));
        (service as unknown as { runOnce: unknown }).runOnce = runOnce;
        vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
        service.onApplicationBootstrap();
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000); // UTC 16:00 触发
        expect(runOnce).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1); // 已重排次日

        service.onApplicationShutdown();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("runOnce 抛错时记录错误并照常重排", async () => {
        const dir = await mkdtemp(join(tmpdir(), "zmsys-backup-schedule-"));
        const { service } = mkService(baseEnv(dir));
        (service as unknown as { runOnce: unknown }).runOnce = vi.fn(async () => {
            throw new Error("连接失败");
        });
        vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
        service.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
        expect(vi.getTimerCount()).toBe(1);
        service.onApplicationShutdown();
    });

    it("维护态激活时跳过本轮但照常重排", async () => {
        const dir = await mkdtemp(join(tmpdir(), "zmsys-backup-schedule-"));
        const { service, maintenance } = mkService(baseEnv(dir));
        const runOnce = vi.fn(async () => ({ fileName: "x.sql.gz", size: 1, removed: 0 }));
        (service as unknown as { runOnce: unknown }).runOnce = runOnce;
        vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
        service.onApplicationBootstrap();
        maintenance.activate();
        await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
        expect(runOnce).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1);
        service.onApplicationShutdown();
    });
});

describe("ScheduledBackupService 落盘与清理（真实 fs）", () => {
    beforeEach(() => {
        vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
        vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
        vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("全量 gzip 备份原子落盘（无 .part 残留），过期文件清理、无关文件不动", async () => {
        const dir = await mkdtemp(join(tmpdir(), "zmsys-backup-run-"));
        await writeFile(join(dir, "zmdb-full-20200101-000000.sql.gz"), "old");
        await writeFile(join(dir, "notes.txt"), "keep");
        const { service } = mkService(baseEnv(dir));
        vi.mocked(createBackupStream).mockImplementation(
            async options =>
                fakeHandle((options as { fileName?: string }).fileName ?? "x.sql.gz", [
                    "-- zmsys-backup v1\n",
                ]) as never,
        );

        const result = await service.runOnce();

        expect(result.fileName).toMatch(/^zmdb-full-\d{8}-\d{6}\.sql\.gz$/); // 引擎口径 + 北京日期戳
        const files = await readdir(dir);
        expect(files).toContain(result.fileName);
        expect(files).toContain("notes.txt");
        expect(files).not.toContain("zmdb-full-20200101-000000.sql.gz");
        expect(files.some(name => name.endsWith(".part"))).toBe(false);
        expect(result.removed).toBe(1);
    });

    it("流失败删除半成品 .part 并上抛；重叠调用直接拒绝", async () => {
        const dir = await mkdtemp(join(tmpdir(), "zmsys-backup-fail-"));
        const { service } = mkService(baseEnv(dir));
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        vi.mocked(createBackupStream).mockImplementation(async options => {
            const fileName = (options as { fileName?: string }).fileName ?? "x.sql.gz";
            // 流挂起等待 gate，随后以错误收尾：模拟备份中途失败/传输中断
            const stream = new Readable({ read: () => undefined });
            stream.push(Buffer.from("data\n"));
            void gate.then(() => stream.destroy(new Error("备份流中断")));
            return { ...fakeHandle(fileName, []), stream } as never;
        });

        const pending = service.runOnce();
        await expect(service.runOnce()).rejects.toThrow("尚未结束");
        release();
        await expect(pending).rejects.toThrow("备份流中断");
        const files = await readdir(dir);
        expect(files.some(name => name.endsWith(".part"))).toBe(false);
        expect(files).toEqual([]);
    });
});

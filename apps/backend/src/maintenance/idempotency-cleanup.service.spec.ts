import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdempotencyCleanupService } from "./idempotency-cleanup.service";
import { MaintenanceState } from "../domain/maintenance-state";
import type { IdempotencyService } from "../idempotency/idempotency.service";

/** 组装被测服务：MaintenanceState 用真实实例（验证写登记排空互锁），其余替身 */
function mkService(nodeEnv: string, cleanup: () => Promise<number>) {
    const maintenance = new MaintenanceState();
    const config = { getOrThrow: vi.fn().mockReturnValue(nodeEnv) };
    const idempotency = { cleanup: vi.fn(cleanup) };
    const service = new IdempotencyCleanupService(
        maintenance,
        config as never,
        idempotency as unknown as IdempotencyService,
    );
    return { service, maintenance, idempotency };
}

describe("IdempotencyCleanupService 调度与写登记", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("test 环境不注册调度", () => {
        const { service } = mkService("test", async () => 0);
        service.onApplicationBootstrap();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("非 test 环境注册首跑与周期调度；执行期间经写登记纳入排空，结束释放", async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const { service, maintenance, idempotency } = mkService("development", async () => {
            await gate;
            return 3;
        });
        service.onApplicationBootstrap();
        expect(vi.getTimerCount()).toBe(2);

        await vi.advanceTimersByTimeAsync(30_000); // 首跑触发，cleanup 挂在 gate 上
        expect(idempotency.cleanup).toHaveBeenCalledTimes(1);
        // 清理在途：写登记未释放（drain 等待在途写的排空语义由 maintenance-state.spec 真计时器覆盖）
        expect(maintenance.activeWrites()).toBe(1);

        release();
        await vi.advanceTimersByTimeAsync(0); // 微任务排干，finally 释放登记
        expect(maintenance.activeWrites()).toBe(0);

        await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); // 周期调度再跑一轮
        expect(idempotency.cleanup).toHaveBeenCalledTimes(2);

        service.onApplicationShutdown();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("维护态激活期间不启动清理", async () => {
        const { service, maintenance, idempotency } = mkService("development", async () => 1);
        service.onApplicationBootstrap();
        maintenance.activate();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(idempotency.cleanup).not.toHaveBeenCalled();
        expect(maintenance.activeWrites()).toBe(0);
        service.onApplicationShutdown();
    });
});

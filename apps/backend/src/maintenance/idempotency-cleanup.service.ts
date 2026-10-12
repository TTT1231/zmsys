import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { MaintenanceState } from "../domain/maintenance-state";
import type { AppConfig } from "../configuration";

/** 清理调度间隔：每日一次 */
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 启动后延迟首跑：避开应用预热 */
const FIRST_RUN_DELAY_MS = 30 * 1000;

/**
 * 幂等记录定时清理（db-scheme.md §10.4）：回收超过保留期的 api_idempotency
 * 行（48h，见 IdempotencyService）——不恢复的库上该表只增不减，回收挂本调度。
 * 与恢复维护期的互斥经写登记实现（db-scheme.md §10.4）：执行前 tryRegisterWrite
 * 登记在途写、finally 释放——「清理已启动、恢复随后激活」时 drain 会等待清理
 * 结束，不与恢复中的 DELETE 竞争；维护态激活后（代次已变）登记失败即跳过本轮。
 */
@Injectable()
export class IdempotencyCleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(IdempotencyCleanupService.name);
    private intervalHandle: NodeJS.Timeout | null = null;
    private firstRunHandle: NodeJS.Timeout | null = null;

    constructor(
        private readonly maintenance: MaintenanceState,
        private readonly config: ConfigService<AppConfig>,
        private readonly idempotency: IdempotencyService,
    ) {}

    onApplicationBootstrap(): void {
        // 测试进程跳过定时清理调度（与 configuration 同一口径，不直读 process.env）
        if (this.config.getOrThrow("nodeEnv", { infer: true }) === "test") {
            return;
        }
        this.firstRunHandle = setTimeout(() => {
            this.firstRunHandle = null;
            void this.runScheduledCleanup();
        }, FIRST_RUN_DELAY_MS);
        this.intervalHandle = setInterval(() => void this.runScheduledCleanup(), CLEANUP_INTERVAL_MS);
    }

    onApplicationShutdown(): void {
        if (this.firstRunHandle !== null) {
            clearTimeout(this.firstRunHandle);
            this.firstRunHandle = null;
        }
        if (this.intervalHandle !== null) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }

    /** 定时入口：写登记成功才执行；调度错误记录后不中断后续调度 */
    private async runScheduledCleanup(): Promise<void> {
        // 恢复维护期间不启动新清理；跨过一次激活的迟到触发登记失败同样跳过
        if (this.maintenance.isActive()) {
            return;
        }
        if (!this.maintenance.tryRegisterWrite(this.maintenance.generation())) {
            return;
        }
        try {
            const expiredIdempotency = await this.idempotency.cleanup();
            if (expiredIdempotency > 0) {
                this.logger.log(`幂等记录清理完成：${expiredIdempotency} 条`);
            }
        } catch (error) {
            this.logger.error(`幂等记录清理失败，将于下个调度周期重试: ${String(error)}`);
        } finally {
            this.maintenance.releaseWrite();
        }
    }
}

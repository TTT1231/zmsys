/**
 * 进程内维护态（实施计划 §4 维护态生命周期）：恢复任务执行期间的写入控制。
 *
 * - 激活时 generation 递增；请求进入管线时记录当时 generation，全部 guard 通过后
 *   拦截器原子检查「非维护态且代次仍相同」才登记写请求——跨过一次激活的旧鉴权
 *   请求（gen 不一致）被 503 拒绝，不漏算已开始业务的写入，也不为被拒请求遗留计数；
 * - 计数在 handler/数据库操作实际结束后释放（含校验失败、异常），不因 HTTP 断线提前释放；
 * - purgeActive 覆盖台账清理「首次查询到最后一次事务结束」，维护态下不启动新批次；
 * - 恢复任务自身不计入排空对象（已接管的任务在维护激活前释放自己的登记）。
 */
import { Global, Injectable, Module } from "@nestjs/common";

/** 维护只读白名单：恢复期间仍放行的 GET 端点（路径前缀匹配，不含查询串） */
export const MAINTENANCE_READONLY_PREFIXES: readonly string[] = [
    "/api/auth/profile",
    "/api/system/backup/catalog",
    "/api/system/restore/jobs",
    "/api/health/live",
];

export const isMaintenanceReadOnlyPath = (method: string, url: string): boolean => {
    if (method !== "GET") return false;
    const path = url.split("?")[0] ?? url;
    return MAINTENANCE_READONLY_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
};

/** 请求对象上记录代次的属性键（guard 写、拦截器读） */
export const MAINTENANCE_GENERATION_KEY = "__zmsysMaintenanceGeneration";

const DRAIN_POLL_MS = 50;

@Injectable()
export class MaintenanceState {
    private generationCounter = 0;
    private activeFlag = false;
    private writes = 0;
    purgeActive = false;

    /** 激活维护态；返回新代次（此后进入管线的请求都按新代次记录） */
    activate(): number {
        this.generationCounter += 1;
        this.activeFlag = true;
        return this.generationCounter;
    }

    deactivate(): void {
        if (!this.activeFlag) return;
        this.activeFlag = false;
    }

    isActive(): boolean {
        return this.activeFlag;
    }

    generation(): number {
        return this.generationCounter;
    }

    /**
     * 全部 guard 通过后由拦截器调用：非维护态且请求代次仍与当前一致才登记。
     * 返回 false 表示请求跨越了一次维护激活（或正处于维护态），应 503。
     */
    tryRegisterWrite(requestGeneration: number): boolean {
        if (this.activeFlag) return false;
        if (requestGeneration !== this.generationCounter) return false;
        this.writes += 1;
        return true;
    }

    releaseWrite(): void {
        this.writes = Math.max(0, this.writes - 1);
    }

    activeWrites(): number {
        return this.writes;
    }

    /** 等待在途写请求与清理批次排空；超时返回 false（调用方决定失败路径） */
    async drain(timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            if (this.writes === 0 && !this.purgeActive) {
                return true;
            }
            if (Date.now() >= deadline) {
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, DRAIN_POLL_MS));
        }
    }
}

@Global()
@Module({
    providers: [MaintenanceState],
    exports: [MaintenanceState],
})
export class MaintenanceStateModule {}

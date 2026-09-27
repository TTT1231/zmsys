import { describe, expect, it } from "vitest";
import { isMaintenanceReadOnlyPath, MaintenanceState } from "./maintenance-state";

describe("MaintenanceState 代次与写计数", () => {
    it("非维护态下登记并释放", () => {
        const state = new MaintenanceState();
        const generation = state.generation();
        expect(state.tryRegisterWrite(generation)).toBe(true);
        expect(state.activeWrites()).toBe(1);
        state.releaseWrite();
        expect(state.activeWrites()).toBe(0);
    });

    it("维护态激活后新登记被拒（503 路径）", () => {
        const state = new MaintenanceState();
        state.activate();
        expect(state.isActive()).toBe(true);
        expect(state.tryRegisterWrite(state.generation())).toBe(false);
    });

    it("跨激活的旧代次请求被拒（已过 guard 的旧鉴权请求）", () => {
        const state = new MaintenanceState();
        const oldGeneration = state.generation();
        state.activate(); // 恢复激活：代次 +1
        state.deactivate();
        // 旧请求带着旧代次到达拦截器：拒绝，重新请求时重新鉴权
        expect(state.tryRegisterWrite(oldGeneration)).toBe(false);
        expect(state.tryRegisterWrite(state.generation())).toBe(true);
    });

    it("drain 等待在途写与 purgeActive", async () => {
        const state = new MaintenanceState();
        state.tryRegisterWrite(state.generation());
        state.purgeActive = true;
        await expect(state.drain(80)).resolves.toBe(false);
        state.purgeActive = false;
        await expect(state.drain(80)).resolves.toBe(false);
        state.releaseWrite();
        await expect(state.drain(80)).resolves.toBe(true);
    });
});

describe("维护只读白名单", () => {
    it("仅放行 GET 且路径前缀精确匹配", () => {
        expect(isMaintenanceReadOnlyPath("GET", "/api/auth/profile")).toBe(true);
        expect(isMaintenanceReadOnlyPath("GET", "/api/auth/profile?x=1")).toBe(true);
        expect(isMaintenanceReadOnlyPath("GET", "/api/system/backup/catalog")).toBe(true);
        expect(isMaintenanceReadOnlyPath("GET", "/api/system/restore/jobs/123")).toBe(true);
        expect(isMaintenanceReadOnlyPath("GET", "/api/system/restore/jobs/key/rk-123")).toBe(true);
        expect(isMaintenanceReadOnlyPath("GET", "/api/health/live")).toBe(true);
        expect(isMaintenanceReadOnlyPath("POST", "/api/auth/profile")).toBe(false);
        expect(isMaintenanceReadOnlyPath("POST", "/api/system/restore/run")).toBe(false);
        expect(isMaintenanceReadOnlyPath("GET", "/api/auth/login")).toBe(false);
        expect(isMaintenanceReadOnlyPath("GET", "/api/orders")).toBe(false);
        expect(isMaintenanceReadOnlyPath("GET", "/api/system/restore/jobsevil")).toBe(false);
    });
});

import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { MaintenanceGuard } from "./maintenance.guard";
import { MAINTENANCE_GENERATION_KEY, MaintenanceState } from "../../domain/maintenance-state";

const createContext = (method: string, url: string) => {
    const state = new MaintenanceState();
    const guard = new MaintenanceGuard(state);
    const request: Record<string, unknown> = { method, url };
    const ctx = {
        switchToHttp: () => ({ getRequest: () => request }),
    } as never;
    return { guard, state, request, ctx };
};

describe("MaintenanceGuard", () => {
    it("非维护态放行并记录代次", () => {
        const { guard, request, ctx } = createContext("POST", "/api/orders");
        expect(guard.canActivate(ctx)).toBe(true);
        expect(typeof request[MAINTENANCE_GENERATION_KEY]).toBe("number");
    });

    it("维护态：白名单 GET 放行，其余 503", () => {
        const { guard, state, ctx } = createContext("GET", "/api/auth/profile");
        state.activate();
        expect(guard.canActivate(ctx)).toBe(true);

        const blocked = createContext("GET", "/api/orders");
        blocked.state.activate();
        expect(() => blocked.guard.canActivate(blocked.ctx)).toThrow(ServiceUnavailableException);

        const write = createContext("POST", "/api/system/backup/run");
        write.state.activate();
        expect(() => write.guard.canActivate(write.ctx)).toThrow(ServiceUnavailableException);
    });

    it("维护态下仍为白名单请求记录代次（供拦截器复查）", () => {
        const { guard, state, request, ctx } = createContext("GET", "/api/health/live");
        state.activate();
        guard.canActivate(ctx);
        expect(request[MAINTENANCE_GENERATION_KEY]).toBe(state.generation());
    });
});

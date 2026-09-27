import { ServiceUnavailableException } from "@nestjs/common";
import { Observable, of } from "rxjs";
import { describe, expect, it } from "vitest";
import { WriteRegistrationInterceptor } from "./write-registration.interceptor";
import { MAINTENANCE_GENERATION_KEY, MaintenanceState } from "../../domain/maintenance-state";

const createContext = (method: string, generation?: number) => {
    const state = new MaintenanceState();
    const interceptor = new WriteRegistrationInterceptor(state);
    const request: Record<string, unknown> = { method };
    if (generation !== undefined) {
        request[MAINTENANCE_GENERATION_KEY] = generation;
    }
    const ctx = {
        switchToHttp: () => ({ getRequest: () => request }),
    } as never;
    return { interceptor, state, request, ctx };
};

describe("WriteRegistrationInterceptor", () => {
    it("GET/HEAD/OPTIONS 不登记", () => {
        const { interceptor, state, ctx } = createContext("GET");
        void interceptor.intercept(ctx, { handle: () => of(null) } as never).subscribe();
        expect(state.activeWrites()).toBe(0);
    });

    it("POST 登记并在 handler 结束后释放", () => {
        const state = new MaintenanceState();
        const interceptor = new WriteRegistrationInterceptor(state);
        const request: Record<string, unknown> = { method: "POST", [MAINTENANCE_GENERATION_KEY]: state.generation() };
        const ctx = {
            switchToHttp: () => ({ getRequest: () => request }),
        } as never;
        let completed = false;
        void interceptor.intercept(ctx, { handle: () => of(null) } as never).subscribe({
            complete: () => {
                completed = true;
            },
        });
        // of(null) 同步完成：登记 → 执行 → finalize 释放一气呵成
        expect(completed).toBe(true);
        expect(state.activeWrites()).toBe(0);
    });

    it("维护激活期间到达的 POST 被 503 拒绝且不留计数", () => {
        const { interceptor, state, ctx } = createContext("POST");
        state.activate();
        expect(() => interceptor.intercept(ctx, { handle: () => of(null) } as never)).toThrow(
            ServiceUnavailableException,
        );
        expect(state.activeWrites()).toBe(0);
    });

    it("缺代次记录（未经 MaintenanceGuard）的写请求被拒", () => {
        const { interceptor, ctx } = createContext("POST");
        expect(() => interceptor.intercept(ctx, { handle: () => of(null) } as never)).toThrow(
            ServiceUnavailableException,
        );
    });

    it("跨激活的旧代次请求被拒", () => {
        const { interceptor, state, ctx } = createContext("POST", 5);
        state.activate(); // 代次从 0 → 1；旧请求带 5
        state.deactivate();
        expect(() => interceptor.intercept(ctx, { handle: () => of(null) } as never)).toThrow(
            ServiceUnavailableException,
        );
    });

    it("未完成的写请求保持计数（排空等待对象）", () => {
        const state = new MaintenanceState();
        const interceptor = new WriteRegistrationInterceptor(state);
        const request: Record<string, unknown> = { method: "POST", [MAINTENANCE_GENERATION_KEY]: state.generation() };
        const ctx = {
            switchToHttp: () => ({ getRequest: () => request }),
        } as never;
        const neverCompletes = new Observable<never>(() => () => undefined);
        const subscription = interceptor.intercept(ctx, { handle: () => neverCompletes } as never).subscribe();
        expect(state.activeWrites()).toBe(1);
        subscription.unsubscribe();
        expect(state.activeWrites()).toBe(0);
    });
});

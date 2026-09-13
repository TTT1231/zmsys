/* 路由加载信号 store:引用计数的进出配对、边界通知与退订 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    enterRoutePending,
    exitRoutePending,
    isRoutePending,
    resetRoutePending,
    subscribeRoutePending,
} from "@/lib/route-pending";

afterEach(() => {
    resetRoutePending();
});

describe("route-pending store", () => {
    it("keeps pending while nested enter/exit pairs overlap", () => {
        enterRoutePending();
        enterRoutePending();
        expect(isRoutePending()).toBe(true);

        exitRoutePending();
        expect(isRoutePending()).toBe(true); // 并存加载源退出一方不得清零信号
        exitRoutePending();
        expect(isRoutePending()).toBe(false);
    });

    it("clamps extra exits at zero", () => {
        exitRoutePending();
        expect(isRoutePending()).toBe(false);

        enterRoutePending();
        expect(isRoutePending()).toBe(true);
    });

    it("notifies subscribers only when crossing the boundary", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeRoutePending(listener);

        enterRoutePending();
        expect(listener).toHaveBeenCalledTimes(1);

        enterRoutePending(); // 仍 pending,不重复通知
        expect(listener).toHaveBeenCalledTimes(1);

        exitRoutePending(); // 仍 pending
        expect(listener).toHaveBeenCalledTimes(1);

        exitRoutePending(); // 归零
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
    });

    it("stops notifying after unsubscribe", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeRoutePending(listener);
        unsubscribe();
        enterRoutePending();
        expect(listener).not.toHaveBeenCalled();
    });
});

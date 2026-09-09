/* 路由加载信号 store:置位/复位通知与退订 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { isRoutePending, setRoutePending, subscribeRoutePending } from "@/lib/route-pending";

afterEach(() => {
    setRoutePending(false);
});

describe("route-pending store", () => {
    it("notifies subscribers only on change", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeRoutePending(listener);

        setRoutePending(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(isRoutePending()).toBe(true);

        setRoutePending(true); // 同值不重复通知
        expect(listener).toHaveBeenCalledTimes(1);

        setRoutePending(false);
        expect(listener).toHaveBeenCalledTimes(2);
        expect(isRoutePending()).toBe(false);

        unsubscribe();
    });

    it("stops notifying after unsubscribe", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeRoutePending(listener);
        unsubscribe();
        setRoutePending(true);
        expect(listener).not.toHaveBeenCalled();
    });
});

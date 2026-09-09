// @vitest-environment jsdom
/* useFullscreen:supported 探测、toggle 双向调用、fullscreenchange 状态同步 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFullscreen } from "@/components/layout/useFullscreen";

const restore: Array<() => void> = [];

afterEach(() => {
    restore.splice(0).forEach(fn => fn());
});

function mockFullscreenApi() {
    const request = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, "requestFullscreen", {
        value: request,
        configurable: true,
    });
    Object.defineProperty(document, "exitFullscreen", { value: exit, configurable: true });
    let element: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
        get: () => element,
        configurable: true,
    });
    restore.push(() => {
        Reflect.deleteProperty(document.documentElement, "requestFullscreen");
        Reflect.deleteProperty(document, "exitFullscreen");
        Reflect.deleteProperty(document, "fullscreenElement");
    });
    return {
        request,
        exit,
        setFullscreen: (value: boolean) => {
            element = value ? document.documentElement : null;
            act(() => {
                document.dispatchEvent(new Event("fullscreenchange"));
            });
        },
    };
}

describe("useFullscreen", () => {
    it("reports unsupported when API is absent (iOS-like)", () => {
        const { result } = renderHook(() => useFullscreen());
        expect(result.current.supported).toBe(false);
    });

    it("enters fullscreen via requestFullscreen when not fullscreen", () => {
        const api = mockFullscreenApi();
        const { result } = renderHook(() => useFullscreen());
        expect(result.current.supported).toBe(true);
        act(() => result.current.toggle());
        expect(api.request).toHaveBeenCalledTimes(1);
        expect(api.exit).not.toHaveBeenCalled();
    });

    it("syncs state on fullscreenchange and exits via exitFullscreen", () => {
        const api = mockFullscreenApi();
        const { result } = renderHook(() => useFullscreen());
        api.setFullscreen(true);
        expect(result.current.isFullscreen).toBe(true);
        act(() => result.current.toggle());
        expect(api.exit).toHaveBeenCalledTimes(1);
        api.setFullscreen(false);
        expect(result.current.isFullscreen).toBe(false);
    });
});

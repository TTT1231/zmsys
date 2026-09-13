// @vitest-environment jsdom
/* RouteProgressBar:信号驱动显示/满格淡出、无信号不显示、重入不倒退、淡出后归零、挂载即拾取已置位信号 */
import "@testing-library/jest-dom/vitest";

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RouteProgressBar } from "@/components/RouteProgressBar";
import { enterRoutePending, exitRoutePending, resetRoutePending } from "@/lib/route-pending";

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    act(() => {
        vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    cleanup();
    resetRoutePending();
});

function renderBar() {
    const { container } = render(<RouteProgressBar />);
    return container.firstElementChild!.firstElementChild as HTMLElement;
}

describe("RouteProgressBar", () => {
    it("shows while route-level loading is pending and settles right when it clears", () => {
        const bar = renderBar();
        expect(bar).toHaveClass("opacity-0"); // 无信号不显示

        act(() => enterRoutePending());
        expect(bar).toHaveClass("opacity-100");
        expect(bar.style.width).toBe("88%"); // 爬升目标值,平滑推进由 CSS 过渡负责

        act(() => exitRoutePending());
        expect(bar.style.width).toBe("100%"); // 信号归零立即满格,无轮询延迟
        expect(bar).toHaveClass("opacity-100");

        act(() => vi.advanceTimersByTime(300));
        expect(bar).toHaveClass("opacity-0"); // 满格停留后淡出

        act(() => vi.advanceTimersByTime(300));
        expect(bar.style.width).toBe("0%"); // 淡出完成后归零,下一轮从 0 重新爬
    });

    it("never shows when nothing loads (cached instant switch)", () => {
        const bar = renderBar();
        act(() => vi.advanceTimersByTime(1000));
        expect(bar).toHaveClass("opacity-0");
        expect(bar.style.width).toBe("0%");
    });

    it("resumes without width regression when loading restarts during fade", () => {
        const bar = renderBar();
        act(() => enterRoutePending());
        act(() => exitRoutePending());
        act(() => vi.advanceTimersByTime(300)); // 进入淡出
        expect(bar).toHaveClass("opacity-0");

        act(() => enterRoutePending()); // 淡出中新一轮加载开始
        expect(bar).toHaveClass("opacity-100");
        expect(bar.style.width).toBe("100%"); // 不从 88 倒退,从当前值继续

        act(() => exitRoutePending());
        act(() => vi.advanceTimersByTime(600));
        expect(bar).toHaveClass("opacity-0");
        expect(bar.style.width).toBe("0%");
    });

    it("picks up an already-pending signal on mount", () => {
        enterRoutePending();
        const bar = renderBar();
        expect(bar).toHaveClass("opacity-100");
    });
});

// @vitest-environment jsdom
/* LoadingOverlay:遮罩渲染;useDelayedFlag:200ms 延迟显示 / 500ms 最小展示 / 短脉冲不显示 */
import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useDelayedFlag } from "@/components/ui/useDelayedFlag";

function Probe({ value }: { value: boolean }) {
    const shown = useDelayedFlag(value);
    return <div data-testid="flag">{String(shown)}</div>;
}

let rerender: (ui: React.ReactElement) => void;

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

describe("LoadingOverlay", () => {
    it("renders status with default label", () => {
        render(<LoadingOverlay />);
        expect(screen.getByRole("status")).toHaveTextContent("刷新中…");
    });

    it("accepts custom label", () => {
        render(<LoadingOverlay label="同步中…" />);
        expect(screen.getByRole("status")).toHaveTextContent("同步中…");
    });
});

describe("useDelayedFlag", () => {
    it("stays hidden before showDelay, shows after 200ms", () => {
        const view = render(<Probe value={true} />);
        rerender = view.rerender;
        expect(screen.getByTestId("flag").textContent).toBe("false");
        act(() => vi.advanceTimersByTime(199));
        expect(screen.getByTestId("flag").textContent).toBe("false");
        act(() => vi.advanceTimersByTime(1));
        expect(screen.getByTestId("flag").textContent).toBe("true");
    });

    it("keeps showing at least minShow after value drops", () => {
        const view = render(<Probe value={false} />);
        rerender = view.rerender;
        rerender(<Probe value={true} />);
        act(() => vi.advanceTimersByTime(200)); // 显示
        rerender(<Probe value={false} />);
        act(() => vi.advanceTimersByTime(499)); // 最小展示期内保持
        expect(screen.getByTestId("flag").textContent).toBe("true");
        act(() => vi.advanceTimersByTime(1));
        expect(screen.getByTestId("flag").textContent).toBe("false");
    });

    it("never shows for a pulse shorter than showDelay", () => {
        const view = render(<Probe value={false} />);
        rerender = view.rerender;
        rerender(<Probe value={true} />);
        act(() => vi.advanceTimersByTime(100));
        rerender(<Probe value={false} />);
        act(() => vi.advanceTimersByTime(1000));
        expect(screen.getByTestId("flag").textContent).toBe("false");
    });
});

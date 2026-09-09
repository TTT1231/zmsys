// @vitest-environment jsdom
/* PageLoading:占位渲染 + 挂载/卸载驱动 route-pending 信号 */
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageLoading } from "@/components/ui/PageLoading";
import { isRoutePending, setRoutePending } from "@/lib/route-pending";

afterEach(() => {
    cleanup();
    setRoutePending(false);
});

describe("PageLoading", () => {
    it("renders cube loader with unified visible label", () => {
        render(<PageLoading />);
        expect(screen.getByRole("status")).toHaveAttribute("aria-label", "加载中…");
        expect(screen.getByText("加载中…")).toBeInTheDocument();
    });

    it("raises route-pending while mounted and clears on unmount", () => {
        const { unmount } = render(<PageLoading />);
        expect(isRoutePending()).toBe(true);
        unmount();
        expect(isRoutePending()).toBe(false);
    });
});

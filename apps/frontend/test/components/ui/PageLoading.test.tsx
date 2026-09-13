// @vitest-environment jsdom
/* PageLoading:占位渲染 + routeLevel 标记驱动 route-pending 计数(数据占位不上报) */
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageLoading } from "@/components/ui/PageLoading";
import { isRoutePending, resetRoutePending } from "@/lib/route-pending";

afterEach(() => {
    cleanup();
    resetRoutePending();
});

describe("PageLoading", () => {
    it("renders cube loader with unified visible label", () => {
        render(<PageLoading />);
        expect(screen.getByRole("status")).toHaveAttribute("aria-label", "加载中…");
        expect(screen.getByText("加载中…")).toBeInTheDocument();
    });

    it("raises route-pending only when marked route-level", () => {
        const plain = render(<PageLoading />);
        expect(isRoutePending()).toBe(false); // 页面内数据占位不上报路由进度信号
        plain.unmount();

        const routeLevel = render(<PageLoading routeLevel />);
        expect(isRoutePending()).toBe(true);
        routeLevel.unmount();
        expect(isRoutePending()).toBe(false);
    });

    it("keeps route-pending until all coexisting route-level instances unmount", () => {
        const first = render(<PageLoading routeLevel />);
        const second = render(<PageLoading routeLevel />);
        first.unmount();
        expect(isRoutePending()).toBe(true); // 卸载其一不得清掉另一实例的信号
        second.unmount();
        expect(isRoutePending()).toBe(false);
    });
});

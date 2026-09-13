// @vitest-environment jsdom
/* EmptyState:插画 + 描述 + 操作插槽的渲染约定 */
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmptyState } from "@/components/ui/EmptyState";

afterEach(cleanup);

describe("EmptyState", () => {
    it("renders illustration with description", () => {
        const { container } = render(<EmptyState description="没有找到匹配的订单" />);
        expect(container.querySelector("svg")).not.toBeNull(); // 抽屉插画
        expect(container.querySelector("svg")).toHaveAttribute("width", "160"); // 默认 160
        expect(screen.getByText("没有找到匹配的订单")).toBeInTheDocument();
    });

    it("renders action slot below description", () => {
        render(
            <EmptyState description="没有找到匹配的订单">
                <button type="button">清除筛选</button>
            </EmptyState>,
        );
        expect(screen.getByRole("button", { name: "清除筛选" })).toBeInTheDocument();
    });

    it("scales illustration and omits description when not provided", () => {
        const { container } = render(<EmptyState imageSize={120} />);
        expect(container.querySelector("svg")).toHaveAttribute("width", "120");
        expect(container.querySelector("p")).toBeNull();
    });
});

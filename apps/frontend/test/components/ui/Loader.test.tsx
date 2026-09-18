// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Loader } from "@/components/ui/Loader";

afterEach(cleanup);

describe("Loader", () => {
    it("is decorative (aria-hidden) without label", () => {
        const { container } = render(<Loader size={16} />);
        expect(container.querySelector("span[aria-hidden='true']")).toBeInTheDocument();
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("exposes role=status with label and renders cube plus shadow", () => {
        const { container } = render(<Loader label="加载中" />);
        expect(screen.getByRole("status")).toHaveAttribute("aria-label", "加载中");
        // 方块 + 阴影两个动画元素
        const animated = container.querySelectorAll("[class*='animate-[']");
        expect(animated.length).toBe(2);
    });
});

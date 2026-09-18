// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Pagination, paginationWindow } from "@/components/ui/Pagination";

afterEach(cleanup);

describe("paginationWindow", () => {
    it("lists all pages when total is small", () => {
        expect(paginationWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
        expect(paginationWindow(3, 3)).toEqual([1, 2, 3]);
    });

    it("collapses the tail when current page is near the start", () => {
        expect(paginationWindow(1, 10)).toEqual([1, 2, 3, 4, "…", 10]);
        expect(paginationWindow(3, 10)).toEqual([1, 2, 3, 4, "…", 10]);
    });

    it("collapses both sides in the middle", () => {
        expect(paginationWindow(5, 10)).toEqual([1, "…", 4, 5, 6, "…", 10]);
    });

    it("collapses the head when current page is near the end", () => {
        expect(paginationWindow(9, 10)).toEqual([1, "…", 7, 8, 9, 10]);
        expect(paginationWindow(10, 10)).toEqual([1, "…", 7, 8, 9, 10]);
    });
});

describe("Pagination", () => {
    it("renders range summary and page window", () => {
        render(<Pagination page={2} pageSize={10} total={95} onPageChange={() => {}} />);
        expect(screen.getByText(/显示 11–20，共 95 条/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page");
        expect(screen.getByText("…")).toBeInTheDocument();
    });

    it("disables prev on first page and next on last page", () => {
        const { rerender } = render(<Pagination page={1} pageSize={10} total={95} onPageChange={() => {}} />);
        expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
        rerender(<Pagination page={10} pageSize={10} total={95} onPageChange={() => {}} />);
        expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    });

    it("emits page change on page click and pager buttons", () => {
        const onPageChange = vi.fn();
        render(<Pagination page={5} pageSize={10} total={95} onPageChange={onPageChange} />);
        fireEvent.click(screen.getByRole("button", { name: "6" }));
        fireEvent.click(screen.getByRole("button", { name: "上一页" }));
        fireEvent.click(screen.getByRole("button", { name: "下一页" }));
        expect(onPageChange).toHaveBeenNthCalledWith(1, 6);
        expect(onPageChange).toHaveBeenNthCalledWith(2, 4);
        expect(onPageChange).toHaveBeenNthCalledWith(3, 6);
    });

    it("emits page size change from the select", () => {
        const onPageSizeChange = vi.fn();
        render(
            <Pagination
                page={1}
                pageSize={10}
                total={95}
                onPageChange={() => {}}
                onPageSizeChange={onPageSizeChange}
            />,
        );
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "30" } });
        expect(onPageSizeChange).toHaveBeenCalledWith(30);
    });
});

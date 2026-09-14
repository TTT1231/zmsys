// @vitest-environment jsdom
// SortTh：aria-sort 随方向同步，点击触发排序，未激活/激活两种视觉状态可区分
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SortTh } from "@/components/ui/SortTh";

afterEach(cleanup);

it("未激活时 aria-sort=none，激活升序为 ascending", () => {
    const { rerender } = render(<SortTh label="订单数量" active={false} dir="asc" onSort={() => {}} />);
    expect(screen.getByRole("columnheader", { name: /订单数量/ })).toHaveAttribute("aria-sort", "none");
    rerender(<SortTh label="订单数量" active={true} dir="asc" onSort={() => {}} />);
    expect(screen.getByRole("columnheader", { name: /订单数量/ })).toHaveAttribute("aria-sort", "ascending");
    rerender(<SortTh label="订单数量" active={true} dir="desc" onSort={() => {}} />);
    expect(screen.getByRole("columnheader", { name: /订单数量/ })).toHaveAttribute("aria-sort", "descending");
});

it("点击表头按钮触发排序回调", () => {
    const onSort = vi.fn();
    render(<SortTh label="交货日期" active={false} dir="asc" onSort={onSort} />);
    fireEvent.click(screen.getByRole("button", { name: /交货日期/ }));
    expect(onSort).toHaveBeenCalledTimes(1);
});

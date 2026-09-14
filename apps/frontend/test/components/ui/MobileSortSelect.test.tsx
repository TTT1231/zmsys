// @vitest-environment jsdom
// MobileSortSelect：按列展开升/降序选项，选择后回传 key+dir 的完整排序状态
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MobileSortSelect } from "@/components/ui/MobileSortSelect";

afterEach(cleanup);

const columns = [
    { key: "date" as const, label: "入库日期" },
    { key: "qty" as const, label: "入库数量" },
];

it("每列生成升/降序两个选项，当前排序被选中", () => {
    render(<MobileSortSelect columns={columns} value={{ key: "date", dir: "desc" }} onChange={() => {}} />);
    const select = screen.getByRole("combobox", { name: "排序列表" }) as HTMLSelectElement;
    const values = Array.from(select.options).map(option => option.value);
    expect(values).toEqual(["date:asc", "date:desc", "qty:asc", "qty:desc"]);
    expect(select.value).toBe("date:desc");
});

it("选择选项后回传对应排序状态", () => {
    const onChange = vi.fn();
    render(<MobileSortSelect columns={columns} value={{ key: "date", dir: "asc" }} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "排序列表" }), { target: { value: "qty:desc" } });
    expect(onChange).toHaveBeenCalledWith({ key: "qty", dir: "desc" });
});

// @vitest-environment jsdom
/* 覆盖趋势品类筛选、月汇总、数据表替代和非法日期提示。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { WorkbenchTrend } from "@/pages/workbench/WorkbenchTrend";
import { createWorkbenchDemo } from "../../../mocks/data/workbench";
vi.mock("@/components/charts/EChart", () => ({ EChart: () => <div /> }));
afterEach(cleanup);
it("筛选品类后展示可访问数据表，今年趋势按月汇总", async () => {
    const user = userEvent.setup();
    render(<WorkbenchTrend data={createWorkbenchDemo("2026-09-12")} />);
    await user.selectOptions(screen.getByLabelText("趋势品类"), "旋转XK2");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("旋转XK2");
    await user.selectOptions(screen.getByLabelText("趋势时间"), "year");
    await user.click(screen.getByRole("button", { name: "查看数据表" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(10);
    await user.selectOptions(screen.getByLabelText("趋势时间"), "custom");
    fireEvent.change(screen.getByLabelText("趋势开始日期"), { target: { value: "2026-09-13" } });
    expect(screen.getByRole("alert")).toHaveTextContent("有效的日期范围");
});

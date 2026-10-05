// @vitest-environment jsdom
/* 覆盖趋势品类筛选、长区间按月汇总与数据表替代；统计周期由页面全局筛选传入。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PreferencesProvider } from "@/context/PreferencesContext";
import { WorkbenchTrend } from "@/pages/workbench/WorkbenchTrend";
import { createWorkbenchDemo } from "../../fixtures/workbench";

/* 图表读偏好主题令牌，包一层 Provider 提供（浅色默认） */
const render = (ui: React.ReactElement) => rtlRender(<PreferencesProvider>{ui}</PreferencesProvider>);
vi.mock("@/components/charts/EChart", () => ({ EChart: () => <div /> }));
afterEach(cleanup);
const data = createWorkbenchDemo("2026-09-12");

it("筛选品类后 aria 摘要带品类，跨月长区间按月汇总成数据表", async () => {
    const user = userEvent.setup();
    render(<WorkbenchTrend data={data} range={{ start: "2026-01-01", end: "2026-09-12" }} />);
    await user.selectOptions(screen.getByLabelText("趋势品类"), "旋转XK2");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("旋转XK2");
    await user.click(screen.getByRole("button", { name: "查看数据表" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    // 2026-01 至 2026-09 逐月一行
    expect(screen.getAllByRole("row")).toHaveLength(10);
});

it("无流水的短区间展示空态提示", () => {
    render(<WorkbenchTrend data={data} range={{ start: "2020-01-01", end: "2020-01-05" }} />);
    expect(screen.getByText("所选期间暂无成品出入库记录")).toBeInTheDocument();
});

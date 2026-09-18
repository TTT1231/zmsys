// @vitest-environment jsdom
/* 覆盖角色隔离、周期筛选、品类与客户明细、风险入口和统计说明。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { WorkbenchPage } from "@/pages/workbench/WorkbenchPage";
import { createWorkbenchDemo } from "../../fixtures/workbench";

const auth = vi.hoisted(() => ({ role: "super" }));
vi.mock("@/context/AppContext", () => ({ useApp: () => auth }));
vi.mock("@/pages/workbench/useWorkbenchData", () => ({ useWorkbenchData: () => createWorkbenchDemo("2026-09-12") }));
vi.mock("@/components/charts/EChart", () => ({ EChart: () => <div data-testid="echart" /> }));
afterEach(() => {
    cleanup();
    auth.role = "super";
});

it("超级管理员看到三块图表和两类风险，其他角色不暴露客户排行", () => {
    const { unmount } = render(<WorkbenchPage />);
    expect(screen.getAllByTestId("echart")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /已逾期未发完/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /未来 7 天到期且缺货/ })).toBeInTheDocument();
    unmount();
    for (const role of ["admin", "sales", "warehouse", "staff"]) {
        auth.role = role;
        const view = render(<WorkbenchPage />);
        expect(screen.queryByRole("heading", { name: /客户订单排行/ })).not.toBeInTheDocument();
        view.unmount();
    }
});

it("周期影响订单汇总，不改变当前风险；型号和客户明细可通过键盘入口查看", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPage />);
    const riskText = screen.getByRole("button", { name: /已逾期未发完/ }).textContent;
    await user.click(screen.getByRole("button", { name: "本月" }));
    expect(screen.getByRole("button", { name: "本月" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /已逾期未发完/ }).textContent).toBe(riskText);
    await user.click(screen.getByRole("button", { name: "旋转XK2" }));
    expect(screen.getByRole("dialog", { name: "旋转XK2 · 型号与规格" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "旋转XK2 / 1-1" }));
    expect(screen.getByRole("dialog", { name: "1-1 · 订单明细" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "返回产品明细" }));
    expect(screen.getByRole("dialog", { name: "旋转XK2 · 型号与规格" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "累计" }));
    await user.click(screen.getByRole("button", { name: "排行明细" }));
    const table = within(screen.getByRole("dialog")).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(21);
    await user.click(within(table).getAllByRole("button")[0]);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toContain("订单明细");
});

it("风险与统计口径弹窗能打开和关闭", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPage />);
    await user.click(screen.getByRole("button", { name: /未来 7 天到期且缺货/ }));
    expect(screen.getByRole("dialog", { name: "未来 7 天到期且缺货的订单" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "统计口径" }));
    expect(screen.getByRole("dialog", { name: "统计口径" })).toHaveTextContent("需求总量 = 已发 + 未发");
});

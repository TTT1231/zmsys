// @vitest-environment jsdom
/* 覆盖产品图表视图切换、条形点击钻取和客户排名切换。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProductProgressChart, CustomerRankingChart } from "@/pages/workbench/WorkbenchCharts";
import { summarizeWorkbench, customerRanking } from "@/data/workbench";
import { createWorkbenchDemo } from "../../../mocks/data/workbench";

vi.mock("@/components/charts/EChart", () => ({
    EChart: ({ onClick }: { onClick: (value: { dataIndex: number }) => void }) => (
        <button onClick={() => onClick({ dataIndex: 0 })}>测试点击第一条形</button>
    ),
}));
afterEach(cleanup);
const data = createWorkbenchDemo("2026-09-12");
it("产品图在交付与库存之间切换，图表点击映射到正确品类", async () => {
    const user = userEvent.setup();
    const onDetails = vi.fn();
    render(
        <ProductProgressChart
            categories={summarizeWorkbench(data, { start: "2026-01-01", end: data.asOf }).categories}
            periodLabel="累计"
            onDetails={onDetails}
        />,
    );
    await user.click(screen.getByRole("button", { name: "库存与缺口" }));
    expect(screen.getByRole("button", { name: "库存与缺口" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("备货缺口"));
    await user.click(screen.getByRole("button", { name: "测试点击第一条形" }));
    expect(onDetails).toHaveBeenCalledWith("旋转开关");
});
it("客户图支持切换笔数，并将条形点击映射到客户编码", async () => {
    const user = userEvent.setup();
    const onMetric = vi.fn();
    const onCustomer = vi.fn();
    const customers = customerRanking(data.orders, "qty");
    render(
        <CustomerRankingChart
            customers={customers}
            metric="qty"
            onMetric={onMetric}
            periodLabel="累计"
            onCustomer={onCustomer}
            onDetails={() => {}}
        />,
    );
    await user.click(screen.getByRole("button", { name: "下单笔数" }));
    expect(onMetric).toHaveBeenCalledWith("count");
    await user.click(screen.getByRole("button", { name: "测试点击第一条形" }));
    expect(onCustomer).toHaveBeenCalledWith(customers[0].code);
});

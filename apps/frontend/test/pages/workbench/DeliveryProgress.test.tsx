// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeliveryProgress } from "@/pages/workbench/DeliveryProgress";
import type { WorkbenchData } from "@/data/workbench";

const snapshot: WorkbenchData = {
    asOf: "2026-10-08",
    unit: "个",
    movements: [],
    products: [{ code: "KD001", category: "开关", model: "K1", spec: "二脚", stock: 50, unit: "个" }],
    orders: [
        {
            no: "SO1",
            customerCode: "C1",
            customer: "客户一",
            bomCode: "KD001",
            date: "2026-10-01",
            due: "2026-10-07",
            qty: 100,
            shipped: 20,
        },
        {
            no: "SO2",
            customerCode: "C2",
            customer: "客户二",
            bomCode: "KD001",
            date: "2026-10-02",
            due: "2026-10-10",
            qty: 100,
            shipped: 0,
        },
        {
            no: "done",
            customerCode: "C1",
            customer: "客户一",
            bomCode: "KD001",
            date: "2026-10-01",
            due: "2026-10-07",
            qty: 100,
            shipped: 100,
        },
    ],
};
afterEach(cleanup);

it("直接展示短标签、数量、缺口和逾期，同 BOM 自动同色且不依赖点击", () => {
    render(<DeliveryProgress data={snapshot} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].style.getPropertyValue("--bom-color")).toBe(rows[1].style.getPropertyValue("--bom-color"));
    expect(screen.getByText("逾期 1 天")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /备货 70%.*已发 20%/ })).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(within(rows[0]).queryByRole("button")).not.toBeInTheDocument();
});

it("缩放与键盘平移只改变时间线，数量和可见订单不变，复位回到当前窗口", () => {
    render(<DeliveryProgress data={snapshot} />);
    const quantity = screen.getByRole("img", { name: /备货 70%/ }).getAttribute("aria-label");
    fireEvent.click(screen.getByRole("button", { name: "放大时间线" }));
    expect(screen.queryByText("10/01 — 10/15")).not.toBeInTheDocument();
    const body = screen.getByRole("rowgroup", { name: /拖动平移/ });
    fireEvent.keyDown(body, { key: "ArrowRight" });
    expect(screen.getByRole("img", { name: /备货 70%/ })).toHaveAttribute("aria-label", quantity);
    expect(screen.getByText("SO1")).toBeInTheDocument();
    expect(screen.getByText("SO2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复位" }));
    expect(screen.getByText("10/01 — 10/15")).toBeInTheDocument();
});

it("刷新数据及时替换进度，发完后退出视图，没有待交时展示空状态", () => {
    const { rerender } = render(<DeliveryProgress data={snapshot} />);
    rerender(
        <DeliveryProgress
            data={{ ...snapshot, orders: snapshot.orders.map(order => ({ ...order, shipped: order.qty })) }}
        />,
    );
    expect(screen.getByRole("heading", { name: "暂无待交订单" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

it("鼠标拖动和 Ctrl 滚轮只作用于右侧甘特图，左侧文字区域不触发平移缩放", () => {
    const { container } = render(<DeliveryProgress data={snapshot} />);
    const body = screen.getByRole("rowgroup", { name: /拖动平移/ });
    const axis = container.querySelector<HTMLElement>(".delivery-date-axis")!;
    const left = screen.getByText("SO1");
    const timeline = container.querySelector<HTMLElement>(".delivery-timeline")!;
    const capture = vi.fn();
    Object.defineProperty(body, "setPointerCapture", { value: capture });
    Object.defineProperty(axis, "offsetWidth", { value: 300 });
    axis.getBoundingClientRect = () => ({
        x: 400,
        y: 0,
        top: 0,
        left: 400,
        width: 300,
        height: 35,
        right: 700,
        bottom: 35,
        toJSON: () => ({}),
    });
    const pointer = (target: HTMLElement, type: string, x: number) =>
        fireEvent(target, new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 100 }));

    pointer(left, "pointerdown", 200);
    pointer(body, "pointermove", 100);
    pointer(body, "pointerup", 100);
    expect(capture).not.toHaveBeenCalled();
    expect(screen.getByText("10/01 — 10/15")).toBeInTheDocument();
    const leftWheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 });
    fireEvent(left, leftWheel);
    expect(leftWheel.defaultPrevented).toBe(false);
    expect(screen.getByText("10/01 — 10/15")).toBeInTheDocument();

    pointer(timeline, "pointerdown", 550);
    pointer(body, "pointermove", 450);
    pointer(body, "pointerup", 450);
    expect(capture).toHaveBeenCalledOnce();
    expect(screen.getByText("10/06 — 10/20")).toBeInTheDocument();
    const chartWheel = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -100,
        clientX: 550,
    });
    fireEvent(timeline, chartWheel);
    expect(chartWheel.defaultPrevented).toBe(true);
    expect(screen.queryByText("10/06 — 10/20")).not.toBeInTheDocument();
});

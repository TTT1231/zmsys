/* 演示数据自洽（自前端 test/mocks/workbench.test.ts 移植）：
 * 引用完整、出入库结存守恒、含逾期样本、可确定性重现。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { beijingToday, createWorkbenchDemo } from "./workbench.demo";

afterEach(() => {
    vi.useRealTimers();
});

describe("beijingToday", () => {
    it("UTC 日期跨入北京时间次日时返回正确的业务截至日", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-11T18:00:00Z"));
        expect(beijingToday()).toBe("2026-09-12");
    });
});

describe("createWorkbenchDemo", () => {
    it("订单引用已知 BOM 且发货不超订量；各 BOM 累计出入库差等于当前库存", () => {
        const data = createWorkbenchDemo("2026-09-12");
        expect(data.products).toHaveLength(9);
        for (const order of data.orders) {
            expect(data.products.some(product => product.code === order.bomCode)).toBe(true);
            expect(order.shipped).toBeLessThanOrEqual(order.qty);
        }
        for (const product of data.products) {
            const movements = data.movements.filter(row => row.bomCode === product.code);
            expect(movements.reduce((sum, row) => sum + row.inbound - row.outbound, 0)).toBe(product.stock);
        }
        expect(data.movements.every(row => row.date <= data.asOf)).toBe(true);
    });

    it("客户样本覆盖完整（至少 20 名）、存在已到期订单（交付风险有逾期样本）", () => {
        const data = createWorkbenchDemo("2026-09-12");
        expect(new Set(data.orders.map(order => order.customerCode)).size).toBeGreaterThanOrEqual(20);
        expect(data.orders.some(order => order.due < data.asOf)).toBe(true);
        expect(data.orders.some(order => order.cancelled)).toBe(true);
    });

    it("同日生成的数据确定性一致", () => {
        expect(createWorkbenchDemo("2026-09-12")).toEqual(createWorkbenchDemo("2026-09-12"));
    });
});

/* 演示数据覆盖有效关联、出入库结存守恒、交付风险与完整20名客户排行。 */
import { expect, it } from "vitest";
import { createWorkbenchDemo } from "../../mocks/data/workbench";
import { customerRanking, workbenchRisks } from "@/data/workbench";

it("所有订单引用已知BOM，累计出入库差与各BOM当前库存一致", () => {
    const data = createWorkbenchDemo("2026-09-12");
    expect(data.products).toHaveLength(15);
    for (const order of data.orders) {
        expect(data.products.some(product => product.code === order.bomCode)).toBe(true);
        expect(order.shipped).toBeLessThanOrEqual(order.qty);
    }
    for (const product of data.products) {
        const movements = data.movements.filter(row => row.bomCode === product.code);
        expect(movements.reduce((sum, row) => sum + row.inbound - row.outbound, 0)).toBe(product.stock);
    }
    expect(data.movements.every(row => row.date <= data.asOf)).toBe(true);
    expect(customerRanking(data.orders, "qty")).toHaveLength(20);
    expect(workbenchRisks(data).some(row => row.kind === "overdue")).toBe(true);
    expect(workbenchRisks(data).some(row => row.kind === "upcoming")).toBe(true);
    expect(createWorkbenchDemo("2026-09-12")).toEqual(data);
});

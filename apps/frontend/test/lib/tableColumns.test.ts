/* 列宽计算：相邻列守恒、固定操作列、极端拖动边界和容器剩余空间。 */
import { expect, it } from "vitest";
import { fitTableWidths, resizeTablePair } from "@/lib/tableColumns";
const columns = [
    { key: "name", width: 180, min: 120, max: 640 },
    { key: "spec", width: 240, min: 120, max: 640 },
    { key: "actions", width: 224, min: 224, max: 224, fixed: true },
];
it("剩余宽度分配给数据列，操作列忽略旧的错误宽度", () => {
    const widths = fitTableWidths(columns, { actions: 96 }, 1000);
    expect(widths.actions).toBe(224);
    expect(Object.values(widths).reduce((a, b) => a + b, 0)).toBe(1000);
});
it("大幅拖动受相邻列最小宽限制，表格总宽保持不变", () => {
    const widths = fitTableWidths(columns, {}, 644);
    const next = resizeTablePair(columns, widths, "name", 2000);
    expect(next).toEqual({ name: 300, spec: 120, actions: 224 });
    expect(resizeTablePair(columns, next, "actions", 640)).toEqual(next);
    expect(resizeTablePair(columns, next, "name", -100)).toEqual({ name: 120, spec: 300, actions: 224 });
});

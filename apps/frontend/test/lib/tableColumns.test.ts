import { expect, it } from "vitest";
import { fitTableWidths, resizeTableColumn } from "@/lib/tableColumns";
const columns = [
    { key: "name", width: 180, min: 120, max: 800 },
    { key: "spec", width: 360, min: 280, max: 800, grow: true },
    { key: "actions", width: 120, min: 120, max: 120, fixed: true },
];
it("推荐布局优先加宽产品信息，操作列不受存储的错误值影响", () => {
    expect(fitTableWidths(columns, { actions: 96 }, 1000)).toEqual({ name: 180, spec: 700, actions: 120 });
});
it("拖动只改变当前列，遵守自身边界且不能拖动操作列", () => {
    const widths = fitTableWidths(columns, {}, 660);
    const next = resizeTableColumn(columns, widths, "name", 2000);
    expect(next).toEqual({ name: 800, spec: 360, actions: 120 });
    expect(resizeTableColumn(columns, next, "actions", 640)).toEqual(next);
    expect(resizeTableColumn(columns, next, "name", -100)).toEqual({ name: 120, spec: 360, actions: 120 });
});
it("手动缩窄后不自动填满容器，其他列宽和用户调整保持不变", () => {
    expect(fitTableWidths(columns, { name: 150, spec: 300 }, 1600)).toEqual({ name: 150, spec: 300, actions: 120 });
});

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
it("手动缩窄后保留目标列宽，由未调整的内容列填满容器", () => {
    expect(fitTableWidths(columns, { name: 150 }, 1000)).toEqual({ name: 150, spec: 730, actions: 120 });
});
it("全部数据列均已手动调整时不篡改偏好，剩余宽度交给表格弹性区", () => {
    expect(fitTableWidths(columns, { name: 150, spec: 300 }, 1600)).toEqual({ name: 150, spec: 300, actions: 120 });
});
it("推荐宽度超出容器时先压内容列再压普通列，默认视图收进单屏", () => {
    // 660 → 540：先收 spec（360→280 到最小宽），剩余 40 再收 name（180→140）
    expect(fitTableWidths(columns, {}, 540)).toEqual({ name: 140, spec: 280, actions: 120 });
});
it("收窄不动手动宽度与操作列，列最小宽之和仍溢出时保留溢出", () => {
    // spec 手动 400 不动：只有 name 可收（180→120），表格仍比容器宽 100
    expect(fitTableWidths(columns, { spec: 400 }, 540)).toEqual({ name: 120, spec: 400, actions: 120 });
});

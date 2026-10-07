import { expect, it } from "vitest";
import { fitTableWidths, resizeTableColumn } from "@/lib/tableColumns";
const columns = [
    { key: "name", width: 180, min: 120, max: 800 },
    { key: "spec", width: 360, min: 280, max: 800, grow: true },
    // 操作列：fixed 不参与自动收缩/扩张，但手动宽度生效（min=推荐宽兜底内容，max 与普通列一致）
    { key: "actions", width: 120, min: 120, max: 800, fixed: true },
];
it("存储的过窄操作列被下限兜底，剩余宽度按占比摊给所有列", () => {
    // 340 富余按 180:360:120 占比摊分（多轮消化取整余数），操作列 96 被下限顶回 120
    expect(fitTableWidths(columns, { actions: 96 }, 1000)).toEqual({ name: 273, spec: 546, actions: 181 });
});
it("拖动只改变当前列并遵守自身边界，操作列同样可手动调宽", () => {
    const widths = fitTableWidths(columns, {}, 660);
    const next = resizeTableColumn(columns, widths, "name", 2000);
    expect(next).toEqual({ name: 800, spec: 360, actions: 120 });
    expect(resizeTableColumn(columns, next, "actions", 640)).toEqual({ name: 800, spec: 360, actions: 640 });
    expect(resizeTableColumn(columns, next, "name", -100)).toEqual({ name: 120, spec: 360, actions: 120 });
});
it("hold 的拖拽中列不参与分摊，其余列按占比吸收富余", () => {
    // 拖 name 至 120：400 富余按 360:120 占比只摊给 spec 与 actions，name 严格跟随指针
    expect(fitTableWidths(columns, { name: 120 }, 1000, { hold: "name" })).toEqual({
        name: 120,
        spec: 660,
        actions: 220,
    });
});
it("操作列手动宽度参与占比呼吸，溢出收缩仍不让位", () => {
    // 260 富余按 180:360:200 占比摊给全部列（含固定操作列）
    expect(fitTableWidths(columns, { actions: 200 }, 1000)).toEqual({ name: 244, spec: 486, actions: 270 });
    // 溢出时只收内容列（spec 到最小、name 随后），手动操作列不动
    expect(fitTableWidths(columns, { actions: 200 }, 540)).toEqual({ name: 120, spec: 280, actions: 200 });
});
it("手动缩窄后保留目标列宽，剩余宽度按占比摊给全部列", () => {
    expect(fitTableWidths(columns, { name: 150 }, 1000)).toEqual({ name: 239, spec: 571, actions: 190 });
});
it("全部列手动调整后仍按占比呼吸，存储值本身不被篡改", () => {
    // 570 富余恰好让所有列等比翻倍（150:300:120 → 300:600:240）；返回值是渲染宽，不含落盘语义
    expect(fitTableWidths(columns, { name: 150, spec: 300 }, 1140)).toEqual({ name: 300, spec: 600, actions: 240 });
});
it("推荐宽度超出容器时先压内容列再压普通列，默认视图收进单屏", () => {
    // 660 → 540：先收 spec（360→280 到最小宽），剩余 40 再收 name（180→140）
    expect(fitTableWidths(columns, {}, 540)).toEqual({ name: 140, spec: 280, actions: 120 });
});
it("紧凑档不向外分配剩余宽度，富余留给表格弹性区", () => {
    expect(fitTableWidths(columns, {}, 1000, { stretch: false })).toEqual({
        name: 180,
        spec: 360,
        actions: 120,
    });
});
it("紧凑档溢出时仍按最小宽收拢，账本模式不横向破版", () => {
    expect(fitTableWidths(columns, {}, 540, { stretch: false })).toEqual({ name: 140, spec: 280, actions: 120 });
});
it("收窄不动手动宽度与操作列，列最小宽之和仍溢出时保留溢出走横向滚动", () => {
    // spec 手动 400 不动：只有 name 可收（180→120），表格仍比容器宽 100；
    // 滚动时的可见锚点由各页 pinnedStart 固定列承担，这里不强行压进单屏
    expect(fitTableWidths(columns, { spec: 400 }, 540)).toEqual({ name: 120, spec: 400, actions: 120 });
});
it("极窄容器压到最小宽后保留溢出，不做无限压缩", () => {
    // 200 容器：自动列压到最小宽（120/280）仍放不下，保留溢出交横向滚动
    expect(fitTableWidths(columns, {}, 200)).toEqual({ name: 120, spec: 280, actions: 120 });
});

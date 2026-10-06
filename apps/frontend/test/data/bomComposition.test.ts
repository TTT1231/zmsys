/* 复合 BOM：复用新建目录归属，冻结物料不被新目录名称替换，旧数据不丢失。 */
import { expect, it } from "vitest";
import { bomComposition } from "@/data/bomComposition";
import { BOM_CATEGORIES } from "@/data/categories";
const body = { materialId: "3601", groupKey: "tipover-cover", groupName: "跌倒盖", name: "KW16 / 有CB字", quantity: 1 };
const oldMicro = { materialId: "3201", groupKey: "base", groupName: "底座", name: "历史名称保持原样", quantity: 1 };
it("跌倒本体与老微动分组，与新建时选择的目录一致", () => {
    const result = bomComposition({ name: "跌倒开关", items: [body, oldMicro] }, BOM_CATEGORIES);
    expect(result.series).toBe("老微动");
    expect(result.sections.map(section => section.title)).toEqual(["跌倒开关本体", "微动开关 · 老微动"]);
    expect(result.sections[1].items[0].name).toBe("历史名称保持原样");
});
it("新微动由真实物料 ID 归属识别；未知历史物料完整保留", () => {
    const item = { ...oldMicro, materialId: "3101" };
    expect(bomComposition({ name: "跌倒开关", items: [body, item] }, BOM_CATEGORIES).series).toBe("新微动");
    const unknown = { ...oldMicro, materialId: "retired" };
    const result = bomComposition({ name: "跌倒开关", items: [body, unknown] }, BOM_CATEGORIES);
    expect(result.series).toBe("系列待确认");
    expect(result.sections[1].items).toEqual([unknown]);
});
it("共享 ID 或没有目录时不猜系列；普通 BOM 不改变原展示", () => {
    const without = bomComposition({ name: "跌倒开关", items: [body, oldMicro] });
    expect(without.sections[0].items).toEqual([body]);
    expect(without.series).toBe("系列待确认");
    expect(bomComposition({ name: "老微动", items: [oldMicro] }, BOM_CATEGORIES).composite).toBe(false);
});

it("旧本体物料即使退出目录，也按冻结分组保留在本体中", () => {
    const retired = { ...body, materialId: "retired-body" };
    const result = bomComposition({ name: "跌倒开关", items: [retired, oldMicro] }, BOM_CATEGORIES);
    expect(result.sections[0].items).toEqual([retired]);
    expect(result.series).toBe("老微动");
});

/* 旋转XK3：接线工艺二分——主品类无自有目录，不输出空本体节，子件节直接以焊线/插线命名 */
const xk3Item = {
    materialId: "3401",
    groupKey: "pc-shell",
    groupName: "PC塑料外壳",
    name: "圆孔长外壳（茶色）",
    quantity: 1,
};
it("旋转XK3 无本体节，子件节不加前缀直接命名（不出现微动开关字样）", () => {
    const result = bomComposition({ name: "旋转XK3", items: [xk3Item] }, BOM_CATEGORIES);
    expect(result.composite).toBe(true);
    expect(result.sections.map(section => section.title)).toEqual(["插线"]);
    expect(result.series).toBe("插线");
    expect(result.childKind).toBe("接线工艺");
});
it("旋转XK3 的未知历史物料进系列待确认节，同样不冠微动开关", () => {
    const unknown = { ...xk3Item, materialId: "retired" };
    const result = bomComposition({ name: "旋转XK3", items: [unknown] }, BOM_CATEGORIES);
    expect(result.sections.map(section => section.title)).toEqual(["系列待确认"]);
    expect(result.series).toBe("系列待确认");
});

/* BOM 摘要：按品类选关键分组、保留同组多选，未知目录与旧数据安全降级。 */
import { expect, it } from "vitest";
import { bomSummary } from "@/data/bomSummary";
import { detailBom } from "../fixtures/recordDetails";
it("跳过普通盖子而保留底座和按钮，不改变原始物料顺序", () => {
    const original = [...detailBom.items];
    expect(bomSummary(detailBom)).toBe("底座：二脚底座（无挡脚） · 按钮：8.5mm");
    expect(detailBom.items).toEqual(original);
});
it("跌倒开关优先显示有无 CB 字的差异", () => {
    expect(
        bomSummary({
            name: "跌倒开关",
            spec: "",
            items: [
                ...detailBom.items,
                {
                    materialId: "tip",
                    groupKey: "tipover-cover",
                    groupName: "跌倒盖",
                    name: "KW16 / 无CB字",
                    quantity: 1,
                },
            ],
        }),
    ).toMatch(/^跌倒盖：KW16 \/ 无CB字/);
});
it("同组多选不丢失，未知品类和空清单安全降级", () => {
    expect(
        bomSummary({
            name: "未来品类",
            spec: "",
            items: [
                { materialId: "a", groupKey: "a", groupName: "触点", name: "银点", quantity: 1 },
                { materialId: "b", groupKey: "a", groupName: "触点", name: "铜点", quantity: 1 },
            ],
        }),
    ).toBe("触点：银点、铜点");
    expect(bomSummary({ name: "未知", spec: "旧摘要", items: [] })).toBe("旧摘要");
});

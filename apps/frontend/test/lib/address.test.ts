/* 地址展示：过滤历史占位值，部分地址与真实地名保持完整。 */
import { expect, it } from "vitest";
import { cleanAddressPart, regionText } from "@/lib/address";
it("空地区与重复待补充均返回空文本，交由页面统一显示一次未填写", () => {
    expect(regionText({ province: "待补充", city: "待补充", district: "", town: "" })).toBe("");
    expect(cleanAddressPart(" 未填写 ")).toBe("");
});
it("保留有效地区并跳过中间占位，真实地名不作子串删除", () => {
    expect(regionText({ province: "浙江省", city: "宁波市", district: "待补充", town: "" })).toBe("浙江省 宁波市");
    expect(cleanAddressPart("待补充村路8号")).toBe("待补充村路8号");
});

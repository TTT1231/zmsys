// @vitest-environment jsdom
/* 覆盖物料集合呈现：分组行、品类身份块、record 键值网格与 list 行内形态、摘要兜底。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BomSpecs } from "@/components/bom/BomSpecs";
import { BOM_CATEGORIES } from "@/data/categories";
import type { Bom } from "@/api";

afterEach(cleanup);

const rotaryBom: Bom = {
    code: "XK2001",
    name: "旋转XK2",
    modelCode: "1-1",
    spec: "型号：1-1 · 银丝厚度：0.2 · A面：A面银点",
    remark: "",
    creator: "郭均",
    created: "2026-09-13T02:13:00.000Z",
    unit: "个",
    items: [
        { materialId: "3001", groupKey: "model", groupName: "型号", name: "1-1", quantity: 1 },
        { materialId: "3003", groupKey: "silver-wire-thickness", groupName: "银丝厚度", name: "0.2", quantity: 1 },
        { materialId: "3006", groupKey: "face-a", groupName: "A面", name: "A面银点", quantity: 1 },
    ],
};

const microBom: Bom = {
    code: "KW042",
    name: "新微动",
    modelCode: "",
    spec: "底座：二脚底座（无挡脚） · 盖子：盖子 · 按钮：8.5mm",
    remark: "",
    creator: "郭均",
    created: "2026-09-13T02:13:00.000Z",
    unit: "个",
    items: [
        { materialId: "3101", groupKey: "base", groupName: "底座", name: "二脚底座（无挡脚）", quantity: 1 },
        { materialId: "3103", groupKey: "cover", groupName: "盖子", name: "盖子", quantity: 1 },
        { materialId: "3109", groupKey: "button", groupName: "按钮", name: "8.5mm", quantity: 1 },
    ],
};

it("详情形态按分组渲染物料行，型号不再作身份块特殊展示", () => {
    const { container } = render(<BomSpecs bom={rotaryBom} />);
    // 身份块只剩品类，无型号大字
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("品类");
    expect(screen.getByText(rotaryBom.name)).toBeInTheDocument();
    const dts = [...container.querySelectorAll("dt")].map(dt => dt.textContent);
    expect(dts).toEqual(["型号", "银丝厚度", "A面"]);
    expect(container.querySelectorAll("dd")[0]).toHaveTextContent("1-1");
    expect(container.querySelectorAll("dd")[1]).toHaveTextContent("0.2");
    // 摘要字段不再重复展示
    expect(screen.queryByText(rotaryBom.spec)).not.toBeInTheDocument();
});

it("身份块显示品类，物料行不受影响", () => {
    render(<BomSpecs bom={microBom} />);
    expect(screen.getByText(microBom.name)).toBeInTheDocument();
    expect(screen.getByText("二脚底座（无挡脚）")).toBeInTheDocument();
});

it("record 形态呈两列键值网格，list 形态保持「组名：物料名」行内", () => {
    const { rerender, container } = render(<BomSpecs bom={microBom} layout="record" />);
    const dts = [...container.querySelectorAll("dt")].map(dt => dt.textContent);
    expect(dts).toEqual(["底座", "盖子", "按钮"]);
    expect(container.querySelector("dd")).toHaveTextContent("二脚底座（无挡脚）");
    rerender(<BomSpecs bom={microBom} layout="list" showIdentity={false} />);
    expect(screen.getByText(/盖子：/)).toBeInTheDocument();
});

it("多选组同名分组的物料以顿号连接", () => {
    const multi: Bom = {
        ...microBom,
        items: [
            { materialId: "1", groupKey: "cards", groupName: "卡板", name: "大卡板18mm", quantity: 1 },
            { materialId: "2", groupKey: "cards", groupName: "卡板", name: "短卡板16mm", quantity: 1 },
        ],
    };
    const { container } = render(<BomSpecs bom={multi} />);
    expect(container.querySelectorAll("dd")[0]).toHaveTextContent("大卡板18mm、短卡板16mm");
});

it("没有结构化明细时保留摘要兜底，全空显示占位文案", () => {
    const { rerender } = render(<BomSpecs bom={{ ...microBom, items: [] }} />);
    expect(screen.getByText(microBom.spec)).toBeInTheDocument();
    rerender(<BomSpecs bom={{ ...microBom, items: [], spec: "" }} />);
    expect(screen.getByText("暂无物料信息")).toBeInTheDocument();
});

it("跌倒开关按新建目录分为本体和老微动，详情和行内展开保持同一结构", () => {
    const bom = {
        ...microBom,
        name: "跌倒开关",
        items: [
            {
                materialId: "3601",
                groupKey: "tipover-cover",
                groupName: "跌倒盖",
                name: "跌倒盖KW16 / 有CB字",
                quantity: 1,
            },
            { materialId: "3201", groupKey: "base", groupName: "底座", name: "带CB", quantity: 1 },
        ],
    };
    const { rerender } = render(<BomSpecs bom={bom} categories={BOM_CATEGORIES} />);
    expect(
        within(screen.getByRole("region", { name: "跌倒开关本体" })).getByText("跌倒盖KW16 / 有CB字"),
    ).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "微动开关 · 老微动" })).getByText("带CB")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "跌倒开关本体" })).queryByText("带CB")).not.toBeInTheDocument();
    rerender(<BomSpecs bom={bom} categories={BOM_CATEGORIES} layout="list" showIdentity={false} />);
    expect(screen.getByRole("region", { name: "微动开关 · 老微动" })).toHaveTextContent("带CB");
});

it("旋转XK3 详情不输出空的本体节，子件节按接线工艺命名", () => {
    const bom = {
        ...microBom,
        code: "XK3005",
        name: "旋转XK3",
        items: [
            {
                materialId: "3401",
                groupKey: "pc-shell",
                groupName: "PC塑料外壳",
                name: "圆孔长外壳（茶色）",
                quantity: 1,
            },
            { materialId: "3406", groupKey: "pc-base", groupName: "PC塑料底座", name: "底座：茶色", quantity: 1 },
        ],
    };
    render(<BomSpecs bom={bom} categories={BOM_CATEGORIES} />);
    expect(screen.queryByRole("region", { name: "旋转XK3本体" })).not.toBeInTheDocument();
    const section = screen.getByRole("region", { name: "接线工艺 · 插线" });
    expect(section).toHaveTextContent("圆孔长外壳（茶色）");
    expect(section).toHaveTextContent("2 项物料");
});

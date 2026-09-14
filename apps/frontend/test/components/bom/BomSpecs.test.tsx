// @vitest-environment jsdom
/* 覆盖五类规格完整呈现、组合部件数量、固定规格分层与未知字段兼容。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BomSpecs } from "@/components/bom/BomSpecs";
import type { Bom, BomCategory } from "@/api";

afterEach(cleanup);

const examples: Pick<Bom, "name" | "modelCode" | "specs">[] = [
    {
        name: "琴键开关",
        modelCode: "KQ-6",
        specs: {
            类型: "冷风扇琴键（透明大功率带触点）",
            卡板: "小卡板18mm+大卡板18mm",
            弹簧: "0.35",
            触点: "带点",
            五金件明细: "扣板×2+连锁片+带点静片+带点动片+辅助动片",
        },
    },
    { name: "老微动", modelCode: "KW16", specs: { 底座: "不带CB", 按钮: "9.6mm", 弹簧: "0.27" } },
    {
        name: "新微动",
        modelCode: "KW",
        specs: {
            底座: "三脚底座（有挡脚）",
            按钮高度: "9.1mm",
            支架: "4.8支架：复合铜镀镍",
            静片: "4.8静片：复合铜镀镍",
            动片: "镀锡",
            摆片: "铁镀镍摆片",
            弹片: "0.12",
        },
    },
    {
        name: "XK3",
        modelCode: "XK3",
        specs: {
            外壳: "无耳外壳无CB字（茶色）",
            底座: "透明",
            杆子: "扁轴4.8转90°",
            小静片: "镀锡",
            半圆静片: "镀锡",
            动片: "镀锡",
            卡线片: "0.2",
            弹簧: "0.45短弹簧",
        },
    },
    { name: "旋转开关", modelCode: "3-1", specs: { 脚位: "五脚", 档位: "三档", 银点厚度: "0.2", 弹簧: "0.5" } },
];

it.each(examples)("$name 的字段和值完整保留，型号只在标识处出现", example => {
    const bom = { ...example, spec: "旧的拼接摘要" };
    const { container } = render(<BomSpecs bom={bom} />);
    expect(container.querySelector("strong")).toHaveTextContent(bom.modelCode);
    for (const [key, value] of Object.entries(bom.specs)) {
        const label = [...container.querySelectorAll("dt")].find(item => item.textContent === key);
        expect(label).toBeDefined();
        for (const part of value.split("+")) expect(label?.nextElementSibling).toHaveTextContent(part);
    }
    expect(screen.queryByText(bom.spec)).not.toBeInTheDocument();
});

it("组合部件逐项呈现并保留数量，不拆解自定义字段中的加号", () => {
    const bom = { ...examples[0], specs: { ...examples[0].specs, 公差: "+0.2/-0.1" }, spec: "" };
    render(<BomSpecs bom={bom} layout="list" showIdentity={false} />);
    const parts = screen.getByRole("list", { name: "五金件明细" });
    expect(parts.querySelectorAll("li")).toHaveLength(5);
    expect(parts.querySelector("li")).toHaveTextContent("扣板×2");
    expect(screen.getByText("+0.2/-0.1")).toBeInTheDocument();
});

it("按接口目录识别固定项，修改过的固定值与新增字段仍作为区分规格展示", () => {
    const bom = {
        ...examples[1],
        specs: { 底座: "不带CB", 支架: "6.3镀银", 静片: "特殊镀层", 新增字段: "新值" },
        spec: "",
    };
    const category: BomCategory = {
        key: "old",
        name: "老微动",
        codePrefix: "KW16",
        fields: [
            { key: "底座", label: "底座", type: "text" },
            { key: "支架", label: "支架", type: "text", defaultValue: "6.3镀银" },
            { key: "静片", label: "静片", type: "text", defaultValue: "6.3镀银" },
        ],
    };
    const { rerender } = render(<BomSpecs bom={bom} category={category} layout="list" />);
    expect(screen.queryByText("6.3镀银")).not.toBeInTheDocument();
    expect(screen.getByText("特殊镀层")).toBeInTheDocument();
    expect(screen.getByText("新值")).toBeInTheDocument();
    rerender(<BomSpecs bom={bom} category={category} />);
    expect(screen.getByText("品类固定规格").parentElement).toHaveTextContent("6.3镀银");
});

it("没有目录时保留全部字段，没有结构化字段时保留摘要兜底", () => {
    const bom = { ...examples[1], spec: "历史规格：特殊底座" };
    const { rerender } = render(<BomSpecs bom={bom} layout="list" />);
    expect(screen.getByText("不带CB")).toBeInTheDocument();
    rerender(<BomSpecs bom={{ ...bom, specs: {} }} />);
    expect(screen.getByText(bom.spec)).toBeInTheDocument();
    rerender(<BomSpecs bom={{ ...bom, specs: {}, spec: "" }} />);
    expect(screen.getByText("暂无规格信息")).toBeInTheDocument();
});

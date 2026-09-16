// @vitest-environment jsdom
/* 订单成品摘要：预览前三项物料与余量计数，缺失数据降级为摘要/占位符。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BomCell } from "@/components/bom/BomCell";
import { detailBom } from "../../fixtures/recordDetails";
afterEach(cleanup);

it("预览前三项物料并标注总数，完整内容保留在悬停提示中", () => {
    render(<BomCell bom={detailBom} bomCode={detailBom.code} />);
    expect(screen.getByText(detailBom.code)).toBeInTheDocument();
    expect(screen.getByText(/底座：/).closest("li")).toHaveTextContent("二脚底座（无挡脚）");
    expect(screen.getByText(/按钮：/).closest("li")).toHaveTextContent("8.5mm");
    // 只预览前三项：支架/静片不占位，数量以“等 N 项物料”提示
    expect(screen.queryByText(/静片：/)).not.toBeInTheDocument();
    expect(screen.getByText("等 5 项物料")).toBeInTheDocument();
    expect(screen.getByTitle("底座：二脚底座（无挡脚）")).toHaveTextContent("二脚底座（无挡脚）");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("缺失 BOM 时保留编码与占位文案", () => {
    const { rerender } = render(<BomCell bomCode="MISSING" />);
    expect(screen.getByText("MISSING")).toBeInTheDocument();
    expect(screen.getByText("暂无物料信息")).toBeInTheDocument();
    rerender(<BomCell bom={{ ...detailBom, items: [] }} bomCode={detailBom.code} />);
    expect(screen.getByTitle(detailBom.spec)).toHaveTextContent(detailBom.spec);
});

it("型号不再独立展示：编码旁只保留品类名", () => {
    render(<BomCell bom={{ ...detailBom, modelCode: "2-1" }} bomCode={detailBom.code} />);
    expect(screen.queryByText("2-1")).not.toBeInTheDocument();
    expect(screen.getByText(detailBom.name)).toBeInTheDocument();
});

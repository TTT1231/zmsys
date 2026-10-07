// @vitest-environment jsdom
/* BOM 紧凑摘要保留关键差异，完整冻结清单可显式展开核对。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { BomCell } from "@/components/bom/BomCell";
import { BOM_CATEGORIES } from "@/data/categories";
import { detailBom } from "../../fixtures/recordDetails";
afterEach(cleanup);
it("摘要显示关键分组，展开后能核对全部物料", async () => {
    const user = userEvent.setup();
    render(<BomCell bom={detailBom} bomCode={detailBom.code} />);
    expect(screen.getByText(detailBom.code)).toBeInTheDocument();
    expect(screen.getByTitle("底座：二脚底座（无挡脚） · 按钮：8.5mm")).toBeInTheDocument();
    const summary = screen.getByText("查看物料（5）");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(summary);
    expect(screen.getByRole("dialog", { name: detailBom.code })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("6.3静片：铜镀银");
});
it("缺失 BOM 保留编码和占位，旧档案使用完整旧摘要", () => {
    const { rerender } = render(<BomCell bomCode="MISSING" />);
    expect(screen.getByText("MISSING")).toBeInTheDocument();
    expect(screen.getByText("暂无物料信息")).toBeInTheDocument();
    rerender(<BomCell bom={{ ...detailBom, items: [] }} bomCode={detailBom.code} />);
    expect(screen.getByTitle(detailBom.spec)).toHaveTextContent(detailBom.spec);
});
it("BOM 表中可省略重复编码与品类，保留物料核对入口", () => {
    render(<BomCell bom={detailBom} bomCode={detailBom.code} showIdentity={false} />);
    expect(screen.queryByText(detailBom.code)).not.toBeInTheDocument();
    expect(screen.getByText("查看物料（5）")).toBeInTheDocument();
});
it("复合品类列表行的子选系列：旋转XK3 为焊线工艺，不出现微动组件字样", () => {
    const xk3 = {
        ...detailBom,
        name: "旋转XK3",
        items: [
            {
                materialId: "3401",
                groupKey: "pc-shell",
                groupName: "PC塑料外壳",
                name: "圆孔长外壳（茶色）",
                quantity: 1,
            },
        ],
    };
    render(<BomCell bom={xk3} bomCode="XK3005" categories={BOM_CATEGORIES} />);
    expect(screen.getByText("焊线工艺：插线")).toBeInTheDocument();
    expect(screen.queryByText(/微动/)).not.toBeInTheDocument();
});

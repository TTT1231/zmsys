// @vitest-environment jsdom
/* 共用凭证区块保留规格、缺失 BOM 编码与完整备注，数量单独呈现。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RecordFields, RecordProduct, RecordSummary } from "@/components/business/RecordDetails";
import { detailBom } from "../../fixtures/recordDetails";
afterEach(cleanup);

it("成品规格保留部件与数量，BOM 缺失仍能核对编码", () => {
    const { rerender } = render(<RecordProduct bom={detailBom} bomCode={detailBom.code} categories={[]} />);
    expect(screen.getByRole("region", { name: "成品规格" })).toHaveTextContent("扣板×2");
    expect(screen.getByText("辅助动片")).toBeInTheDocument();
    expect(screen.queryByText(detailBom.spec)).not.toBeInTheDocument();
    rerender(<RecordProduct bomCode={detailBom.code} categories={[]} />);
    expect(screen.getByText(detailBom.code)).toBeInTheDocument();
    expect(screen.getByText("未找到该成品的规格信息")).toBeInTheDocument();
});
it("零数量、状态和换行备注完整显示", () => {
    render(
        <>
            <RecordSummary metrics={[{ label: "入库数量", value: 0 }]} status="已作废" />
            <RecordFields title="登记信息" items={[{ label: "备注", value: "第一行\n第二行", fullWidth: true }]} />
        </>,
    );
    expect(screen.getByRole("region", { name: "数量与状态" })).toHaveTextContent("0件");
    expect(screen.getByRole("region", { name: "登记信息" })).toHaveTextContent("第一行 第二行");
});

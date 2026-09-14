// @vitest-environment jsdom
/* 订单成品摘要保留原值供悬停与详情核对，跳过目录固定项并处理缺失数据。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BomCell } from "@/components/bom/BomCell";
import { detailBom } from "../../fixtures/recordDetails";
afterEach(cleanup);

it("预览三项规格且不重复型号，长值的完整内容保留在悬停提示中", () => {
    const { container } = render(<BomCell bom={detailBom} bomCode={detailBom.code} />);
    expect(container.querySelectorAll("dt")).toHaveLength(3);
    expect(screen.getAllByText("KQ-6")).toHaveLength(1);
    expect(screen.getByText(detailBom.specs.类型)).toBeInTheDocument();
    expect(screen.queryByText(detailBom.spec)).not.toBeInTheDocument();
    expect(screen.getByTitle(detailBom.specs.卡板)).toHaveTextContent(detailBom.specs.卡板);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("固定规格不占预览名额", () => {
    render(
        <BomCell
            bom={detailBom}
            bomCode={detailBom.code}
            category={{
                key: "piano",
                name: detailBom.name,
                codePrefix: "KQ",
                fields: [{ key: "类型", label: "类型", type: "text", defaultValue: detailBom.specs.类型 }],
            }}
        />,
    );
    expect(screen.queryByText(detailBom.specs.类型)).not.toBeInTheDocument();
    expect(screen.getByText("带点")).toBeInTheDocument();
});
it("缺失 BOM 时保留编码，历史摘要保留完整提示", () => {
    const { rerender } = render(<BomCell bomCode="MISSING" />);
    expect(screen.getByText("MISSING")).toBeInTheDocument();
    expect(screen.getByText("暂无规格信息")).toBeInTheDocument();
    rerender(<BomCell bom={{ ...detailBom, specs: {} }} bomCode={detailBom.code} />);
    expect(screen.getByTitle(detailBom.spec)).toHaveTextContent(detailBom.spec);
});

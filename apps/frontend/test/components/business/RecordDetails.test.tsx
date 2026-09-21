// @vitest-environment jsdom
/* 共用凭证区块：详情两列键值网格、头部只显 BOM 编码、缺失兜底与备注换行。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RecordFields, RecordProduct, RecordSummary } from "@/components/business/RecordDetails";
import { detailBom } from "../../fixtures/recordDetails";
afterEach(cleanup);

it("详情呈两列键值网格，头部只显 BOM 编码，BOM 缺失仍能核对编码", () => {
    const { rerender, container } = render(<RecordProduct bom={detailBom} bomCode={detailBom.code} />);
    const region = screen.getByRole("region", { name: "详情" });
    expect(region).toHaveTextContent("二脚底座（无挡脚）");
    // 头部裸显编码，无「BOM 编码」前缀杂项文字
    expect(screen.getByText(detailBom.code)).toBeInTheDocument();
    expect(region).not.toHaveTextContent("BOM 编码");
    // 分组名与物料名分列呈现，不再是「组名：物料」行内流式
    const dts = [...container.querySelectorAll("dt")].map(dt => dt.textContent);
    expect(dts).toEqual(["底座", "盖子", "按钮", "支架", "静片"]);
    expect([...container.querySelectorAll("dd")].map(dd => dd.textContent)).toContain("6.3静片：铜镀银");
    expect(screen.queryByText(detailBom.spec)).not.toBeInTheDocument();
    rerender(<RecordProduct bomCode={detailBom.code} />);
    expect(screen.getByText(detailBom.code)).toBeInTheDocument();
    expect(screen.getByText("未找到该成品的物料信息")).toBeInTheDocument();
});
it("BOM 备注随凭证固定展示：空备注显示 —，有备注保留换行", () => {
    const { rerender } = render(<RecordProduct bom={detailBom} bomCode={detailBom.code} />);
    expect(screen.getByText(/BOM 备注：/).textContent).toBe("BOM 备注：—");
    rerender(<RecordProduct bom={{ ...detailBom, remark: "第一行\n第二行" }} bomCode={detailBom.code} />);
    expect(screen.getByText(/BOM 备注：/).textContent).toBe("BOM 备注：第一行\n第二行");
});
it("零数量、状态和换行备注完整显示", () => {
    render(
        <>
            <RecordSummary metrics={[{ label: "入库数量", value: 0 }]} status="已作废" />
            <RecordFields title="登记信息" items={[{ label: "备注", value: "第一行\n第二行", fullWidth: true }]} />
        </>,
    );
    expect(screen.getByRole("region", { name: "数量与状态" })).toHaveTextContent("0个");
    expect(screen.getByRole("region", { name: "登记信息" })).toHaveTextContent("第一行 第二行");
});

// @vitest-environment jsdom
// EmptyRow：row-empty 占位行跨列居中，空态文案经由 EmptyState 渲染
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { EmptyRow } from "@/components/ui/EmptyRow";

afterEach(cleanup);

it("渲染 row-empty 行并按传入列数跨列", () => {
    render(
        <table>
            <tbody>
                <EmptyRow colSpan={9} description="没有找到匹配的客户" />
            </tbody>
        </table>,
    );
    const cell = screen.getByText("没有找到匹配的客户").closest("td");
    expect(cell).toHaveAttribute("colspan", "9");
    expect(cell).toHaveClass("text-center");
    expect(cell?.parentElement).toHaveClass("row-empty");
});

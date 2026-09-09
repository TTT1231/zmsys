// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchSelect } from "@/components/ui/SearchSelect";

afterEach(cleanup);

const options = [
    { value: "ZMXK001", label: "二脚 / 一档" },
    { value: "ZMXK002", label: "三脚 / 两档" },
    { value: "ZMDD001", label: "±30° 常开" },
];

describe("SearchSelect", () => {
    it("renders all options initially and keeps the selected one", () => {
        render(<SearchSelect label="BOM" value="ZMXK001" onChange={() => {}} options={options} />);
        const select = screen.getByLabelText("BOM");
        expect(select.querySelectorAll("option")).toHaveLength(4); // 3 options + placeholder
        expect(screen.getByText("二脚 / 一档")).toBeInTheDocument();
    });

    it("narrows options by search keyword", () => {
        render(<SearchSelect label="BOM" value="" onChange={() => {}} options={options} />);
        fireEvent.change(screen.getByRole("searchbox", { name: "搜索BOM" }), { target: { value: "三脚" } });
        const select = screen.getByLabelText("BOM");
        expect(select.querySelectorAll("option")).toHaveLength(2);
        expect(screen.getByText("三脚 / 两档")).toBeInTheDocument();
        expect(screen.queryByText("二脚 / 一档")).not.toBeInTheDocument();
    });

    it("keeps the current value visible even when it does not match the query", () => {
        render(<SearchSelect label="BOM" value="ZMDD001" onChange={() => {}} options={options} />);
        fireEvent.change(screen.getByRole("searchbox", { name: "搜索BOM" }), { target: { value: "三脚" } });
        expect(screen.getByText("±30° 常开")).toBeInTheDocument();
    });

    it("shows no-match placeholder when search empties the list", () => {
        render(<SearchSelect label="BOM" value="" onChange={() => {}} options={options} />);
        fireEvent.change(screen.getByRole("searchbox", { name: "搜索BOM" }), { target: { value: "不存在的规格" } });
        expect(screen.getByText("没有匹配结果，请调整搜索")).toBeInTheDocument();
    });

    it("emits the chosen value and error state", () => {
        const onChange = vi.fn();
        render(<SearchSelect label="BOM" value="" onChange={onChange} options={options} error="请选择 BOM" />);
        expect(screen.getByRole("alert")).toHaveTextContent("请选择 BOM");
        fireEvent.change(screen.getByLabelText("BOM"), { target: { value: "ZMXK002" } });
        expect(onChange).toHaveBeenCalledWith("ZMXK002");
    });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DateField, Field, SelectField, TextArea, TextField } from "@/components/ui/Field";

afterEach(cleanup);

describe("TextField", () => {
    it("renders label with required mark and wires controlled input", () => {
        const onChange = vi.fn();
        render(<TextField label="数量" required value="10" onChange={onChange} />);
        // label 包裹整个 Field，必填星号/错误文案会并入可访问名，用正则匹配
        const input = screen.getByRole("textbox", { name: /数量/ }) as HTMLInputElement;
        expect(input).toHaveValue("10");
        expect(input).toHaveAttribute("aria-required", "true");
        expect(screen.getByText("*")).toBeInTheDocument();
        fireEvent.change(input, { target: { value: "12" } });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("shows error with alert role and aria-invalid", () => {
        render(<TextField label="数量" error="数量必须为正整数" onChange={() => {}} />);
        const input = screen.getByRole("textbox", { name: /数量/ });
        expect(input).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByRole("alert")).toHaveTextContent("数量必须为正整数");
    });

    it("shows hint when there is no error", () => {
        render(<TextField label="备注" hint="可选" onChange={() => {}} />);
        expect(screen.getByText("可选")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
});

describe("DateField / SelectField / TextArea", () => {
    it("renders date input type", () => {
        render(<DateField label="入库日期" value="2026-03-15" onChange={() => {}} />);
        expect(screen.getByLabelText("入库日期")).toHaveAttribute("type", "date");
    });

    it("emits selected value from select", () => {
        const onChange = vi.fn();
        render(
            <SelectField label="品类" value="x" onChange={onChange}>
                <option value="x">旋转XK2</option>
                <option value="y">琴键开关</option>
            </SelectField>,
        );
        fireEvent.change(screen.getByLabelText("品类"), { target: { value: "y" } });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("emits typed text from textarea", () => {
        const onChange = vi.fn();
        render(<TextArea label="备注" value="" onChange={onChange} />);
        fireEvent.change(screen.getByLabelText("备注"), { target: { value: "加急" } });
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

describe("Field layout wrapper", () => {
    it("renders label and children", () => {
        render(
            <Field label="自定义">
                <input type="checkbox" />
            </Field>,
        );
        expect(screen.getByText("自定义")).toBeInTheDocument();
        expect(screen.getByRole("checkbox")).toBeInTheDocument();
    });
});

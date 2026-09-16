// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SelectMenuField } from "@/components/ui/SelectMenuField";

afterEach(cleanup);

const openMenu = () => {
    const trigger = screen.getByRole("button", { name: "品类" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    return trigger;
};

describe("SelectMenuField", () => {
    it("shows the placeholder and exposes its expanded state", () => {
        render(
            <SelectMenuField
                label="品类"
                value=""
                placeholder="请选择品类"
                options={[{ value: "旋转XK2", label: "旋转XK2" }]}
                onValueChange={() => {}}
            />,
        );

        const trigger = screen.getByRole("button", { name: /品类/ });
        expect(trigger).toHaveTextContent("请选择品类");
        expect(trigger).toHaveAttribute("aria-expanded", "false");
        openMenu();
        expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    it("marks required and invalid fields and shows the related error", () => {
        render(
            <SelectMenuField
                label="品类"
                value=""
                placeholder="请选择品类"
                options={[]}
                onValueChange={() => {}}
                required
                error="请选择成品"
            />,
        );

        const trigger = screen.getByRole("button", { name: /品类/ });
        expect(trigger).toHaveAttribute("aria-required", "true");
        expect(trigger).toHaveAttribute("aria-invalid", "true");
        expect(trigger).toHaveAccessibleDescription("请选择成品");
        expect(screen.getByRole("alert")).toHaveTextContent("请选择成品");
    });

    it("renders the menu in a portal and emits the selected value", async () => {
        const onValueChange = vi.fn();
        render(
            <div data-testid="field-parent">
                <SelectMenuField
                    label="品类"
                    value=""
                    placeholder="请选择品类"
                    options={[
                        { value: "旋转XK2", label: "旋转XK2" },
                        { value: "琴键开关", label: "琴键开关" },
                    ]}
                    onValueChange={onValueChange}
                />
            </div>,
        );

        openMenu();
        const option = await screen.findByRole("menuitemradio", { name: "琴键开关" });
        expect(screen.getByRole("menu")).not.toBe(screen.getByTestId("field-parent"));
        fireEvent.click(option);
        await waitFor(() => expect(onValueChange).toHaveBeenCalledWith("琴键开关"));
    });
});

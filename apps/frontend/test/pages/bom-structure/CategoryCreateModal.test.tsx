// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CategoryCreateModal } from "@/pages/bom-structure/CategoryCreateModal";

afterEach(cleanup);

it("类型只需名称，空白和去除首尾空格后的重名会阻止创建", async () => {
    const user = userEvent.setup();
    const onDraft = vi.fn();
    render(<CategoryCreateModal open onClose={vi.fn()} onDraft={onDraft} />);

    await user.type(screen.getByRole("textbox", { name: /品类名称/ }), "全微动");
    await user.type(screen.getByRole("textbox", { name: /编号开头/ }), "QA");
    await user.click(screen.getByRole("checkbox", { name: "再分几种类型" }));
    expect(screen.queryByRole("textbox", { name: /代号/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "类型 1 名称" }), "新微动");
    await user.click(screen.getByRole("button", { name: "添加类型" }));
    await user.type(screen.getByRole("textbox", { name: "类型 2 名称" }), " ");
    await user.click(screen.getByRole("button", { name: "创建品类" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请填写每个类型的名称");
    expect(onDraft).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: "类型 2 名称" }), "新微动 ");
    await user.click(screen.getByRole("button", { name: "创建品类" }));
    expect(screen.getByRole("alert")).toHaveTextContent("品类和类型的名称不能重复");
    expect(onDraft).not.toHaveBeenCalled();

    await user.clear(screen.getByRole("textbox", { name: "类型 2 名称" }));
    await user.type(screen.getByRole("textbox", { name: "类型 2 名称" }), "老微动");
    await user.click(screen.getByRole("button", { name: "创建品类" }));
    expect(onDraft).toHaveBeenCalledWith({ name: "全微动", codePrefix: "QA", typeNames: ["新微动", "老微动"] });
}, 15000);

it("取消再分类型后，未填写的类型行不参与创建", async () => {
    const user = userEvent.setup();
    const onDraft = vi.fn();
    render(<CategoryCreateModal open onClose={vi.fn()} onDraft={onDraft} />);

    await user.type(screen.getByRole("textbox", { name: /品类名称/ }), "全微动");
    await user.type(screen.getByRole("textbox", { name: /编号开头/ }), "QA");
    const hasTypes = screen.getByRole("checkbox", { name: "再分几种类型" });
    await user.click(hasTypes);
    await user.type(screen.getByRole("textbox", { name: "类型 1 名称" }), "A");
    await user.click(screen.getByRole("button", { name: "添加类型" }));
    await user.click(hasTypes);
    await user.click(screen.getByRole("button", { name: "创建品类" }));
    expect(onDraft).toHaveBeenCalledWith({ name: "全微动", codePrefix: "QA", typeNames: [] });
}, 15000);

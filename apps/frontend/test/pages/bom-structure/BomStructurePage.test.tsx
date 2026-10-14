// @vitest-environment jsdom
/* BOM 结构页（重构版）：品类折叠面板与复合分节视图、草稿投影（新增分组/设为不可选
 * 所见即所存）、撤销重做、保存 payload（品类 key + 乐观锁版本 + ops）、409 版本冲突
 * 保留草稿并提供「拉取最新结构」。 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { BomStructurePage } from "@/pages/bom-structure/BomStructurePage";
import { BOM_CATEGORIES } from "@/data/categories";
import { ApiError } from "@/http/errors";
import type { BomCategory, StructureOperation } from "@/api";

vi.mock("@/context/useApp", () => ({ useApp: () => ({ can: () => true }) }));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const catalogRef = vi.hoisted(() => ({ current: undefined as BomCategory[] | undefined }));
const applyRef = vi.hoisted(() => ({
    current: vi.fn<(...args: unknown[]) => Promise<{ rowVersion: number }>>(),
}));
const deleteRef = vi.hoisted(() => ({ current: vi.fn() }));

vi.mock("@/data/queries", () => ({
    bomKeys: { all: ["boms"], list: ["boms", "list"], categories: ["boms", "categories"], stocks: ["boms", "stocks"] },
    wbKeys: { all: ["workbench"] },
    useBomCategories: () => ({ data: catalogRef.current, isLoading: false }),
    useCreateBomCategory: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteBomCategory: () => ({ mutate: deleteRef.current, isPending: false }),
}));

vi.mock("@/api", async importOriginal => {
    const actual = await importOriginal<typeof import("@/api")>();
    return { ...actual, applyBomStructure: (...args: unknown[]) => applyRef.current(...args) };
});

const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
    useQueryClient: () => ({ invalidateQueries }),
}));

beforeEach(() => {
    catalogRef.current = BOM_CATEGORIES;
    applyRef.current = vi.fn().mockResolvedValue({ rowVersion: 2 });
    deleteRef.current = vi.fn();
});

/* jsdom 缺少指针捕获 API（Radix DropdownMenu 打开依赖）与 scrollIntoView */
beforeAll(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    cleanup();
    invalidateQueries.mockClear();
});

it("品类折叠面板：容器品类嵌套展开，点选下属类型展示复合分节视图", async () => {
    const user = userEvent.setup();
    render(<BomStructurePage />);
    // 默认选中首个品类（旋转XK2），树与统计立即可见
    expect(screen.getByText("型号", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/\d+ 个分组 · \d+ 项物料/)).not.toBeInTheDocument();

    // 旋转XK3 是带下属类型的分支：点开显示 焊线/插线（不再平铺、无「目录容器」标记）
    expect(screen.queryByText("焊线", { exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /旋转XK3/ }));
    await user.click(screen.getByRole("button", { name: "焊线" }));
    // 复合视图：主品类无自有目录 → 只有本品「焊线工艺」一节，分组树来自容器快照
    expect(screen.getByText("焊线工艺")).toBeInTheDocument();
    expect(screen.getByText("PC塑料", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("静片", { exact: true })).toBeInTheDocument();

    // 跌倒开关（主品类有共用目录）：下属类型视图 = 共用结构 + 本品结构 两节
    await user.click(screen.getByRole("button", { name: /跌倒开关/ }));
    expect(screen.getByRole("button", { name: /旋转XK3/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "焊线" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新微动跌倒" }));
    expect(screen.getByText("跌倒开关类型")).toBeInTheDocument();
    expect(screen.getByText("微动开关类型")).toBeInTheDocument();
    expect(screen.getByText("跌倒盖", { exact: true })).toBeInTheDocument();
}, 30000);

it("草稿投影所见即所存：新增分组（含随组物料）、设为不可选后保存携带版本与 ops", async () => {
    const user = userEvent.setup();
    render(<BomStructurePage />);

    await user.click(screen.getByRole("button", { name: "添加内容" }));
    await user.click(screen.getByRole("radio", { name: "分组" }));
    await user.type(screen.getByPlaceholderText("如：五金件"), "弹静片");
    await user.click(screen.getByRole("button", { name: "添加分组" }));
    expect(screen.getByText("弹静片", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("未保存 1 条")).toBeInTheDocument();

    // 设为不可选（物料行走右键菜单）：立即出现「不可选」角标（投影生效，不等待保存）
    fireEvent.contextMenu(screen.getByRole("button", { name: "0-2" }));
    await user.click(screen.getByRole("menuitem", { name: "设置为不可选" }));
    expect(screen.getByText("不可选", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("未保存 2 条")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /保存结构/ }));
    await waitForApply();
    expect(applyRef.current).toHaveBeenCalledTimes(1);
    const [input] = applyRef.current.mock.calls[0] as [
        { categoryKey: string; expectedRowVersion: number; operations: StructureOperation[] },
    ];
    expect(input.categoryKey).toBe("rotary-switch");
    expect(input.expectedRowVersion).toBe(1);
    const folder = input.operations.find(op => op.type === "add_group");
    expect(folder).toMatchObject({ name: "弹静片", parentId: null, multi: false, qty: false });
    expect(folder).not.toHaveProperty("items");
    expect(input.operations).toContainEqual({ type: "hide", targetType: "item", targetId: "3051" });

    // 保存成功：草稿清空回到「已保存」
    await act(async () => {});
    expect(screen.getByText("已保存")).toBeInTheDocument();
}, 30000);

it("撤销/重做：新增分组可撤销找回，重做恢复", async () => {
    const user = userEvent.setup();
    render(<BomStructurePage />);
    await user.click(screen.getByRole("button", { name: "添加内容" }));
    await user.click(screen.getByRole("radio", { name: "分组" }));
    await user.type(screen.getByPlaceholderText("如：五金件"), "弹静片");
    await user.click(screen.getByRole("button", { name: "添加分组" }));
    expect(screen.getByText("弹静片", { exact: true })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.queryByText("弹静片", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("已保存")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.getByText("弹静片", { exact: true })).toBeInTheDocument();
}, 30000);

it("改名与删除草稿：重命名弹窗改名、删除草稿分组走 ops 手术（不再发送）", async () => {
    const user = userEvent.setup();
    render(<BomStructurePage />);
    await user.click(screen.getByRole("button", { name: "添加内容" }));
    await user.click(screen.getByRole("radio", { name: "分组" }));
    await user.type(screen.getByPlaceholderText("如：五金件"), "弹静片");
    await user.click(screen.getByRole("button", { name: "添加分组" }));

    // 重命名已保存分组：更多操作菜单 → 重命名
    await user.click(screen.getByRole("button", { name: "更多操作：型号" }));
    await user.click(screen.getByText("重命名"));
    const input = screen.getByDisplayValue("型号");
    await user.clear(input);
    await user.type(input, "型号选择");
    await user.click(screen.getByRole("button", { name: "确定" }));
    expect(screen.getByText("型号选择", { exact: true })).toBeInTheDocument();

    // 删除草稿分组：确认后草稿 op 一并摘除
    await user.click(screen.getByRole("button", { name: "更多操作：弹静片" }));
    await user.click(screen.getByText("删除"));
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.queryByText("弹静片", { exact: true })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /保存结构/ }));
    await waitForApply();
    const [payload] = applyRef.current.mock.calls[0] as [{ operations: StructureOperation[] }];
    expect(payload.operations).toEqual([{ type: "rename", targetType: "group", targetId: "2001", name: "型号选择" }]);
}, 30000);

it("409 版本冲突：保留草稿并提示选择「拉取最新结构」或稍后再试", async () => {
    const user = userEvent.setup();
    applyRef.current = vi.fn().mockRejectedValue(new ApiError("品类结构已被他人修改，请刷新后重试", 409));
    render(<BomStructurePage />);
    await user.click(screen.getByRole("button", { name: "添加内容" }));
    await user.click(screen.getByRole("radio", { name: "分组" }));
    await user.type(screen.getByPlaceholderText("如：五金件"), "新区");
    await user.click(screen.getByRole("button", { name: "添加分组" }));
    await user.click(screen.getByRole("button", { name: /保存结构/ }));
    await waitForApply();
    expect(screen.getByText(/被别人改过了/)).toBeInTheDocument();
    // 草稿保留：未保存计数仍在
    expect(screen.getByText("未保存 1 条")).toBeInTheDocument();

    // 选择拉取最新结构：清空草稿并失效目录缓存
    await user.click(screen.getByRole("button", { name: /拉取最新结构/ }));
    expect(screen.getByText("已保存")).toBeInTheDocument();
    expect(invalidateQueries).toHaveBeenCalled();
    expect(screen.queryByText(/已被他人修改/)).not.toBeInTheDocument();
}, 30000);

const exampleCategory: BomCategory = {
    key: "example",
    name: "示例品类",
    codePrefix: "EX",
    rowVersion: 1,
    groups: [
        { id: "A", name: "A", kind: "section", parentId: null, key: null, multi: null, qty: null, items: [] },
        {
            id: "a",
            name: "a",
            kind: "group",
            parentId: "A",
            key: "a",
            multi: false,
            qty: false,
            items: [{ id: "a-item", name: "a" }],
        },
        {
            id: "b",
            name: "b",
            kind: "group",
            parentId: "A",
            key: "b",
            multi: false,
            qty: false,
            items: [{ id: "b-item", name: "b" }],
        },
        {
            id: "D",
            name: "D",
            kind: "group",
            parentId: "A",
            key: "D",
            multi: false,
            qty: false,
            items: [{ id: "e", name: "e" }],
        },
    ],
};

it("点击名称只选中；三级缩进与折叠箭头独立，物料行无行内按钮，边界上移和下移确实禁用", async () => {
    catalogRef.current = [exampleCategory];
    const user = userEvent.setup();
    const { container } = render(<BomStructurePage />);
    expect(container.querySelector('[data-node-row="A"]')).toHaveAttribute("data-depth", "0");
    expect(container.querySelector('[data-node-row="D"]')).toHaveAttribute("data-depth", "1");
    expect(container.querySelector('[data-node-row="e"]')).toHaveAttribute("data-depth", "2");
    expect(screen.getAllByText("a", { exact: true })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "上移：A" })).toBeDisabled();
    // 分组行保留行内操作；物料行（含合并展示的单物料分组）不再有行内按钮，操作走右键
    expect(screen.getByRole("button", { name: "更多操作：D" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下移：b" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更多操作：e" })).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("button", { name: "b" }));
    expect(screen.getByRole("menuitem", { name: "下移" })).not.toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByRole("button", { name: "A" }));
    expect(screen.getByRole("button", { name: "收起：A" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "e" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "收起：D" }));
    expect(screen.queryByRole("button", { name: "e" })).not.toBeInTheDocument();
    const entry = screen.getByRole("button", { name: "D" });
    await user.click(entry);
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("button", { name: "e" })).toBeVisible();
}, 30000);

it("A 中可直接添加 f 物料和 G 分组，保存仍使用现有目录契约", async () => {
    catalogRef.current = [exampleCategory];
    const user = userEvent.setup();
    render(<BomStructurePage />);
    await user.click(screen.getByRole("button", { name: "收起：A" }));
    await user.click(screen.getByRole("button", { name: "添加内容：A" }));
    expect(screen.getByText("添加到：A", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "物料" })).toBeChecked();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "分组内的物料（可选）" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "物料名称" }), "f");
    await user.click(screen.getByRole("button", { name: "添加物料" }));
    expect(screen.getByRole("button", { name: "f" })).toBeVisible();
    expect(screen.getAllByText("f", { exact: true })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "添加内容：A" }));
    await user.click(screen.getByRole("radio", { name: "分组" }));
    await user.type(screen.getByRole("textbox", { name: "分组名称" }), "G");
    await user.click(screen.getByRole("button", { name: "添加分组" }));
    expect(screen.getByRole("button", { name: "G" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "添加内容：G" }));
    expect(screen.getByRole("radio", { name: "物料" })).toBeChecked();
    await user.type(screen.getByRole("textbox", { name: "物料名称" }), "g1");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "添加物料" }));
    expect(screen.getByRole("button", { name: "g1" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /保存结构/ }));
    await waitForApply();
    const [input] = applyRef.current.mock.calls[0] as [{ operations: StructureOperation[] }];
    expect(input.operations).toEqual([
        expect.objectContaining({
            type: "add_group",
            name: "f",
            parentId: "A",
            items: [expect.objectContaining({ name: "f" })],
        }),
        expect.objectContaining({ type: "add_group", name: "G", parentId: "A" }),
        expect.objectContaining({ type: "add_item", name: "g1" }),
    ]);
}, 30000);

it("合为一行的物料仍可 F2 改名及设为不可选，分组与物料名称保持一致", async () => {
    catalogRef.current = [exampleCategory];
    const user = userEvent.setup();
    render(<BomStructurePage />);
    await user.click(screen.getByRole("button", { name: "a" }));
    await user.keyboard("{F2}");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("重命名物料")).toBeInTheDocument();
    await user.clear(within(dialog).getByRole("textbox", { name: "物料名称" }));
    await user.type(within(dialog).getByRole("textbox", { name: "物料名称" }), "新a");
    await user.click(within(dialog).getByRole("button", { name: "确定" }));
    expect(screen.getAllByText("新a", { exact: true })).toHaveLength(1);
    fireEvent.contextMenu(screen.getByRole("button", { name: "新a" }));
    await user.click(screen.getByRole("menuitem", { name: "设置为不可选" }));
    expect(screen.getByText("不可选", { exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /保存结构/ }));
    await waitForApply();
    const [input] = applyRef.current.mock.calls[0] as [{ operations: StructureOperation[] }];
    expect(input.operations).toEqual([
        { type: "rename", targetType: "group", targetId: "a", name: "新a" },
        { type: "rename", targetType: "item", targetId: "a-item", name: "新a" },
        { type: "hide", targetType: "group", targetId: "a" },
        { type: "hide", targetType: "item", targetId: "a-item" },
    ]);
}, 30000);

it("右键菜单删除操作属于右键的品类，保留输入名称确认；支持 Shift+F10", async () => {
    const user = userEvent.setup();
    render(<BomStructurePage />);
    expect(screen.queryByRole("button", { name: "删除品类" })).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("button", { name: "老微动" }));
    await user.click(screen.getByRole("menuitem", { name: "删除品类" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("删除品类「老微动」？")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认删除" })).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "老微动");
    await user.click(within(dialog).getByRole("button", { name: "确认删除" }));
    expect(deleteRef.current).toHaveBeenCalledWith(
        BOM_CATEGORIES.find(category => category.name === "老微动")!.key,
        expect.any(Object),
    );
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    const category = screen.getByRole("button", { name: "旋转XK2" });
    category.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(screen.getByRole("menuitem", { name: "删除品类" })).toBeInTheDocument();
}, 30000);

it("每层分组的加号可添加子分组或直属物料，预览保留全部层级与祖先隐藏", async () => {
    catalogRef.current = [
        {
            key: "nested",
            name: "嵌套品类",
            rowVersion: 1,
            codePrefix: "NT",
            groups: [
                { id: "A", name: "A", kind: "group", parentId: null, key: "a", multi: false, qty: false, items: [] },
            ],
        },
    ];
    const user = userEvent.setup();
    render(<BomStructurePage />);
    expect(screen.getByRole("button", { name: "添加内容：A" }).textContent).toBe("");
    await user.click(screen.getByRole("button", { name: "添加内容：A" }));
    await user.click(screen.getByRole("radio", { name: "分组" }));
    await user.type(screen.getByRole("textbox", { name: "分组名称" }), "B");
    await user.click(screen.getByRole("button", { name: "添加分组" }));
    await user.click(screen.getByRole("button", { name: "添加内容：A" }));
    await user.type(screen.getByRole("textbox", { name: "物料名称" }), "c");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "添加物料" }));
    await user.click(screen.getByRole("button", { name: "添加内容：B" }));
    await user.click(screen.getByRole("radio", { name: "分组" }));
    expect(screen.getByText("添加到：B", { exact: true })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "分组名称" }), "D");
    await user.click(screen.getByRole("button", { name: "添加分组" }));
    await user.click(screen.getByRole("button", { name: "添加内容：D" }));
    await user.type(screen.getByRole("textbox", { name: "物料名称" }), "e");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "添加物料" }));
    expect(screen.getByRole("button", { name: "c" }).closest("[data-node-row]")).toHaveAttribute("data-depth", "1");
    expect(screen.getByRole("button", { name: "e" }).closest("[data-node-row]")).toHaveAttribute("data-depth", "3");
    await user.click(screen.getByRole("button", { name: "预览" }));
    await user.click(screen.getByRole("radio", { name: "c" }));
    await user.click(screen.getByRole("radio", { name: "e" }));
    expect(screen.getByRole("radio", { name: "c" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "e" })).toBeChecked();
    expect(screen.getByText("A / B / D", { exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭预览" }));
    await user.click(screen.getByRole("button", { name: "设为不可选：A" }));
    await user.click(screen.getByRole("button", { name: "预览" }));
    expect(screen.getByRole("radio", { name: /c/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /e/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "关闭预览" }));
    await user.click(screen.getByRole("button", { name: /保存结构/ }));
    await waitForApply();
    const [input] = applyRef.current.mock.calls[0] as [{ operations: StructureOperation[] }];
    const b = input.operations.find(op => op.type === "add_group" && op.name === "B");
    expect(input.operations).toContainEqual(expect.objectContaining({ type: "add_group", name: "B", parentId: "A" }));
    expect(input.operations).toContainEqual(expect.objectContaining({ type: "add_item", name: "c", groupId: "A" }));
    expect(input.operations).toContainEqual(
        expect.objectContaining({
            type: "add_group",
            name: "D",
            parentId: b?.type === "add_group" ? b.tempId : undefined,
        }),
    );
}, 30000);

it("五层树：第四层可加物料，不能继续加空分组；最大化复用列表动作", async () => {
    catalogRef.current = [
        {
            key: "depth",
            name: "五层品类",
            rowVersion: 1,
            codePrefix: "DT",
            groups: ["A", "B", "C", "D"].map((name, index, names) => ({
                id: name,
                name,
                parentId: index === 0 ? null : names[index - 1]!,
                kind: "group" as const,
                key: name.toLowerCase(),
                multi: false,
                qty: false,
                items: [],
            })),
        },
    ];
    const user = userEvent.setup();
    const toggle = vi.fn();
    const { ContentMaximizeContext } = await import("@/context/useContentMaximize");
    render(
        <ContentMaximizeContext.Provider value={{ maximized: false, toggle }}>
            <BomStructurePage />
        </ContentMaximizeContext.Provider>,
    );
    await user.click(screen.getByRole("button", { name: "最大化表格" }));
    expect(toggle).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "添加内容：D" }));
    expect(screen.getByRole("radio", { name: "分组" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "物料名称" }), "末层物料");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "添加物料" }));
    expect(screen.getByRole("button", { name: "末层物料" }).closest("[data-node-row]")).toHaveAttribute(
        "data-depth",
        "4",
    );
    expect(screen.getByRole("button", { name: "保存结构" }).closest(".bs-editor-header")).toBeInTheDocument();
}, 30000);

it("分组右键菜单显示七项操作，添加物料落到右键分组", async () => {
    catalogRef.current = [exampleCategory];
    const user = userEvent.setup();
    render(<BomStructurePage />);
    await user.click(screen.getByRole("button", { name: "a" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "D" }), { clientX: 120, clientY: 180 });
    const menu = screen.getByRole("menu");
    expect(
        within(menu)
            .getAllByRole("menuitem")
            .map(item => item.textContent?.trim()),
    ).toEqual(["添加物料", "上移", "下移", "重命名", "移动位置", "设置为不可选", "删除"]);
    expect(within(menu).getByRole("menuitem", { name: "上移" })).not.toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "下移" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("treeitem", { name: "D" })).toHaveAttribute("aria-selected", "true");
    await user.click(within(menu).getByRole("menuitem", { name: "添加物料" }));
    const dialog = screen.getByRole("dialog", { name: "添加物料" });
    expect(within(dialog).getByText("添加到：D")).toBeInTheDocument();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.type(within(dialog).getByRole("textbox", { name: "物料名称" }), "f");
    await user.click(within(dialog).getByRole("button", { name: "添加物料" }));
    await user.click(screen.getByRole("button", { name: "保存结构" }));
    await waitForApply();
    expect(applyRef.current).toHaveBeenCalledWith(
        expect.objectContaining({
            operations: [expect.objectContaining({ type: "add_item", groupId: "D", name: "f" })],
        }),
    );
}, 30000);

it("物料右键菜单只有六项，合并展示物料可改名，普通物料可设为不可选再恢复", async () => {
    catalogRef.current = [exampleCategory];
    const user = userEvent.setup();
    render(<BomStructurePage />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "a" }), { clientX: 130, clientY: 200 });
    let menu = screen.getByRole("menu");
    expect(
        within(menu)
            .getAllByRole("menuitem")
            .map(item => item.textContent?.trim()),
    ).toEqual(["上移", "下移", "重命名", "移动位置", "设置为不可选", "删除"]);
    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: "D" }) });
    expect(screen.getByRole("menuitem", { name: "添加物料" })).toBeInTheDocument();
    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: "a" }) });
    menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "添加物料" })).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "重命名" }));
    const dialog = screen.getByRole("dialog", { name: "重命名物料" });
    const input = within(dialog).getByRole("textbox", { name: "物料名称" });
    await user.clear(input);
    await user.type(input, "新a");
    await user.click(within(dialog).getByRole("button", { name: "确定" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "e" }), { clientX: 130, clientY: 240 });
    menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "添加物料" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "上移" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "下移" })).toHaveAttribute("aria-disabled", "true");
    await user.click(within(menu).getByRole("menuitem", { name: "设置为不可选" }));
    expect(screen.getByText("不可选", { exact: true })).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("button", { name: "e" }), { clientX: 130, clientY: 240 });
    await user.click(screen.getByRole("menuitem", { name: "恢复可选" }));
    expect(screen.queryByText("不可选", { exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存结构" }));
    await waitForApply();
    expect(applyRef.current).toHaveBeenCalledWith(
        expect.objectContaining({
            operations: [
                { type: "rename", targetType: "group", targetId: "a", name: "新a" },
                { type: "rename", targetType: "item", targetId: "a-item", name: "新a" },
                { type: "hide", targetType: "item", targetId: "e" },
                { type: "restore", targetType: "item", targetId: "e" },
            ],
        }),
    );
}, 30000);

it("Shift+F10 打开节点菜单，方向键只移动菜单焦点；删除选中分组可撤销", async () => {
    catalogRef.current = [exampleCategory];
    const user = userEvent.setup();
    render(<BomStructurePage />);
    const entry = screen.getByRole("button", { name: "D" });
    await user.click(entry);
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(screen.getByRole("menuitem", { name: "添加物料" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "上移" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(entry).toHaveFocus());
    fireEvent.contextMenu(entry, { clientX: 150, clientY: 240 });
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    const dialog = screen.getByRole("dialog", { name: "删除「D」？" });
    await user.click(within(dialog).getByRole("button", { name: "删除" }));
    expect(screen.queryByRole("button", { name: "D" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "e" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "a" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("button", { name: "D" })).toBeVisible();
    expect(screen.getByRole("button", { name: "e" })).toBeVisible();
}, 30000);

/* apply 是异步调用：等微任务队列排空再断言 */
async function waitForApply() {
    await act(async () => {});
}

// @vitest-environment jsdom
/* BOM 结构页（重构版）：品类折叠面板与复合分节视图、草稿投影（新增分组/设为不可选
 * 所见即所存）、撤销重做、保存 payload（品类 key + 乐观锁版本 + ops）、409 版本冲突
 * 保留草稿并提供「拉取最新结构」。 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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

vi.mock("@/data/queries", () => ({
    bomKeys: { all: ["boms"], list: ["boms", "list"], categories: ["boms", "categories"], stocks: ["boms", "stocks"] },
    wbKeys: { all: ["workbench"] },
    useBomCategories: () => ({ data: catalogRef.current, isLoading: false }),
    useCreateBomCategory: () => ({ mutate: vi.fn(), isPending: false }),
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
    expect(screen.getByText(/\d+ 个分组 · \d+ 项物料/)).toBeInTheDocument();

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
    await user.click(screen.getByRole("button", { name: "新微动跌倒" }));
    expect(screen.getByText("跌倒开关类型")).toBeInTheDocument();
    expect(screen.getByText("微动开关类型")).toBeInTheDocument();
    expect(screen.getByText("跌倒盖", { exact: true })).toBeInTheDocument();
}, 30000);

it("草稿投影所见即所存：新增分组（含随组物料）、设为不可选后保存携带版本与 ops", async () => {
    const user = userEvent.setup();
    render(<BomStructurePage />);

    await user.click(screen.getByRole("button", { name: "新增分组" }));
    await user.type(screen.getByPlaceholderText("如：五金件"), "弹静片");
    await user.type(screen.getByPlaceholderText("一行一个名称，可以一次添加多项物料"), "动弹静片\n静弹静片");
    await user.click(screen.getByRole("button", { name: "添加分组" }));
    expect(screen.getByText("弹静片", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("动弹静片")).toBeInTheDocument();
    expect(screen.getByText("未保存 1 条")).toBeInTheDocument();

    // 设为不可选：立即出现「不可选」角标（投影生效，不等待保存）
    await user.click(screen.getByRole("button", { name: "设为不可选：0-2" }));
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
    const addGroup = input.operations.find(op => op.type === "add_group");
    expect(addGroup).toMatchObject({ name: "弹静片", parentId: null, multi: false });
    if (addGroup?.type === "add_group") {
        expect(addGroup.items?.map(item => item.name)).toEqual(["动弹静片", "静弹静片"]);
    }
    expect(input.operations).toContainEqual({ type: "hide", targetType: "item", targetId: "3051" });

    // 保存成功：草稿清空回到「已保存」
    await act(async () => {});
    expect(screen.getByText("已保存")).toBeInTheDocument();
}, 30000);

it("撤销/重做：新增分组可撤销找回，重做恢复", async () => {
    const user = userEvent.setup();
    render(<BomStructurePage />);
    await user.click(screen.getByRole("button", { name: "新增分组" }));
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
    await user.click(screen.getByRole("button", { name: "新增分组" }));
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
    await user.click(screen.getByRole("button", { name: "新增分组" }));
    await user.type(screen.getByPlaceholderText("如：五金件"), "新区");
    await user.click(screen.getByRole("button", { name: "添加分组" }));
    await user.click(screen.getByRole("button", { name: /保存结构/ }));
    await waitForApply();
    expect(screen.getByText(/已被他人修改/)).toBeInTheDocument();
    // 草稿保留：未保存计数仍在
    expect(screen.getByText("未保存 1 条")).toBeInTheDocument();

    // 选择拉取最新结构：清空草稿并失效目录缓存
    await user.click(screen.getByRole("button", { name: /拉取最新结构/ }));
    expect(screen.getByText("已保存")).toBeInTheDocument();
    expect(invalidateQueries).toHaveBeenCalled();
    expect(screen.queryByText(/已被他人修改/)).not.toBeInTheDocument();
}, 30000);

/* apply 是异步调用：等微任务队列排空再断言 */
async function waitForApply() {
    await act(async () => {});
}

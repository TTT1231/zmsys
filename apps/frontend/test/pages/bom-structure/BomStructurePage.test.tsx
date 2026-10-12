// @vitest-environment jsdom
/* BOM 结构页：品类选择与容器标记、草稿投影（新增组/隐藏物料所见即所存）、保存
 * payload（乐观锁版本 + ops）、409 版本冲突保留草稿并提供「拉取最新结构」。 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BomStructurePage } from "@/pages/bom-structure/BomStructurePage";
import { BOM_CATEGORIES } from "@/data/categories";
import { ApiError } from "@/http/errors";
import type { BomCategory, StructureOperation } from "@/api";

vi.mock("@/context/useApp", () => ({ useApp: () => ({ can: () => true }) }));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const catalogRef = vi.hoisted(() => ({ current: undefined as BomCategory[] | undefined }));
const mutateRef = vi.hoisted(() => ({
    current: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock("@/data/queries", () => ({
    bomKeys: { all: ["boms"], list: ["boms", "list"], categories: ["boms", "categories"], stocks: ["boms", "stocks"] },
    useBomCategories: () => ({ data: catalogRef.current, isLoading: false }),
    useApplyBomStructure: () => ({ mutate: mutateRef.current, isPending: false }),
    useCreateBomCategory: () => ({ mutate: vi.fn(), isPending: false }),
}));

const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
    useQueryClient: () => ({ invalidateQueries }),
}));

beforeEach(() => {
    catalogRef.current = BOM_CATEGORIES;
    mutateRef.current = vi.fn();
});

afterEach(() => {
    cleanup();
    invalidateQueries.mockClear();
});

const pickXk2 = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: /旋转XK2/ }));
};

it("品类列表：目录容器嵌套在引用它的主品类下（不展示死前缀），点选后展示快照树", async () => {
    const user = userEvent.setup();
    render(<BomStructurePage />);
    // 四条目录容器（status=false）：焊线/插线挂在旋转XK3 下、新微动跌倒/老微动跌倒挂在跌倒开关下，
    // 不再与建档品类平铺，也不再展示「被 X 引用」提示与容器死前缀
    expect(screen.getAllByText("目录容器")).toHaveLength(4);
    expect(screen.queryByText(/被 .* 引用/)).not.toBeInTheDocument();
    expect(screen.queryByText(/前缀 XK3W/)).not.toBeInTheDocument();
    expect(screen.queryByText(/前缀 KDN/)).not.toBeInTheDocument();
    // 容器可点选维护：选中焊线展示其快照树
    await user.click(screen.getByRole("button", { name: /焊线/ }));
    expect(screen.getByText("PC塑料", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("静片", { exact: true })).toBeInTheDocument();
    await pickXk2(user);
    expect(screen.getByText("型号", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("触点", { exact: true })).toBeInTheDocument();
});

it("草稿投影所见即所存：新增弹静片组（多选+两物料）、隐藏 0-2 后保存携带版本与 ops", async () => {
    const user = userEvent.setup();
    render(<BomStructurePage />);
    await pickXk2(user);

    // 新增根分组：名称 + 多选 + 随组物料（页面上各已存分组也有「多选」规则开关，取第一个）
    await user.click(screen.getByRole("button", { name: "+ 根分组" }));
    await user.type(screen.getByPlaceholderText("分组名称"), "弹静片");
    await user.click(screen.getAllByLabelText("多选")[0]!);
    await user.type(screen.getByPlaceholderText(/随组物料/), "动弹静片,静弹静片");
    await user.click(screen.getByRole("button", { name: "添加" }));
    expect(screen.getByText("弹静片", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("动弹静片")).toBeInTheDocument();
    expect(screen.getByText("静弹静片")).toBeInTheDocument();
    expect(screen.getByText("未保存变更 1 条")).toBeInTheDocument();

    // 隐藏型号组物料 0-2：立即出现已隐藏标记（投影生效，不等待保存）
    const modelRow = screen.getByText("0-2", { exact: true }).closest("li")!;
    await user.click(within(modelRow as HTMLElement).getByRole("button", { name: "隐藏" }));
    expect(screen.getByText("已隐藏")).toBeInTheDocument();
    expect(screen.getByText("未保存变更 2 条")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(mutateRef.current).toHaveBeenCalledTimes(1);
    const [input, options] = mutateRef.current.mock.calls[0] as [
        { categoryKey: string; expectedRowVersion: number; operations: StructureOperation[] },
        { onSuccess: (result: { rowVersion: number }) => void; onError: (error: unknown) => void },
    ];
    expect(input.categoryKey).toBe("rotary-switch");
    expect(input.expectedRowVersion).toBe(1);
    const addGroup = input.operations.find(op => op.type === "add_group");
    expect(addGroup).toMatchObject({ name: "弹静片", parentId: null, multi: true });
    if (addGroup?.type === "add_group") {
        expect(addGroup.items?.map(item => item.name)).toEqual(["动弹静片", "静弹静片"]);
    }
    expect(input.operations).toContainEqual({ type: "hide", targetType: "item", targetId: "3051" });

    // 成功回调：清空草稿（setState 需包 act 让 React 同步刷新）
    act(() => options.onSuccess({ rowVersion: 2 }));
    expect(screen.getByText("无未保存变更")).toBeInTheDocument();
}, 15000);

it("409 版本冲突：保留草稿并提示选择「拉取最新结构」或稍后再试", async () => {
    const user = userEvent.setup();
    render(<BomStructurePage />);
    await pickXk2(user);
    await user.click(screen.getByRole("button", { name: "+ 分区" }));
    await user.type(screen.getByPlaceholderText("分区名称"), "新区");
    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    const [, options] = mutateRef.current.mock.calls[0] as unknown as [
        unknown,
        { onSuccess: (result: { rowVersion: number }) => void; onError: (error: unknown) => void },
    ];
    act(() => options.onError(new ApiError("品类结构已被他人修改，请刷新后重试", 409)));
    expect(screen.getByText(/品类结构已被他人修改/)).toBeInTheDocument();
    // 草稿保留：未保存计数仍在
    expect(screen.getByText("未保存变更 1 条")).toBeInTheDocument();

    // 选择拉取最新结构：清空草稿并失效目录缓存
    await user.click(screen.getByRole("button", { name: /拉取最新结构/ }));
    expect(screen.getByText("无未保存变更")).toBeInTheDocument();
    expect(invalidateQueries).toHaveBeenCalled();
    expect(screen.queryByText(/品类结构已被他人修改/)).not.toBeInTheDocument();
}, 15000);

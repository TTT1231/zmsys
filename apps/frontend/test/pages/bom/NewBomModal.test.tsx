// @vitest-environment jsdom
/* 新建 BOM 穿梭框：单选组换选替换、多选组全选/半选、切换品类清空、右框移除联动与提交校验。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewBomModal } from "@/pages/bom/BomPage";
import { BOM_CATEGORIES } from "@/data/categories";
import type { Bom, BomCategory } from "@/api";

vi.mock("@/context/useApp", () => ({ useApp: () => ({ role: "staff", can: () => true }) }));
vi.mock("@/components/ui/toastContexts", () => ({ useToast: () => vi.fn() }));

const mutate = vi.fn();
vi.mock("@/data/queries", () => ({
    useBoms: () => ({ data: [] as Bom[], isLoading: false, isFetching: false }),
    useBomCategories: () => ({ data: catalogRef.current, isLoading: false, isFetching: false }),
    useBomStocks: () => ({ data: undefined, isLoading: false, isFetching: false }),
    useBomRefresh: () => ({ refresh: vi.fn() }),
    useCreateBom: () => ({ mutate: mutate, isPending: false }),
}));

/* 用例间替换目录：默认用真实种子（全单选），多选用例注入带 multi 组的目录；
 * boms 默认提供一条新微动档案作为子件候选（跌倒开关用例选中它） */
const catalogRef = vi.hoisted(() => ({ current: undefined as BomCategory[] | undefined }));

beforeEach(() => {
    catalogRef.current = BOM_CATEGORIES;
});

afterEach(() => {
    cleanup();
    mutate.mockClear();
});

const pickCategory = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.selectOptions(screen.getByLabelText(/产品品类/), name);
};

const itemCheckbox = (label: string) => screen.getByRole("checkbox", { name: label });

it("单选组：换选替换旧项、可再点取消；右框按组分节且无数量输入", async () => {
    const user = userEvent.setup();
    render(<NewBomModal open onClose={vi.fn()} />);
    await pickCategory(user, "新微动");

    await user.click(itemCheckbox("二脚底座（无挡脚）"));
    await user.click(itemCheckbox("6.3支架：铜镀银"));
    let right = screen.getByRole("group", { name: /已选物料（2）/ });
    // 分节呈现：组名小节标题 + 纯物料名（不再逐行带“组名：”前缀）
    expect(within(right).getByText("底座")).toBeInTheDocument();
    expect(within(right).getByText("二脚底座（无挡脚）")).toBeInTheDocument();
    expect(within(right).getByText("支架")).toBeInTheDocument();
    expect(within(right).queryByText(/底座：/)).not.toBeInTheDocument();

    // 单选组换选：支架替换为铜镀镍
    await user.click(itemCheckbox("6.3支架：铜镀镍"));
    right = screen.getByRole("group", { name: /已选物料（2）/ });
    expect(within(right).getByText("6.3支架：铜镀镍")).toBeInTheDocument();
    expect(within(right).queryByText("6.3支架：铜镀银")).not.toBeInTheDocument();
    expect(itemCheckbox("6.3支架：铜镀银")).not.toBeChecked();

    // 再点取消
    await user.click(itemCheckbox("6.3支架：铜镀镍"));
    expect(screen.getByRole("group", { name: /已选物料（1）/ }).textContent).not.toContain("支架");
    // 无数量输入
    expect(screen.queryByLabelText(/数量/)).not.toBeInTheDocument();
});

it("多选组：组头全选/清空并呈半选态；分区只折叠不提供全选", async () => {
    catalogRef.current = [
        {
            key: "demo",
            name: "演示品类",
            codePrefix: "DM",
            groups: [
                {
                    id: "s1",
                    parentId: null,
                    kind: "section",
                    name: "五金件",
                    key: null,
                    multi: null,
                    qty: null,
                    items: [],
                },
                {
                    id: "g1",
                    parentId: "s1",
                    kind: "group",
                    name: "卡板",
                    key: "cards",
                    multi: true,
                    qty: false,
                    items: [
                        { id: "i1", name: "大卡板18mm" },
                        { id: "i2", name: "小卡板18mm" },
                    ],
                },
            ],
        },
    ];
    const user = userEvent.setup();
    render(<NewBomModal open onClose={vi.fn()} />);
    await pickCategory(user, "演示品类");

    const groupAll = screen.getByRole("checkbox", { name: "全选卡板" });
    // 分区节点无全选框
    expect(screen.queryByRole("checkbox", { name: "全选五金件" })).not.toBeInTheDocument();

    await user.click(groupAll);
    expect(screen.getByRole("group", { name: /已选物料（2）/ }).textContent).toContain("小卡板18mm");
    await user.click(itemCheckbox("大卡板18mm"));
    expect(screen.getByRole("group", { name: /已选物料（1）/ }).textContent).not.toContain("大卡板18mm");

    // 半选态：一个选中一个未选中时组头 indeterminate
    expect((screen.getByRole("checkbox", { name: "全选卡板" }) as HTMLInputElement).indeterminate).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "全选卡板" }));
    expect(screen.getByRole("group", { name: /已选物料（2）/ }).textContent).toContain("大卡板18mm");
    await user.click(screen.getByRole("checkbox", { name: "全选卡板" }));
    expect(screen.getByRole("group", { name: /已选物料（0）/ }).textContent).not.toContain("卡板");
});

it("切换品类清空选择；右框移除联动左框取消勾选", async () => {
    const user = userEvent.setup();
    render(<NewBomModal open onClose={vi.fn()} />);
    await pickCategory(user, "旋转XK2");
    await user.click(itemCheckbox("1-1"));
    await user.click(itemCheckbox("正面"));
    expect(screen.getByRole("group", { name: /已选物料（2）/ })).toBeInTheDocument();

    await pickCategory(user, "老微动");
    await user.click(screen.getByRole("button", { name: "确认切换" }));
    expect(screen.getByRole("group", { name: /已选物料（0）/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "1-1" })).not.toBeInTheDocument();

    await user.click(itemCheckbox("带CB"));
    const right = screen.getByRole("group", { name: /已选物料（1）/ });
    await user.click(within(right).getByRole("button", { name: "移除 带CB" }));
    expect(screen.getByRole("group", { name: /已选物料（0）/ })).toBeInTheDocument();
    expect(itemCheckbox("带CB")).not.toBeChecked();
});

it("分组节点可折叠（文件树）：折叠后物料隐藏、组头显示已选标记，再展开保持勾选", async () => {
    const user = userEvent.setup();
    render(<NewBomModal open onClose={vi.fn()} />);
    await pickCategory(user, "旋转XK2");

    await user.click(itemCheckbox("0.5"));
    // 展开状态不显示已选徽标（勾选行自身可见，避免双重播报）
    expect(screen.queryByText("已选", { exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "折叠弹簧" }));
    expect(screen.queryByRole("checkbox", { name: "0.5" })).not.toBeInTheDocument();
    // 单选组折叠后仅提示“已选”（不带数字）
    expect(screen.getByText("已选", { exact: true })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开弹簧" }));
    expect(screen.getByRole("checkbox", { name: "0.5" })).toBeChecked();

    // A面/B面 9 项选项按目录序展示（同名物料分属两组，各自独立）
    expect(screen.getAllByRole("checkbox", { name: "全方位左脚铜点" })).toHaveLength(2);
    expect(screen.getAllByRole("checkbox", { name: "三脚银点" })).toHaveLength(2);
});

it("多选组折叠后显示已选数量", async () => {
    catalogRef.current = [
        {
            key: "demo",
            name: "演示品类",
            codePrefix: "DM",
            groups: [
                {
                    id: "g1",
                    parentId: null,
                    kind: "group",
                    name: "卡板",
                    key: "cards",
                    multi: true,
                    qty: false,
                    items: [
                        { id: "i1", name: "大卡板18mm" },
                        { id: "i2", name: "小卡板18mm" },
                    ],
                },
            ],
        },
    ];
    const user = userEvent.setup();
    render(<NewBomModal open onClose={vi.fn()} />);
    await pickCategory(user, "演示品类");

    await user.click(itemCheckbox("大卡板18mm"));
    await user.click(itemCheckbox("小卡板18mm"));
    await user.click(screen.getByRole("button", { name: "折叠卡板" }));
    expect(screen.getByText("已选 2")).toBeInTheDocument();
});

it("目录块顺序：根分组在外壳侧在前、触点分区始终排最后；旋转XK3 无触点分区", async () => {
    const user = userEvent.setup();
    const follows = (a: HTMLElement, b: HTMLElement) =>
        (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const { rerender } = render(<NewBomModal open onClose={vi.fn()} />);
    await pickCategory(user, "旋转XK3");
    // 接线工艺二分：先选插线，出现插线目录
    await user.click(screen.getByRole("radio", { name: "插线" }));
    const shell = screen.getByRole("button", { name: "PC塑料外壳" });
    const hardware = screen.getByRole("button", { name: "五金件" });
    expect(follows(shell, hardware)).toBe(true);
    // 旋转XK3 无触点（电流不大），目录不含触点分区
    expect(screen.queryByRole("button", { name: "触点" })).not.toBeInTheDocument();

    rerender(<NewBomModal open onClose={vi.fn()} />);
    await pickCategory(user, "安全开关");
    const shell2 = screen.getByRole("button", { name: "PC塑料（外壳类）" });
    const pa66 = screen.getByRole("button", { name: "PA66塑料" });
    const hardware2 = screen.getByRole("button", { name: "五金件" });
    const contact2 = screen.getByRole("button", { name: "触点" });
    expect(follows(shell2, pa66)).toBe(true);
    expect(follows(pa66, hardware2)).toBe(true);
    expect(follows(hardware2, contact2)).toBe(true);
});

it("数量分组：勾选后出现步进器，右框显示 ×N，提交携带 quantities；取消勾选清数量", async () => {
    catalogRef.current = [
        {
            key: "piano",
            name: "琴键开关",
            codePrefix: "KQ",
            groups: [
                {
                    id: "2701",
                    parentId: null,
                    kind: "group",
                    name: "琴键底",
                    key: "piano-base",
                    multi: false,
                    qty: false,
                    items: [{ id: "3701", name: "四键焊线底" }],
                },
                {
                    id: "2706",
                    parentId: null,
                    kind: "group",
                    name: "静片",
                    key: "static-plate",
                    multi: false,
                    qty: true,
                    items: [{ id: "3733", name: "带点静片" }],
                },
            ],
        },
    ];
    const user = userEvent.setup();
    render(<NewBomModal open onClose={vi.fn()} />);
    await pickCategory(user, "琴键开关");

    // 普通组无步进器；数量分组未勾选也不显示
    expect(screen.queryByLabelText(/数量/)).not.toBeInTheDocument();
    await user.click(itemCheckbox("四键焊线底"));
    expect(screen.queryByLabelText(/数量/)).not.toBeInTheDocument();

    // 勾选数量分组：步进器出现，右框显示 ×1
    await user.click(itemCheckbox("带点静片"));
    const right = screen.getByRole("group", { name: /已选物料（2）/ });
    expect(within(right).getByText("×1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "带点静片 数量加一" }));
    await user.click(screen.getByRole("button", { name: "带点静片 数量加一" }));
    await user.click(screen.getByRole("button", { name: "带点静片 数量减一" }));
    const right2 = screen.getByRole("group", { name: /已选物料（2）/ });
    expect(within(right2).getByText("×2")).toBeInTheDocument();

    // 提交：仅数量分组携带 quantities
    await user.click(screen.getByRole("button", { name: "保存 BOM" }));
    expect(mutate).toHaveBeenCalledWith(
        { name: "琴键开关", materialItemIds: ["3701", "3733"], quantities: { "3733": 2 } },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    // 折叠后组头显示 已选 · ×N；取消勾选清掉数量
    await user.click(screen.getByRole("button", { name: "折叠静片" }));
    expect(screen.getByText("已选 · ×2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开静片" }));
    await user.click(itemCheckbox("带点静片"));
    const right3 = screen.getByRole("group", { name: /已选物料（1）/ });
    expect(within(right3).queryByText(/×\d/)).not.toBeInTheDocument();
});

it("多选数量组（琴键静片）：可选多项并保留，各自携带数量提交", async () => {
    const user = userEvent.setup();
    render(<NewBomModal open onClose={vi.fn()} />);
    await pickCategory(user, "琴键开关");

    await user.click(itemCheckbox("带点静片"));
    await user.click(itemCheckbox("四键焊线静片"));
    // 多选语义：两项同时保留，组头出现全选框
    let right = screen.getByRole("group", { name: /已选物料（2）/ });
    expect(within(right).getByText("带点静片")).toBeInTheDocument();
    expect(within(right).getByText("四键焊线静片")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "全选静片" })).toBeInTheDocument();

    // 每个选中项独立步进：四键焊线静片 ×2、带点静片保持 ×1
    await user.click(screen.getByRole("button", { name: "四键焊线静片 数量加一" }));
    right = screen.getByRole("group", { name: /已选物料（2）/ });
    expect(within(right).getByText("×2")).toBeInTheDocument();
    expect(within(right).getByText("×1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存 BOM" }));
    expect(mutate).toHaveBeenCalledWith(
        { name: "琴键开关", materialItemIds: ["3733", "3735"], quantities: { "3733": 1, "3735": 2 } },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
});

it("空集合提交被拦截；选中后提交携带物料 id 集合", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<NewBomModal open onClose={onClose} />);
    await pickCategory(user, "旋转XK2");
    await user.click(screen.getByRole("button", { name: "保存 BOM" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请至少选择一项物料");
    expect(mutate).not.toHaveBeenCalled();

    await user.click(itemCheckbox("1-1"));
    await user.click(itemCheckbox("0.5"));
    await user.click(screen.getByRole("button", { name: "保存 BOM" }));
    expect(mutate).toHaveBeenCalledWith(
        { name: "旋转XK2", materialItemIds: ["3001", "3008"] },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
});

it("无原型演示噪音：无副标题、无步骤编号、无预览/预估编码", async () => {
    const user = userEvent.setup();
    render(<NewBomModal open onClose={vi.fn()} />);
    expect(screen.queryByText(/从左侧目录勾选物料/)).not.toBeInTheDocument();
    expect(screen.queryByText(/无数量/)).not.toBeInTheDocument();
    expect(screen.queryByText(/①|②|③/)).not.toBeInTheDocument();
    expect(screen.queryByText(/预估编码/)).not.toBeInTheDocument();
    expect(screen.queryByText(/以保存结果为准/)).not.toBeInTheDocument();
    expect(screen.queryByText("预览")).not.toBeInTheDocument();
    expect(screen.queryByText("可多选")).not.toBeInTheDocument();

    await pickCategory(user, "新微动");
    expect(screen.getByText("从左侧勾选物料")).toBeInTheDocument();
});

// 全量 69 文件并行时机器负载高，此重组件用例（合并树 + 双树切换 + 多步交互）
// 单跑 ~2.5s 会漂过默认 5s 超时，单独放宽到 15s
it("跌倒开关：品类子选微动类型后合并树展示，提交携带 childCategory", async () => {
    const user = userEvent.setup();
    render(<NewBomModal open onClose={vi.fn()} />);
    await pickCategory(user, "跌倒开关");

    // 未选微动类型时树不显示
    expect(screen.queryByText("跌倒盖")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/微动开关类型/)).toBeInTheDocument();

    // 提交被拦截
    await user.click(screen.getByRole("button", { name: "保存 BOM" }));
    expect(screen.getAllByRole("alert").some(a => a.textContent?.includes("请选择微动开关类型"))).toBe(true);
    expect(mutate).not.toHaveBeenCalled();

    // 选新微动 → 合并树：跌倒物料 + "微动开关"大类（可折叠）+ 微动分区/分组
    await user.click(screen.getByRole("radio", { name: "新微动" }));
    expect(screen.getByRole("button", { name: "跌倒盖" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "微动开关类型" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PA66塑料" })).toBeInTheDocument();

    // 折叠微动开关大类 → 整棵微动物料树隐藏
    await user.click(screen.getByRole("button", { name: "微动开关类型" }));
    expect(screen.queryByRole("button", { name: "PA66塑料" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "二脚底座（无挡脚）" })).not.toBeInTheDocument();

    // 展开 → 物料树恢复
    await user.click(screen.getByRole("button", { name: "微动开关类型" }));
    expect(screen.getByRole("button", { name: "PA66塑料" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "五金件" })).toBeInTheDocument();

    // 勾选跌倒物料 + 微动物料
    await user.click(itemCheckbox("跌倒盖KW16 / 有CB字"));
    await user.click(itemCheckbox("跌倒底"));
    await user.click(itemCheckbox("18mm钢球"));
    await user.click(itemCheckbox("翘板"));
    await user.click(itemCheckbox("二脚底座（无挡脚）"));
    await user.click(itemCheckbox("6.3支架：铜镀银"));

    await user.click(screen.getByRole("button", { name: "保存 BOM" }));
    expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
            name: "跌倒开关",
            childCategory: "new-micro-switch",
            materialItemIds: expect.arrayContaining(["3601", "3604", "3605", "3606", "3101", "3112"]),
        }),
        expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    // 切换到老微动 → 树切换、选择清空
    await user.click(screen.getByRole("radio", { name: "老微动" }));
    await user.click(screen.getByRole("button", { name: "确认切换" }));
    expect(screen.getByRole("button", { name: "跌倒盖" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "带CB" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "二脚底座（无挡脚）" })).not.toBeInTheDocument();
}, 15000);

it("普通品类不出现子选下拉", async () => {
    const user = userEvent.setup();
    render(<NewBomModal open onClose={vi.fn()} />);
    await pickCategory(user, "新微动");
    expect(screen.queryByLabelText(/微动开关类型/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PA66塑料" })).toBeInTheDocument();
});

it("初始即预留配置区；取消切换保留原品类和已选物料", async () => {
    const user = userEvent.setup();
    render(<NewBomModal open onClose={vi.fn()} />);
    expect(screen.getByText("请选择产品品类，随后配置物料")).toBeInTheDocument();
    await pickCategory(user, "新微动");
    await user.click(itemCheckbox("二脚底座（无挡脚）"));
    await pickCategory(user, "老微动");
    expect(screen.getByRole("dialog", { name: "切换后将清空已选物料" })).toHaveTextContent("当前已选 1 项物料");
    await user.click(screen.getByRole("button", { name: "保留当前配置" }));
    expect(screen.getByLabelText(/产品品类/)).toHaveValue("新微动");
    expect(itemCheckbox("二脚底座（无挡脚）")).toBeChecked();
});

// @vitest-environment jsdom
/* 库存页：仅展示存在流水的 BOM，品类独立成列，编码/库存数量可排序；详情弹窗含
   BOM 详情与备注警示条，流水按业务日倒序展示（结余取后端逐笔累计），出库行客户名
   挂在单号下方，累计出库取绝对值，非零调整才显示调整卡。 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { StockPage } from "@/pages/stock/StockPage";
import { detailBom } from "../../fixtures/recordDetails";
import type { BomStockLedger } from "@/api";

const otherBom: typeof detailBom = { ...detailBom, code: "QB075", name: "琴键开关", remark: "两档带自锁" };

/* 无流水的档案：不出现在库存列表（余量 map 无其编码） */
const idleBom: typeof detailBom = { ...detailBom, code: "KD210", name: "跌倒开关", remark: "" };

const ledger: BomStockLedger = {
    bomCode: detailBom.code,
    stockQty: 360,
    flows: [
        {
            type: "in",
            no: "RK26091301",
            date: "2026-09-13",
            qty: 200,
            balance: 200,
            operator: "仓库乙",
            remark: "首批建档入库",
        },
        { type: "in", no: "RK26091502", date: "2026-09-15", qty: 300, balance: 500, operator: "张师傅", remark: "" },
        {
            type: "out",
            no: "CK26091801",
            date: "2026-09-18",
            qty: -120,
            balance: 380,
            operator: "仓库乙",
            remark: "",
            customer: "东莞市金鸿电子",
        },
        { type: "out", no: "CK26091903", date: "2026-09-19", qty: -80, balance: 300, operator: "李工", remark: "" },
        {
            type: "adjust",
            no: "TZ26092001",
            date: "2026-09-20",
            qty: 60,
            balance: 360,
            operator: "郭均",
            remark: "盘盈",
        },
    ],
};

/* 仅入库流水的台账：累计出库为零，不得渲染出 "-0"/"−-0" */
const inOnlyLedger: BomStockLedger = {
    bomCode: otherBom.code,
    stockQty: 300,
    flows: [
        {
            type: "in",
            no: "RK26091601",
            date: "2026-09-16",
            qty: 300,
            balance: 300,
            operator: "仓库乙",
            remark: "首批入库",
        },
    ],
};

/* 用例间可替换余量 map：默认两档非零，状态筛选用例注入已用完（0 余量）的行 */
const stocksRef = vi.hoisted(() => ({
    current: undefined as Record<string, number> | undefined,
}));

vi.mock("@/data/queries", () => ({
    useBoms: () => ({ data: [detailBom, otherBom, idleBom], isLoading: false, isFetching: false }),
    useBomCategories: () => ({ data: [], isLoading: false, isFetching: false }),
    useBomStocks: () => ({
        data: stocksRef.current ?? { [detailBom.code]: 80, [otherBom.code]: 1520 },
        isLoading: false,
        isFetching: false,
    }),
    useBomStockLedger: (code: string | null) => ({
        data: code === detailBom.code ? ledger : code === otherBom.code ? inOnlyLedger : undefined,
        isLoading: false,
        isError: false,
    }),
    useBomRefresh: () => ({ refresh: vi.fn() }),
}));

const renderPage = () =>
    render(
        <MemoryRouter>
            <StockPage />
        </MemoryRouter>,
    );
afterEach(() => {
    cleanup();
    stocksRef.current = undefined;
});

it("仅列出存在流水的 BOM；表格渲染品类与库存数量，移动卡片同步展示", () => {
    renderPage();
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent(detailBom.code);
    expect(table).toHaveTextContent(otherBom.code);
    expect(table).not.toHaveTextContent(idleBom.code);
    // 品类独立成列：行内可见两个有流水 BOM 的品类，无流水的品类不出现
    expect(table).toHaveTextContent(otherBom.name);
    expect(screen.getByText("1,520")).toBeInTheDocument();
    // 移动卡片：无流水档案同样不可见
    expect(screen.getAllByText("当前库存").length).toBeGreaterThan(0);
    expect(screen.queryByText(idleBom.name)).not.toBeInTheDocument();
});

it("BOM 编码与库存数量可排序（升/降两态循环）", () => {
    renderPage();
    /* 编码列（第三列，品类独立成列后右移一位）的编码按钮文本，驱动排序断言 */
    const codes = () =>
        [...screen.getByRole("table").querySelectorAll("tbody tr")].map(tr =>
            (tr as HTMLTableRowElement).cells[2]?.querySelector("button")?.textContent?.trim(),
        );
    expect(codes()).toEqual([detailBom.code, otherBom.code]); // 默认按余量 map 顺序

    // 排序点击目标：表头内按钮（onClick 挂在 button 上，直接点 th 不会触发）
    const sortButton = (label: string) => within(screen.getByRole("columnheader", { name: label })).getByRole("button");

    // 编码：首次点击升序（KW042 < QB075），再点降序
    fireEvent.click(sortButton("BOM 编码"));
    expect(codes()).toEqual([detailBom.code, otherBom.code]);
    fireEvent.click(sortButton("BOM 编码"));
    expect(codes()).toEqual([otherBom.code, detailBom.code]);

    // 库存数量：切列回升序（80 在前），再点降序（1520 在前）
    fireEvent.click(sortButton("库存数量（个）"));
    expect(codes()).toEqual([detailBom.code, otherBom.code]);
    fireEvent.click(sortButton("库存数量（个）"));
    expect(codes()).toEqual([otherBom.code, detailBom.code]);
});

it("搜索按编码/品类/备注过滤", () => {
    renderPage();
    const input = screen.getByPlaceholderText("BOM 编码 / 品类 / 备注");
    fireEvent.change(input, { target: { value: "琴键" } });
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent(otherBom.code);
    expect(table).not.toHaveTextContent(detailBom.code);
    fireEvent.click(screen.getByRole("button", { name: "清空条件" }));
    expect(table).toHaveTextContent(detailBom.code);
});

it("品类下拉筛选库存，选项只含有流水的品类，清空条件恢复", () => {
    renderPage();
    const select = screen.getByLabelText("按品类筛选");
    // 无流水的跌倒开关不进选项，避免筛出空结果
    expect(within(select).queryByRole("option", { name: idleBom.name })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: otherBom.name } });
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent(otherBom.code);
    expect(table).not.toHaveTextContent(detailBom.code);
    fireEvent.click(screen.getByRole("button", { name: "清空条件" }));
    expect(table).toHaveTextContent(detailBom.code);
});

it("状态筛选：已用完只留余量为 0，未用完只留余量不为 0，清空条件恢复", () => {
    stocksRef.current = { [detailBom.code]: 0, [otherBom.code]: 1520 };
    renderPage();
    const select = screen.getByLabelText("按库存状态筛选");

    fireEvent.change(select, { target: { value: "已用完" } });
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent(detailBom.code);
    expect(table).not.toHaveTextContent(otherBom.code);

    fireEvent.change(select, { target: { value: "未用完" } });
    expect(table).not.toHaveTextContent(detailBom.code);
    expect(table).toHaveTextContent(otherBom.code);

    fireEvent.click(screen.getByRole("button", { name: "清空条件" }));
    expect(table).toHaveTextContent(detailBom.code);
    expect(table).toHaveTextContent(otherBom.code);
});

it("详情弹窗：流水倒序、有符号数量、结余与摘要卡，非零调整显示调整卡", () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(detailBom.code)).toBeInTheDocument();

    // 摘要卡按标签定位（数字与流水行文本可能重复，容器断言避免撞车）：
    // 累计入库 +500 / 累计出库 −200 / 调整 +60 / 当前库存 360
    const cardOf = (label: string) => within(dialog).getByText(label).closest("div");
    expect(cardOf("累计入库")).toHaveTextContent("+500");
    expect(cardOf("累计出库")).toHaveTextContent("−200");
    expect(cardOf("库存调整")).toHaveTextContent("+60");
    expect(cardOf("当前库存")).toHaveTextContent("360");

    // 流水倒序：最新（调整单）在最上；结余列取后端累计
    const rows = within(dialog).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("TZ26092001");
    expect(rows[1]).toHaveTextContent("360");
    expect(rows.at(-1)).toHaveTextContent("RK26091301");
    expect(rows.at(-1)).toHaveTextContent("200");

    // 客户名只挂在出库单号下方；入库/调整行没有客户占位
    const outRow = rows.find(row => row.textContent?.includes("CK26091801"));
    expect(outRow).toHaveTextContent("东莞市金鸿电子");
    const adjustRow = rows.find(row => row.textContent?.includes("TZ26092001"));
    expect(adjustRow).not.toHaveTextContent("东莞市金鸿电子");

    // 弹窗含 BOM 详情与备注警示条（凭证同款组合）
    expect(within(dialog).getByText("BOM 详情")).toBeInTheDocument();
    expect(within(dialog).getByText(/BOM 备注/)).toBeInTheDocument();
});

it("累计卡零值不带符号：无出库流水的 BOM 累计出库显示 0", () => {
    renderPage();
    // 第二行（QB075）只有入库流水，累计出库合计经负号会得到 -0
    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[1]);
    const dialog = screen.getByRole("dialog");
    const cardOf = (label: string) => within(dialog).getByText(label).closest("div")!;
    expect(cardOf("累计入库")).toHaveTextContent("+300");
    expect(cardOf("累计出库").textContent).toBe("累计出库0");
});

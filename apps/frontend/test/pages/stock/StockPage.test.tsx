// @vitest-environment jsdom
/* 库存页：仅展示存在流水的 BOM，编码/库存数量可排序；详情弹窗按业务日倒序
   展示流水（结余取后端逐笔累计），累计出库取绝对值，非零调整才显示调整卡。 */
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
        { type: "out", no: "CK26091801", date: "2026-09-18", qty: -120, balance: 380, operator: "仓库乙", remark: "" },
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

vi.mock("@/data/queries", () => ({
    useBoms: () => ({ data: [detailBom, otherBom, idleBom], isLoading: false, isFetching: false }),
    useBomStocks: () => ({
        data: { [detailBom.code]: 80, [otherBom.code]: 1520 },
        isLoading: false,
        isFetching: false,
    }),
    useBomStockLedger: (code: string | null) => ({
        data: code === detailBom.code ? ledger : undefined,
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
afterEach(cleanup);

it("仅列出存在流水的 BOM；表格渲染品类与库存数量，移动卡片同步展示", () => {
    renderPage();
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent(detailBom.code);
    expect(table).toHaveTextContent(otherBom.code);
    expect(table).not.toHaveTextContent(idleBom.code);
    expect(screen.getByText("1,520")).toBeInTheDocument();
    // 移动卡片：无流水档案同样不可见
    expect(screen.getAllByText("当前库存").length).toBeGreaterThan(0);
    expect(screen.queryByText(idleBom.name)).not.toBeInTheDocument();
});

it("BOM 编码与库存数量可排序（升/降两态循环）", () => {
    renderPage();
    /* 行内编码列（第二列）的编码按钮文本，驱动排序断言 */
    const codes = () =>
        [...screen.getByRole("table").querySelectorAll("tbody tr")].map(tr =>
            (tr as HTMLTableRowElement).cells[1]?.querySelector("button")?.textContent?.trim(),
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
});

import { describe, expect, it } from "vitest";
import { prepareToolResult, validateLocalFilters } from "@/components/ai/tool-results";

const prepare = (path: string, data: unknown, fields: Record<string, unknown> = {}) =>
    prepareToolResult(path, data, fields, "查询指定范围") as Record<string, any>;

describe("AI 查询结果整理", () => {
    it("筛选业务日期后保留作废提醒，仅对仍生效的记录合计", () => {
        const result = prepare(
            "/inbound",
            [
                { no: "A", date: "2026-10-15", bomCode: "KD001", qty: 5, status: "active" },
                { no: "B", date: "2026-10-14", bomCode: "KD001", qty: 100, status: "active" },
                { no: "C", date: "2026-10-15", bomCode: "KD001", qty: 20, status: "voided" },
                { no: "D", date: "2026-10-15", bomCode: "KD001", qty: 7, status: "active" },
            ],
            { start: "2026-10-15", end: "2026-10-15" },
        );
        expect(result.summary).toMatchObject({
            recordCount: 3,
            validRecordCount: 2,
            voidedRecordCount: 1,
            inboundQty: 12,
        });
        expect(result.summaryComplete).toBe(true);
        expect(result.records.map((row: any) => row.no)).toEqual(["A", "C", "D"]);
    });
    it("明细很大时仍保留准确全量合计，省略明细不等于统计不完整", () => {
        const rows = Array.from({ length: 600 }, (_, index) => ({
            no: `CK${index}`,
            date: "2026-10-15",
            bomCode: "KD001",
            qty: 2,
            state: "registered",
            remark: "备注".repeat(1000),
        }));
        const result = prepare("/outbound", rows);
        expect(result.summary).toMatchObject({ recordCount: 600, outboundQty: 1200 });
        expect(result.summaryComplete).toBe(true);
        expect(result.detailsOmitted).toBe(true);
        expect(JSON.stringify(result).length).toBeLessThan(15_000);
        expect(result.byProduct).toEqual([{ bomCode: "KD001", recordCount: 600, qty: 1200 }]);
    });
    it("已有分页未取完时不得声称完整，编号连续也不改变结果", () => {
        const result = prepare("/ai/agent/voided/outbound", {
            items: [
                { shipmentNo: "CK01", qty: 1 },
                { shipmentNo: "CK02", qty: 2 },
            ],
            total: 5,
        });
        expect(result.summaryComplete).toBe(false);
        const cursor = prepare("/system-logs", { items: [{ id: "1" }], nextCursor: { at: "2026-10-15", id: "1" } });
        expect(cursor.summaryComplete).toBe(false);
    });
    it("不同计量单位分别汇总，不能混加成一个数量", () => {
        const result = prepare("/inbound", [
            { bomCode: "KD001", qty: 3, unit: "个", status: "active" },
            { bomCode: "KD002", qty: 2, unit: "箱", status: "active" },
            { bomCode: "KD001", qty: 10, unit: "个", status: "voided" },
        ]);
        expect(result.summary.inboundQty).toBeUndefined();
        expect(result.summary.quantitiesByUnit).toEqual([
            { unit: "个", qty: 3 },
            { unit: "箱", qty: 2 },
        ]);
        expect(result.summary.unitsVerified).toBe(true);
        const overview = prepare("/workbench/overview", {
            products: [
                { code: "A", unit: "个" },
                { code: "B", unit: "箱" },
            ],
            movements: [
                { bomCode: "A", inbound: 3, outbound: 1 },
                { bomCode: "B", inbound: 2, outbound: 0 },
            ],
        });
        expect(overview.summary.inboundQty).toBeUndefined();
        expect(overview.summary.quantitiesByUnit).toEqual([
            { unit: "个", inboundQty: 3, outboundQty: 1 },
            { unit: "箱", inboundQty: 2, outboundQty: 0 },
        ]);
    });
    it("保留精确订单号、生命周期以及库存台账当前结余", () => {
        const order = prepare(
            "/orders",
            [
                { orderNo: "ZM261015001", qty: 10, outbound: 3, lifecycleStatus: "active" },
                { orderNo: "ZM261015002", qty: 50, outbound: 0, lifecycleStatus: "archived" },
            ],
            { orderNo: "ZM261015001" },
        );
        expect(order.summary.unshippedQty).toBe(7);
        expect(order.records[0].orderNo).toBe("ZM261015001");
        const ledger = prepare("/bom-stocks/KD001/ledger", {
            bomCode: "KD001",
            stockQty: 7,
            flows: [{ no: "RK1", type: "in", qty: 7, balance: 7, date: "2026-10-15" }],
        });
        expect(ledger.stockQty).toBe(7);
    });
    it("工作台出入库只汇总选中的业务日期", () => {
        const result = prepare(
            "/workbench/overview",
            {
                asOf: "2026-10-15",
                unit: "个",
                products: [],
                orders: [],
                movements: [
                    { date: "2026-10-14", bomCode: "KD001", inbound: 100, outbound: 0 },
                    { date: "2026-10-15", bomCode: "KD001", inbound: 12, outbound: 5 },
                ],
            },
            { start: "2026-10-15", end: "2026-10-15" },
        );
        expect(result.summary).toMatchObject({ inboundQty: 12, outboundQty: 5 });
    });
    it("无效日期范围和筛选状态会明确报错", () => {
        expect(() => validateLocalFilters("/inbound", { start: "2026-10-16", end: "2026-10-15" })).toThrow("开始日期");
        expect(() => validateLocalFilters("/inbound", { status: "anything" })).toThrow("有效、作废或全部");
    });
});

/* ECharts 配置生成：只验证纯函数输出的结构，不渲染 canvas */
import { describe, expect, it } from "vitest";

import type { TrendRow } from "@/api";

import { buildDailyTrendOption } from "@/components/charts/options";

const rows: TrendRow[] = [
    {
        date: "2026-03-14",
        label: "3/14",
        orderedQty: 12,
        orderedCount: 1,
        inboundQty: 5,
        inboundCount: 1,
        outboundQty: 3,
        outboundCount: 1,
    },
    {
        date: "2026-03-15",
        label: "3/15",
        orderedQty: 8,
        orderedCount: 2,
        inboundQty: 0,
        inboundCount: 0,
        outboundQty: 6,
        outboundCount: 2,
    },
];

describe("buildDailyTrendOption", () => {
    it("maps rows onto category axis and bar/line series", () => {
        const option = buildDailyTrendOption(rows);
        expect(option.xAxis).toMatchObject({ type: "category", data: ["3/14", "3/15"] });
        const series = option.series as Array<{ name: string; type: string; data: number[] }>;
        expect(series).toHaveLength(2);
        expect(series[0]).toMatchObject({ name: "下单数量", type: "bar", data: [12, 8] });
        expect(series[1]).toMatchObject({ name: "出库数量", type: "line", data: [3, 6] });
    });

    it("handles empty rows with empty arrays", () => {
        const option = buildDailyTrendOption([]);
        expect(option.xAxis).toMatchObject({ data: [] });
        const series = option.series as Array<{ data: number[] }>;
        expect(series[0].data).toEqual([]);
        expect(series[1].data).toEqual([]);
    });

    it("renders tooltip html from the row behind dataIndex", () => {
        const option = buildDailyTrendOption(rows);
        // tooltip 是联合类型（数组/单对象），按实际形状收窄取 formatter
        const tooltip = option.tooltip as { formatter: (params: unknown) => string };
        const html = tooltip.formatter([{ dataIndex: 1 }]);
        expect(html).toContain("2026-03-15");
        expect(html).toContain("下单数量：<b>8</b>");
        expect(html).toContain("出库数量：<b>6</b>");
        expect(tooltip.formatter([{ dataIndex: 99 }])).toBe("");
    });
});

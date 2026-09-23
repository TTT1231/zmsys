import type { EChartsOption } from "echarts";
import type { TrendRow } from "@/api";

const INK = "#101828";
const AXIS_LABEL = "#6e7075";
const AXIS_LINE = "#e4e7ec";
const SPLIT_LINE = "#eef2f6";
const REMAINING_COLOR = "#006be6";
const NEUTRAL_COLOR = "#6e7075";

const fmt = (value: number) => value.toLocaleString("zh-CN");

/* 柱 + 折线：近 30 天下单与出库 */
export function buildDailyTrendOption(rows: TrendRow[]): EChartsOption {
    return {
        animationDuration: 260,
        legend: {
            top: 0,
            left: 0,
            icon: "roundRect",
            itemWidth: 12,
            itemHeight: 8,
            itemGap: 14,
            textStyle: { color: AXIS_LABEL, fontSize: 12 },
            formatter: (name: string) => `${name}（个）`,
        },
        grid: { top: 34, left: 6, right: 10, bottom: 4, containLabel: true },
        xAxis: {
            type: "category",
            data: rows.map(row => row.label),
            axisTick: { show: false },
            axisLine: { lineStyle: { color: AXIS_LINE } },
            axisLabel: { color: AXIS_LABEL, fontSize: 10.5 },
        },
        yAxis: {
            type: "value",
            axisLabel: { color: "#98a2b3", fontSize: 11, formatter: (value: number) => fmt(value) },
            splitLine: { lineStyle: { color: SPLIT_LINE } },
        },
        tooltip: {
            trigger: "axis",
            axisPointer: { type: "cross", crossStyle: { color: "#c6ccc4" } },
            backgroundColor: "#fff",
            borderColor: "#e4e7ec",
            borderWidth: 1,
            padding: [8, 12],
            textStyle: { color: INK, fontSize: 12 },
            extraCssText: "box-shadow:0 18px 45px rgba(16,24,40,.12);border-radius:12px;",
            formatter: (params: unknown) => {
                const list = params as Array<{
                    axisValueLabel: string;
                    seriesName: string;
                    value: number;
                    dataIndex: number;
                }>;
                const row = rows[list[0]?.dataIndex ?? 0];
                if (!row) return "";
                return [
                    `<strong>${row.date}</strong>`,
                    `<div>下单数量：<b>${fmt(row.orderedQty)}</b> 个</div>`,
                    `<div>出库数量：<b>${fmt(row.outboundQty)}</b> 个</div>`,
                ].join("");
            },
        },
        series: [
            {
                name: "下单数量",
                type: "bar",
                barWidth: "52%",
                itemStyle: { color: NEUTRAL_COLOR, borderRadius: [3, 3, 0, 0] },
                data: rows.map(row => row.orderedQty),
            },
            {
                name: "出库数量",
                type: "line",
                smooth: false,
                symbol: "none",
                lineStyle: { width: 2, color: REMAINING_COLOR },
                itemStyle: { color: REMAINING_COLOR },
                data: rows.map(row => row.outboundQty),
            },
        ],
    };
}

import type { EChartsOption } from "echarts";
import type { PendingVsStockRow, TrendRow } from "@/api";

const INK = "#101828";
const AXIS_LABEL = "#667085";
const AXIS_LINE = "#e4e7ec";
const SPLIT_LINE = "#eef2f6";
const REMAINING_COLOR = "#4f46e5";
const STOCK_OK_COLOR = "#0284c7";
const STOCK_SHORT_COLOR = "#b42318";
const NEUTRAL_COLOR = "#667085";

const fmt = (value: number) => value.toLocaleString("zh-CN");

const tipBadge = (overdue: boolean) =>
    overdue
        ? `<span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;background:#fef3f2;color:#b42318;font-size:11px;font-weight:600;">已逾期</span>`
        : "";

const tipChip = (row: PendingVsStockRow) =>
    row.stock >= row.remaining
        ? `<div style="margin-top:6px;display:inline-block;padding:3px 9px;border-radius:999px;background:#ecfdf3;color:#047857;font-size:11.5px;font-weight:500;">库存可覆盖，最多可发 ${fmt(row.maxShip)} 件</div>`
        : `<div style="margin-top:6px;display:inline-block;padding:3px 9px;border-radius:999px;background:#fff7ed;color:#b45309;font-size:11.5px;font-weight:500;">还差 ${fmt(row.remaining - row.stock)} 件，待备货（最多可发 ${fmt(row.maxShip)} 件）</div>`;

/* 横向双条形图：剩余待交付 vs 可用库存 */
export function buildPendingVsStockOption(rows: PendingVsStockRow[]): EChartsOption {
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
            data: [
                { name: "剩余待交付", icon: "roundRect" },
                { name: "可用库存", icon: "roundRect" },
                { name: "库存不足", icon: "roundRect" },
            ],
        },
        grid: { top: 34, left: 6, right: 64, bottom: 4, containLabel: true },
        xAxis: {
            type: "value",
            minInterval: 1,
            axisLabel: { color: "#98a2b3", fontSize: 11, formatter: (value: number) => fmt(value) },
            splitLine: { lineStyle: { color: SPLIT_LINE } },
        },
        yAxis: {
            type: "category",
            inverse: true,
            data: rows.map(row => row.id),
            axisTick: { show: false },
            axisLine: { lineStyle: { color: AXIS_LINE } },
            axisLabel: { color: INK, fontSize: 12, fontWeight: 600 },
        },
        tooltip: {
            trigger: "item",
            confine: true,
            hideDelay: 150,
            backgroundColor: "#fff",
            borderColor: "#e4e7ec",
            borderWidth: 1,
            padding: [10, 12],
            textStyle: { color: INK, fontSize: 12 },
            extraCssText:
                "box-shadow:0 18px 45px rgba(16,24,40,.12);border-radius:12px;max-width:320px;white-space:normal;",
            formatter: (params: unknown) => {
                const p = params as { dataIndex: number };
                const row = rows[p.dataIndex];
                if (!row) return "";
                return [
                    `<div style="font-weight:600;font-size:13px;">${row.id}${tipBadge(row.overdue)}</div>`,
                    `<div style="margin-top:2px;color:#667085;font-size:11.5px;">${row.customer} · ${row.bomCode}</div>`,
                    `<div style="color:#667085;font-size:11.5px;">${row.deliverDate} 交付</div>`,
                    `<div style="margin-top:7px;display:flex;justify-content:space-between;gap:18px;"><span style="color:#667085;">剩余待交付</span><b>${fmt(row.remaining)} 件</b></div>`,
                    `<div style="display:flex;justify-content:space-between;gap:18px;"><span style="color:#667085;">可用库存</span><b>${fmt(row.stock)} 件</b></div>`,
                    tipChip(row),
                ].join("");
            },
        },
        series: [
            {
                name: "剩余待交付",
                type: "bar",
                barWidth: 15,
                barGap: "35%",
                itemStyle: { color: REMAINING_COLOR, borderRadius: [0, 3, 3, 0] },
                emphasis: { itemStyle: { color: "#6366f1" } },
                label: {
                    show: true,
                    position: "right",
                    fontSize: 11,
                    color: AXIS_LABEL,
                    formatter: (p: { value?: unknown }) => fmt(Number(p.value)),
                },
                data: rows.map(row => row.remaining),
            },
            {
                name: "可用库存",
                type: "bar",
                barWidth: 15,
                itemStyle: { borderRadius: [0, 3, 3, 0] },
                emphasis: { itemStyle: { color: "#3f8aa8" } },
                data: rows.map(row => ({
                    value: row.stock,
                    itemStyle: {
                        color: row.stock >= row.remaining ? STOCK_OK_COLOR : STOCK_SHORT_COLOR,
                        borderRadius: [0, 3, 3, 0],
                    },
                })),
            },
            {
                name: "库存不足",
                type: "bar",
                barWidth: 15,
                itemStyle: { color: STOCK_SHORT_COLOR },
                data: [],
            },
        ],
    };
}

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
            formatter: (name: string) => `${name}（件）`,
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
                    `<div>下单数量：<b>${fmt(row.orderedQty)}</b> 件</div>`,
                    `<div>出库数量：<b>${fmt(row.outboundQty)}</b> 件</div>`,
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

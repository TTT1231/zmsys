/* 品类进度与客户排行使用 ECharts，点击图形或明细入口可继续查看具体数字。 */
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { EChart } from "@/components/charts/EChart";
import { usePreferences } from "@/context/usePreferences";
import { num } from "@/lib/format";
import { chartPalette, type ChartPalette } from "@/lib/chartTheme";
import { Icon } from "@/lib/icons";
import type { customerRanking, summarizeWorkbench, RankingMetric } from "@/data/workbench";

type Category = ReturnType<typeof summarizeWorkbench>["categories"][number];
type Customer = ReturnType<typeof customerRanking>[number];

/* 轴标签 / 网格线颜色取当前主题令牌（暗色与内置主题切换时随 preferences 重算） */
const axisLabelOf = (palette: ChartPalette) => ({
    color: palette.muted,
    fontSize: 11,
    formatter: (value: number) => (value >= 10000 ? `${+(value / 10000).toFixed(1)}万` : `${value}`),
});
const gridLineOf = (palette: ChartPalette) => ({ lineStyle: { color: palette.soft, type: "dashed" as const } });

export function ProductProgressChart({
    categories,
    periodLabel,
    onDetails,
}: {
    categories: Category[];
    periodLabel: string;
    onDetails: (category?: string) => void;
}) {
    const [view, setView] = useState("delivery");
    const { preferences } = usePreferences();
    const delivery = view === "delivery";
    const total = categories.reduce((sum, row) => sum + row.qty, 0);
    const shipped = categories.reduce((sum, row) => sum + row.shipped, 0);
    const gap = categories.reduce((sum, row) => sum + row.gap, 0);
    const option: EChartsOption = useMemo(() => {
        const palette = chartPalette();
        const axisLabel = axisLabelOf(palette);
        const gridLine = gridLineOf(palette);
        return {
            color: delivery ? [palette.primary, palette.primaryBorder] : ["#0d9488", "#f59e0b"],
            textStyle: { fontFamily: "Inter, Microsoft YaHei, sans-serif" },
            tooltip: {
                trigger: "axis",
                axisPointer: { type: "shadow" },
                confine: true,
                valueFormatter: value => `${num(Number(value))} 个`,
            },
            legend: {
                top: 0,
                left: 0,
                icon: "roundRect",
                itemWidth: 10,
                itemHeight: 10,
                textStyle: { color: palette.muted, fontSize: 12 },
            },
            grid: {
                top: 42,
                bottom: 24,
                left: 0,
                right: delivery ? 92 : 45,
                outerBoundsMode: "same",
                outerBoundsContain: "axisLabel",
            },
            xAxis: {
                type: "value",
                splitNumber: 4,
                axisLabel: { ...axisLabel, hideOverlap: true },
                splitLine: gridLine,
            },
            yAxis: {
                type: "category",
                inverse: true,
                data: categories.map(row => row.name),
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { color: palette.td, fontSize: 12, margin: 16 },
            },
            media: [
                {
                    option: {
                        grid: { right: delivery ? 112 : 45 },
                        xAxis: { splitNumber: 4 },
                        series: delivery
                            ? [
                                  {},
                                  {
                                      label: {
                                          formatter: (params: { dataIndex: number }) => {
                                              const row = categories[params.dataIndex];
                                              return row.qty
                                                  ? `${num(row.qty)} · ${Math.round((row.shipped / row.qty) * 100)}%`
                                                  : "暂无订单";
                                          },
                                      },
                                  },
                              ]
                            : [{}, {}],
                    },
                },
                {
                    query: { maxWidth: 480 },
                    option: {
                        grid: { right: delivery ? 40 : 45 },
                        xAxis: { splitNumber: 3 },
                        series: delivery
                            ? [
                                  {},
                                  {
                                      label: {
                                          formatter: (params: { dataIndex: number }) => {
                                              const row = categories[params.dataIndex];
                                              return row.qty ? `${Math.round((row.shipped / row.qty) * 100)}%` : "—";
                                          },
                                      },
                                  },
                              ]
                            : [{}, {}],
                    },
                },
            ],
            series: delivery
                ? [
                      {
                          name: "已发数量",
                          type: "bar",
                          stack: "delivery",
                          barWidth: 22,
                          itemStyle: { borderRadius: [4, 0, 0, 4] },
                          data: categories.map(row => row.shipped),
                      },
                      {
                          name: "未发数量",
                          type: "bar",
                          stack: "delivery",
                          barWidth: 22,
                          itemStyle: { borderRadius: [0, 4, 4, 0] },
                          label: {
                              show: true,
                              position: "right",
                              distance: 12,
                              color: palette.tdStrong,
                              fontSize: 11,
                              formatter: params => {
                                  const row = categories[params.dataIndex];
                                  return row.qty
                                      ? `${num(row.qty)}  ·  ${Math.round((row.shipped / row.qty) * 100)}%`
                                      : "暂无订单";
                              },
                          },
                          data: categories.map(row => row.remaining),
                      },
                  ]
                : [
                      {
                          name: "当前库存",
                          type: "bar",
                          barWidth: 12,
                          barGap: "40%",
                          itemStyle: { borderRadius: [0, 3, 3, 0] },
                          data: categories.map(row => row.stock),
                      },
                      {
                          name: "备货缺口",
                          type: "bar",
                          barWidth: 12,
                          itemStyle: { borderRadius: [0, 3, 3, 0] },
                          label: {
                              show: true,
                              position: "right",
                              fontSize: 11,
                              color: palette.warning,
                              formatter: params => (Number(params.value) ? num(Number(params.value)) : "充足"),
                          },
                          data: categories.map(row => row.gap),
                      },
                  ],
        };
    }, [categories, delivery, preferences]);
    return (
        <section
            className="min-w-0 rounded-panel border border-line bg-surface p-5 shadow-card sm:p-6"
            aria-labelledby="product-chart-title"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 id="product-chart-title" className="text-16 font-semibold text-ink">
                        产品交付进度
                    </h2>
                    <p className="mt-1 text-13 text-muted">
                        {delivery
                            ? `${periodLabel}订单 · 条形总长为需求总量，右侧为总量与交付率`
                            : "截至今日 · 各 BOM 分别计算缺口，汇总到品类"}
                    </p>
                </div>
                <div role="group" aria-label="产品图表视图" className="flex rounded-input bg-soft p-1">
                    {[
                        ["delivery", "交付进度"],
                        ["stock", "库存与缺口"],
                    ].map(([value, label]) => (
                        <button
                            key={value}
                            aria-pressed={view === value}
                            onClick={() => setView(value)}
                            className={`min-h-9 rounded-md px-3 text-13 font-medium ${view === value ? "bg-surface text-primary-strong shadow-xs" : "text-muted hover:text-ink"}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            <div
                className="mt-6"
                role="img"
                aria-label={
                    delivery
                        ? `各品类已发与未发数量。总需求${num(total)}个，已发${num(shipped)}个。可通过下方品类按钮查看明细。`
                        : `当前库存与备货缺口对比，备货缺口共${num(gap)}个。`
                }
            >
                <EChart
                    option={option}
                    height={290}
                    onClick={params => {
                        if (params.dataIndex !== undefined) onDetails(categories[params.dataIndex]?.name);
                    }}
                />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                <div className="flex flex-wrap items-center gap-1 text-12 text-muted">
                    <span className="mr-1">查看型号</span>
                    {categories.map(row => (
                        <button
                            key={row.name}
                            onClick={() => onDetails(row.name)}
                            className="min-h-9 rounded-md px-2 hover:bg-primary-soft hover:text-primary"
                        >
                            {row.name}
                        </button>
                    ))}
                </div>
                <button
                    onClick={() => onDetails()}
                    className="flex min-h-9 items-center gap-1 text-13 font-medium text-primary-strong hover:underline"
                >
                    全部明细
                    <Icon name="chevron-right" size={14} />
                </button>
            </div>
        </section>
    );
}

export function CustomerRankingChart({
    customers,
    metric,
    onMetric,
    periodLabel,
    onCustomer,
    onDetails,
}: {
    customers: Customer[];
    metric: RankingMetric;
    onMetric: (metric: RankingMetric) => void;
    periodLabel: string;
    onCustomer: (code: string) => void;
    onDetails: () => void;
}) {
    const { preferences } = usePreferences();
    const option: EChartsOption = useMemo(() => {
        const palette = chartPalette();
        return {
            textStyle: { fontFamily: "Inter, Microsoft YaHei, sans-serif" },
            grid: { left: 0, right: 50, top: 8, bottom: 24, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
            tooltip: {
                trigger: "axis",
                axisPointer: { type: "shadow" },
                confine: true,
                valueFormatter: value => `${num(Number(value))} ${metric === "qty" ? "个" : "笔"}`,
            },
            xAxis: {
                type: "value",
                minInterval: metric === "count" ? 1 : undefined,
                axisLabel: axisLabelOf(palette),
                splitLine: gridLineOf(palette),
            },
            yAxis: {
                type: "category",
                inverse: true,
                data: customers.map(row => row.name),
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: {
                    width: 128,
                    overflow: "truncate",
                    color: palette.tdStrong,
                    fontSize: 11,
                    formatter: (name: string, index: number) => `${String(index + 1).padStart(2, "0")}  ${name}`,
                },
            },
            series: [
                {
                    name: metric === "qty" ? "订购数量" : "下单笔数",
                    type: "bar",
                    barWidth: 12,
                    showBackground: true,
                    backgroundStyle: { color: palette.soft, borderRadius: 3 },
                    itemStyle: {
                        borderRadius: [0, 3, 3, 0],
                        color: params =>
                            params.dataIndex === 0
                                ? palette.primary
                                : params.dataIndex < 3
                                  ? palette.primaryMid
                                  : palette.primaryBorder,
                    },
                    label: {
                        show: true,
                        position: "right",
                        color: palette.tdStrong,
                        fontSize: 11,
                        formatter: params => num(Number(params.value)),
                    },
                    data: customers.map(row => row[metric]),
                },
            ],
        };
    }, [customers, metric, preferences]);
    return (
        <section
            className="flex min-w-0 flex-col rounded-panel border border-line bg-surface p-5 shadow-card sm:p-6"
            aria-labelledby="ranking-title"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 id="ranking-title" className="text-16 font-semibold text-ink">
                        客户订单排行{" "}
                        <span className="ml-1 rounded bg-primary-soft px-1.5 py-0.5 text-11 text-primary-strong">
                            TOP 20
                        </span>
                    </h2>
                    <p className="mt-1 text-13 text-muted">{periodLabel}订购规模 · 点击条形查看客户订单</p>
                </div>
                <div role="group" aria-label="客户排名方式" className="flex rounded-input bg-soft p-1">
                    {(
                        [
                            ["qty", "订购数量"],
                            ["count", "下单笔数"],
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            aria-pressed={metric === value}
                            onClick={() => onMetric(value)}
                            className={`min-h-9 rounded-md px-2.5 text-13 font-medium ${metric === value ? "bg-surface text-primary-strong shadow-xs" : "text-muted hover:text-ink"}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="mt-5 h-89 overflow-auto" tabIndex={0} aria-label="客户前20名排行，向下滚动查看更多">
                {customers.length ? (
                    <div
                        className="min-w-76"
                        role="img"
                        aria-label={`按${metric === "qty" ? "订购数量" : "下单笔数"}排名，第一名${customers[0].name}，${num(customers[0][metric])}${metric === "qty" ? "个" : "笔"}。明细入口提供完整可读表格。`}
                    >
                        <EChart
                            option={option}
                            height={Math.max(280, customers.length * 36 + 36)}
                            onClick={params => {
                                if (params.dataIndex !== undefined && customers[params.dataIndex])
                                    onCustomer(customers[params.dataIndex].code);
                            }}
                        />
                    </div>
                ) : (
                    <p className="py-24 text-center text-14 text-muted">所选期间暂无客户订单</p>
                )}
            </div>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-12 text-muted">
                <span>
                    前 {customers.length} 名 · {metric === "qty" ? "单位：个" : "单位：笔"} · 向下滚动查看更多
                </span>
                <button
                    onClick={onDetails}
                    className="flex min-h-9 items-center gap-1 text-13 font-medium text-primary-strong hover:underline"
                >
                    排行明细
                    <Icon name="chevron-right" size={14} />
                </button>
            </div>
        </section>
    );
}

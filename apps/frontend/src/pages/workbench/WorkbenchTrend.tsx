/* 出入库趋势图：独立周期和品类筛选，提供数据表作为图表的可访问替代。 */
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { EChart } from "@/components/charts/EChart";
import { usePreferences } from "@/context/usePreferences";
import { workbenchTrend, type WorkbenchData } from "@/data/workbench";
import { chartPalette, withAlpha } from "@/lib/chartTheme";
import { addDays } from "@/lib/date";
import { num } from "@/lib/format";

export const workbenchSelectClass =
    "min-h-10 rounded-input border border-line bg-surface px-3 text-12 text-td outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";

export function WorkbenchTrend({ data }: { data: WorkbenchData }) {
    const { preferences } = usePreferences();
    const [category, setCategory] = useState("");
    const [period, setPeriod] = useState("30");
    const [showTable, setShowTable] = useState(false);
    const [customStart, setCustomStart] = useState(addDays(data.asOf, -29));
    const [customEnd, setCustomEnd] = useState(data.asOf);
    const start =
        period === "year"
            ? `${data.asOf.slice(0, 4)}-01-01`
            : period === "month"
              ? `${data.asOf.slice(0, 7)}-01`
              : period === "custom"
                ? customStart
                : addDays(data.asOf, -29);
    const end = period === "custom" ? customEnd : data.asOf;
    const valid = !!start && !!end && start <= end && end <= data.asOf && start >= addDays(data.asOf, -1095);
    const monthly = valid && (new Date(end).getTime() - new Date(start).getTime()) / 86400000 > 90;
    const rows = useMemo(
        () => (valid ? workbenchTrend(data, { start, end }, category, monthly) : []),
        [data, start, end, category, monthly, valid],
    );
    const inbound = rows.reduce((sum, row) => sum + row.inbound, 0);
    const outbound = rows.reduce((sum, row) => sum + row.outbound, 0);
    const option: EChartsOption = useMemo(() => {
        const palette = chartPalette();
        return {
            color: [palette.primary, "#0d9488"],
            textStyle: { fontFamily: "Inter, Microsoft YaHei, sans-serif" },
            tooltip: { trigger: "axis", confine: true, valueFormatter: value => `${num(Number(value))} 个` },
            legend: { bottom: 0, itemWidth: 18, itemHeight: 8, textStyle: { color: palette.muted, fontSize: 12 } },
            grid: { left: 8, right: 16, top: 30, bottom: 42, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
            xAxis: {
                type: "category",
                boundaryGap: false,
                data: rows.map(row => row.date),
                axisLine: { lineStyle: { color: palette.line } },
                axisTick: { show: false },
                axisLabel: {
                    color: palette.muted,
                    fontSize: 11,
                    formatter: (value: string) =>
                        monthly
                            ? `${Number(value.slice(5))}月`
                            : `${Number(value.slice(5, 7))}/${Number(value.slice(8))}`,
                },
            },
            yAxis: {
                type: "value",
                name: `数量（${data.unit}）`,
                nameTextStyle: { color: palette.muted, align: "left" },
                axisLabel: {
                    color: palette.muted,
                    fontSize: 11,
                    formatter: (value: number) => (value >= 10000 ? `${value / 10000}万` : `${value}`),
                },
                splitLine: { lineStyle: { color: palette.soft, type: "dashed" } },
            },
            series: [
                {
                    name: "检验入库",
                    type: "line",
                    data: rows.map(row => row.inbound),
                    showSymbol: false,
                    symbol: "circle",
                    lineStyle: { width: 2.5 },
                    areaStyle: {
                        color: {
                            type: "linear",
                            x: 0,
                            y: 0,
                            x2: 0,
                            y2: 1,
                            colorStops: [
                                { offset: 0, color: withAlpha(palette.primary, 0.12) },
                                { offset: 1, color: withAlpha(palette.primary, 0) },
                            ],
                        },
                    },
                },
                {
                    name: "成品出库",
                    type: "line",
                    data: rows.map(row => row.outbound),
                    showSymbol: false,
                    symbol: "diamond",
                    lineStyle: { width: 2.5, type: "dashed" },
                },
            ],
        };
    }, [rows, monthly, data.unit, preferences]);

    return (
        <section
            className="min-w-0 rounded-panel border border-line bg-surface p-5 shadow-card sm:p-6"
            aria-labelledby="trend-title"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 id="trend-title" className="text-16 font-semibold text-ink">
                        成品出入库趋势
                    </h2>
                    <p className="mt-1 text-12 text-muted">跟踪入库与出库的变化节奏</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <select
                        aria-label="趋势品类"
                        className={workbenchSelectClass}
                        value={category}
                        onChange={event => setCategory(event.target.value)}
                    >
                        <option value="">全部品类</option>
                        {[...new Set(data.products.map(product => product.category))].map(name => (
                            <option key={name}>{name}</option>
                        ))}
                    </select>
                    <select
                        aria-label="趋势时间"
                        className={workbenchSelectClass}
                        value={period}
                        onChange={event => setPeriod(event.target.value)}
                    >
                        <option value="30">最近 30 天</option>
                        <option value="month">本月</option>
                        <option value="year">今年</option>
                        <option value="custom">自定义</option>
                    </select>
                </div>
            </div>
            {period === "custom" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                        aria-label="趋势开始日期"
                        type="date"
                        className={workbenchSelectClass}
                        value={customStart}
                        max={customEnd}
                        min={addDays(data.asOf, -1095)}
                        onChange={event => setCustomStart(event.target.value)}
                    />
                    <span className="text-muted">至</span>
                    <input
                        aria-label="趋势结束日期"
                        type="date"
                        className={workbenchSelectClass}
                        value={customEnd}
                        min={customStart}
                        max={data.asOf}
                        onChange={event => setCustomEnd(event.target.value)}
                    />
                </div>
            )}
            <div className="mt-5 flex items-center gap-7 border-b border-line pb-4">
                <div>
                    <div className="flex items-center gap-2 text-12 text-muted">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        期间入库
                    </div>
                    <p className="mt-1 text-22 font-semibold tabular-nums text-ink">
                        {num(inbound)}
                        <span className="ml-1.5 text-12 font-normal text-muted">{data.unit}</span>
                    </p>
                </div>
                <div>
                    <div className="flex items-center gap-2 text-12 text-muted">
                        <span className="h-2 w-2 rounded-full bg-teal-600" />
                        期间出库
                    </div>
                    <p className="mt-1 text-22 font-semibold tabular-nums text-ink">
                        {num(outbound)}
                        <span className="ml-1.5 text-12 font-normal text-muted">{data.unit}</span>
                    </p>
                </div>
            </div>
            {!valid ? (
                <p role="alert" className="py-20 text-center text-13 text-danger">
                    请选择有效的日期范围，最长支持近三年。
                </p>
            ) : showTable ? (
                <div className="mt-4 h-65 overflow-auto rounded-input border border-line">
                    <table className="w-full text-right text-12">
                        <caption className="sr-only">成品出入库趋势数据</caption>
                        <thead className="sticky top-0 bg-soft">
                            <tr>
                                <th className="p-3 text-left">日期</th>
                                <th className="p-3">入库（{data.unit}）</th>
                                <th className="p-3">出库（{data.unit}）</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => (
                                <tr key={row.date} className="border-t border-line">
                                    <td className="p-3 text-left">{row.date}</td>
                                    <td className="p-3 tabular-nums">{num(row.inbound)}</td>
                                    <td className="p-3 tabular-nums">{num(row.outbound)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : inbound + outbound === 0 ? (
                <p className="py-24 text-center text-13 text-muted">所选期间暂无成品出入库记录</p>
            ) : (
                <div
                    role="img"
                    aria-label={`${category || "全部品类"}，${start}至${end}，入库${num(inbound)}个，出库${num(outbound)}个。可切换数据表查看各期数值。`}
                >
                    <EChart option={option} height={276} />
                </div>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-11 text-muted">
                <span>
                    {start} — {end} · 按{monthly ? "月" : "日"}汇总
                </span>
                <button
                    className="min-h-9 text-12 font-medium text-primary-strong hover:underline"
                    onClick={() => setShowTable(value => !value)}
                >
                    {showTable ? "查看趋势图" : "查看数据表"}
                </button>
            </div>
        </section>
    );
}

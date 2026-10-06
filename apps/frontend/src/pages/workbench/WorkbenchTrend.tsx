/* 出入库趋势图：统计周期跟随页面全局筛选，品类筛选与数据表仍由本卡自带。 */
import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { EChart } from "@/components/charts/EChart";
import { Button } from "@/components/ui/Button";
import { usePreferences } from "@/context/usePreferences";
import { workbenchTrend, type WorkbenchData, type WorkbenchRange } from "@/data/workbench";
import { chartPalette, withAlpha } from "@/lib/chartTheme";
import { plainNum } from "@/lib/format";

export const workbenchSelectClass =
    "min-h-10 rounded-input border border-line bg-surface px-3 text-13 text-td outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";

export function WorkbenchTrend({ data, range }: { data: WorkbenchData; range: WorkbenchRange }) {
    const { preferences } = usePreferences();
    const [category, setCategory] = useState("");
    const [showTable, setShowTable] = useState(false);
    const { start, end } = range;
    // 长区间自动按月汇总，避免逐日补零把横轴铺满（全局「累计」可能跨多年）
    const monthly = (new Date(end).getTime() - new Date(start).getTime()) / 86400000 > 90;
    const rows = useMemo(
        () => workbenchTrend(data, { start, end }, category, monthly),
        [data, start, end, category, monthly],
    );
    const multiYear = useMemo(() => new Set(rows.map(row => row.date.slice(0, 4))).size > 1, [rows]);
    const inbound = rows.reduce((sum, row) => sum + row.inbound, 0);
    const outbound = rows.reduce((sum, row) => sum + row.outbound, 0);
    const option: EChartsOption = useMemo(() => {
        const palette = chartPalette();
        return {
            color: [palette.primary, "#0d9488"],
            textStyle: { fontFamily: "Inter, Microsoft YaHei, sans-serif" },
            tooltip: { trigger: "axis", confine: true, valueFormatter: value => `${plainNum(Number(value))} 个` },
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
                            ? multiYear
                                ? `${value.slice(2, 4)}/${Number(value.slice(5))}月`
                                : `${Number(value.slice(5))}月`
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
                    name: "入库",
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
                    name: "出库",
                    type: "line",
                    data: rows.map(row => row.outbound),
                    showSymbol: false,
                    symbol: "diamond",
                    lineStyle: { width: 2.5, type: "dashed" },
                },
            ],
        };
    }, [rows, monthly, multiYear, data.unit, preferences]);

    return (
        <section
            className="min-w-0 rounded-panel border border-line bg-surface p-5 shadow-card sm:p-6"
            aria-labelledby="trend-title"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 id="trend-title" className="text-16 font-semibold text-ink">
                    成品出入库趋势
                </h2>
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
            </div>
            <div className="mt-5 flex items-center gap-7 border-b border-line pb-4">
                <div>
                    <div className="flex items-center gap-2 text-13 text-muted">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        入库
                    </div>
                    <p className="mt-1 text-22 font-semibold tabular-nums text-ink">
                        {plainNum(inbound)}
                        <span className="ml-1.5 text-13 font-normal text-muted">{data.unit}</span>
                    </p>
                </div>
                <div>
                    <div className="flex items-center gap-2 text-13 text-muted">
                        <span className="h-2 w-2 rounded-full bg-teal-600" />
                        出库
                    </div>
                    <p className="mt-1 text-22 font-semibold tabular-nums text-ink">
                        {plainNum(outbound)}
                        <span className="ml-1.5 text-13 font-normal text-muted">{data.unit}</span>
                    </p>
                </div>
            </div>
            {showTable ? (
                <div className="mt-4 h-65 overflow-auto rounded-input border border-line">
                    <table className="data-table w-full text-right text-13">
                        <caption className="sr-only">成品出入库趋势数据</caption>
                        <thead>
                            <tr className="text-muted">
                                <th>日期</th>
                                <th className="text-right">入库（{data.unit}）</th>
                                <th className="text-right">出库（{data.unit}）</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => (
                                <tr key={row.date}>
                                    <td className="text-left">{row.date}</td>
                                    <td className="tnum">{plainNum(row.inbound)}</td>
                                    <td className="tnum">{plainNum(row.outbound)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : inbound + outbound === 0 ? (
                <p className="py-24 text-center text-14 text-muted">所选期间暂无成品出入库记录</p>
            ) : (
                <div
                    role="img"
                    aria-label={`${category || "全部品类"}，${start}至${end}，入库${plainNum(inbound)}个，出库${plainNum(outbound)}个。可切换数据表查看各期数值。`}
                >
                    <EChart option={option} height={276} />
                </div>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-12 text-muted">
                <span>
                    {start} — {end}
                </span>
                <Button variant="link" className="min-h-9 text-13" onClick={() => setShowTable(value => !value)}>
                    {showTable ? "查看趋势图" : "查看数据表"}
                </Button>
            </div>
        </section>
    );
}

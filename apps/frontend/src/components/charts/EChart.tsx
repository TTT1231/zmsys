import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart, BarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([LineChart, BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);
import type { EChartsOption } from "echarts";

interface EChartProps {
    option: EChartsOption;
    height: number;
    onClick?: (params: { name?: string; seriesName?: string; dataIndex?: number }) => void;
}

export function EChart({ option, height, onClick }: EChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const onClickRef = useRef(onClick);
    useEffect(() => {
        onClickRef.current = onClick;
    }, [onClick]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const chart = echarts.init(container);
        chartRef.current = chart;
        chart.on("click", (params: unknown) => {
            const p = params as {
                name?: string;
                seriesName?: string;
                dataIndex?: number;
            };
            onClickRef.current?.(p);
        });
        const observer = new ResizeObserver(() => chart.resize());
        observer.observe(container);
        return () => {
            observer.disconnect();
            chart.dispose();
            chartRef.current = null;
        };
    }, []);

    useEffect(() => {
        chartRef.current?.setOption(
            {
                ...option,
                animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
            },
            true,
        );
    }, [option]);

    return <div ref={containerRef} style={{ height }} />;
}

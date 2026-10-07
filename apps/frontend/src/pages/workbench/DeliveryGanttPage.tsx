/* 交付甘特图：复用工作台读模型，在隔离的原型文档中展示时间线。 */
import { useCallback, useEffect } from "react";
import { Navigate } from "react-router";
import * as echarts from "echarts/core";
import { CustomChart } from "echarts/charts";
import { GraphicComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";
import { useApp } from "@/context/useApp";
import type { WorkbenchData } from "@/data/workbench";
import { PageLoading } from "@/components/ui/PageLoading";
import { useWorkbenchData } from "./useWorkbenchData";
import { WorkbenchViews } from "./WorkbenchViews";

echarts.use([CustomChart, GraphicComponent, GridComponent, TooltipComponent, CanvasRenderer, SVGRenderer]);

declare global {
    interface Window {
        __zmsysDeliveryGanttData?: WorkbenchData;
        __zmsysDeliveryGanttEcharts?: typeof echarts;
    }
}

function DeliveryGanttFrame({ data }: { data: WorkbenchData }) {
    const setFrameRef = useCallback(
        (frame: HTMLIFrameElement | null) => {
            if (!frame) return;
            window.__zmsysDeliveryGanttData = data;
            window.__zmsysDeliveryGanttEcharts = echarts;
            frame.src = "/delivery-gantt.html";
        },
        [data],
    );

    useEffect(
        () => () => {
            delete window.__zmsysDeliveryGanttData;
            delete window.__zmsysDeliveryGanttEcharts;
        },
        [],
    );

    return (
        <iframe
            ref={setFrameRef}
            title="订单交付甘特图"
            className="block w-full rounded-panel border border-line bg-canvas"
            style={{ height: "min(840px, calc(100dvh - 190px))", minHeight: "620px" }}
        />
    );
}

export function DeliveryGanttPage() {
    const { role } = useApp();
    if (role !== "super") return <Navigate to="/workbench" replace />;

    return <SuperAdminDeliveryGantt />;
}

function SuperAdminDeliveryGantt() {
    const { data, isLoading } = useWorkbenchData();

    return (
        <div className="flex flex-col gap-4 pb-4">
            <WorkbenchViews active="delivery" />
            {isLoading ? (
                <PageLoading className="min-h-96" />
            ) : data.asOf ? (
                <DeliveryGanttFrame data={data} />
            ) : (
                <section className="rounded-panel border border-line bg-surface px-6 py-12 text-center shadow-card">
                    <h1 className="text-17 font-semibold text-ink">暂时无法加载交付数据</h1>
                    <p className="mt-2 text-14 text-muted">工作台数据加载完成后，交付时间线会显示在这里。</p>
                </section>
            )}
        </div>
    );
}

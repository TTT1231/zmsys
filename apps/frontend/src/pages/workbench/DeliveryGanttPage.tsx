/* 交付工作台直接展示备货数量与交期；只有超级管理员可读取。 */
import { Navigate } from "react-router";
import { useApp } from "@/context/useApp";
import { PageLoading } from "@/components/ui/PageLoading";
import { DeliveryProgress } from "./DeliveryProgress";
import { useWorkbenchData } from "./useWorkbenchData";
import { WorkbenchViews } from "./WorkbenchViews";

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
                <DeliveryProgress data={data} />
            ) : (
                <section className="rounded-panel border border-line bg-surface px-6 py-12 text-center shadow-card">
                    <h1 className="text-17 font-semibold text-ink">暂时无法加载交付数据</h1>
                    <p className="mt-2 text-14 text-muted">工作台数据加载完成后，交付进度会显示在这里。</p>
                </section>
            )}
        </div>
    );
}

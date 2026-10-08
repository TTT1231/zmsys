/* 分析页：交付甘特图自工作台二级视图迁出独立成页；按菜单授权访问（menu:analytics），默认仅超管。 */
import { PageLoading } from "@/components/ui/PageLoading";
import { useWorkbenchData } from "@/pages/workbench/useWorkbenchData";
import { DeliveryProgress } from "./DeliveryProgress";

export function AnalyticsPage() {
    const { data, isLoading } = useWorkbenchData();

    return (
        <div className="flex flex-col gap-4 pb-4">
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

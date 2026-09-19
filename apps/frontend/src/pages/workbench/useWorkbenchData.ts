/* 工作台数据：GET /workbench/overview，由后端统一聚合供给；
 * 页面与纯统计函数无需改写，加载期间以空模型兜底；
 * 另暴露 isLoading/isFetching 供页面出首载占位与刷新遮罩。 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkbenchOverview } from "@/api/workbench";
import type { WorkbenchData } from "@/data/workbench";

const EMPTY: WorkbenchData = { asOf: "", unit: "个", products: [], orders: [], movements: [] };

export function useWorkbenchData() {
    const { data, isLoading, isFetching } = useQuery({
        queryKey: ["workbench", "overview"],
        queryFn: fetchWorkbenchOverview,
    });
    return { data: useMemo(() => data ?? EMPTY, [data]), isLoading, isFetching };
}

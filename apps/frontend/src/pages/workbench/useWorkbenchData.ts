/* 工作台数据：GET /workbench/overview，由后端统一供给（演示/真实聚合）；
 * 页面与纯统计函数无需改写，加载期间以空模型兜底。 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkbenchOverview } from "@/api/workbench";
import type { WorkbenchData } from "@/data/workbench";

const EMPTY: WorkbenchData = { asOf: "", unit: "个", products: [], orders: [], movements: [] };

export function useWorkbenchData(): WorkbenchData {
    const { data } = useQuery({ queryKey: ["workbench", "overview"], queryFn: fetchWorkbenchOverview });
    return useMemo(() => data ?? EMPTY, [data]);
}

import type { WorkbenchData } from "@/data/workbench";
import { requestClient } from "@/http";

/** 工作台经营总览（后端聚合读模型） */
export function fetchWorkbenchOverview(): Promise<WorkbenchData> {
    return requestClient.get<WorkbenchData>("/workbench/overview");
}

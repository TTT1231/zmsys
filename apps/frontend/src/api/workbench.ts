import type { WorkbenchData } from "@/data/workbench";
import { requestClient } from "@/http";

/** 工作台经营总览（后端 MOCK_ENABLED=true 时返回演示数据，真实聚合待接入） */
export function fetchWorkbenchOverview(): Promise<WorkbenchData> {
    return requestClient.get<WorkbenchData>("/workbench/overview");
}

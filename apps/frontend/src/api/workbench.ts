import type { WorkbenchData } from "@/data/workbench";
import type { RelationStatus, RelationType, RelationsData } from "@/data/relations";
import { requestClient } from "@/http";

/** 工作台经营总览（后端聚合读模型） */
export function fetchWorkbenchOverview(): Promise<WorkbenchData> {
    return requestClient.get<WorkbenchData>("/workbench/overview");
}

export function fetchWorkbenchRelations(
    status: RelationStatus,
    range: { start: string; end: string },
    types: RelationType[],
    options?: { signal?: AbortSignal; bomCode?: string },
): Promise<RelationsData> {
    return requestClient.get<RelationsData>("/workbench/relations", {
        signal: options?.signal,
        params: {
            status,
            types: types.join(","),
            start: range.start || undefined,
            end: range.end || undefined,
            bomCode: options?.bomCode || undefined,
        },
    });
}
